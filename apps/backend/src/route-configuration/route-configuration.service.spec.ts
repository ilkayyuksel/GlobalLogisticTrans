import { AppLoggerService } from "../logger/app-logger.service";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RouteCostService } from "../route-costs/route-cost.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { RouteConfigurationService } from "./route-configuration.service";
import { RouteTunnelCostService } from "./route-tunnel-cost.service";
import { UnknownPricingComponentException } from "./exceptions/route-configuration.exceptions";

const ROUTE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TOLL_COMPONENT_ID = "d8bd583a-fcb9-48a2-8d8d-f056879ae6a5";
const TUNNEL_COMPONENT_ID = "b6252229-9a30-492a-82ac-65235f059600";

/**
 * One route, composed from the two tables that store it.
 *
 * ── WHAT THESE TESTS ARE ABOUT ──────────────────────────────────────────────
 * The COMPOSITION, not the rules underneath it. The duplicate-route check, the
 * canonical terminal matching and the amount validation all live in
 * RoutePricingService and RouteCostService and are tested there; this service
 * would have to reach past them to break any of it, and it never touches
 * Prisma at all.
 *
 * So what is asserted here is the part that is genuinely new: that one
 * operator-facing record maps onto a price and two costs, that the three stay
 * in step through every operation, and that nothing is left half configured.
 * ────────────────────────────────────────────────────────────────────────────
 */

function routePricing(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTE_ID,
    routeName: "Quay 869 - Dourges",
    departure: "Quay 869",
    destination: "Dourges",
    basePrice: "520.00",
    kilometres: "25.00",
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function routeCost(code: string, amount: string, overrides = {}) {
  return {
    id: `cost-${code.toLowerCase()}`,
    departure: "Quay 869",
    destination: "Dourges",
    pricingComponentId:
      code === "TOLL" ? TOLL_COMPONENT_ID : TUNNEL_COMPONENT_ID,
    pricingComponent: {
      id: code === "TOLL" ? TOLL_COMPONENT_ID : TUNNEL_COMPONENT_ID,
      code,
      name: code,
    },
    amount,
    notes: null,
    // A route COST still has an active flag; only the route price lost one.
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("RouteConfigurationService", () => {
  let routePricingService: {
    findAll: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let routeCostService: {
    findAll: jest.Mock;
    findActiveForRoute: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    activate: jest.Mock;
    deactivate: jest.Mock;
  };
  let repository: { findPricingComponentByCode: jest.Mock };
  let service: RouteConfigurationService;

  beforeEach(() => {
    routePricingService = {
      findAll: jest
        .fn()
        .mockResolvedValue({ items: [routePricing()], meta: {} }),
      findById: jest.fn().mockResolvedValue(routePricing()),
      create: jest.fn().mockResolvedValue(routePricing()),
      update: jest.fn().mockResolvedValue(routePricing()),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    routeCostService = {
      findAll: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      findActiveForRoute: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(routeCost("TUNNEL", "12.50")),
      update: jest.fn().mockResolvedValue(routeCost("TUNNEL", "12.50")),
      activate: jest.fn().mockResolvedValue(routeCost("TUNNEL", "12.50")),
      deactivate: jest.fn().mockResolvedValue(routeCost("TUNNEL", "12.50")),
    };
    repository = {
      findPricingComponentByCode: jest.fn((code: string) =>
        Promise.resolve({
          id: code === "TOLL" ? TOLL_COMPONENT_ID : TUNNEL_COMPONENT_ID,
          code,
          name: code,
        }),
      ),
    };

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as AppLoggerService;

    service = new RouteConfigurationService(
      routePricingService as unknown as RoutePricingService,
      /*
       * The real tunnel-cost service over the same mocks. It is the collaborator
       * that reads and writes the route's tunnel, and stubbing it would leave
       * these tests asserting nothing about the rows that actually get written.
       */
      new RouteTunnelCostService(
        routeCostService as unknown as RouteCostService,
        repository as unknown as RouteCostRepository,
        logger,
      ),
      logger,
    );
  });

  const SAVE = {
    departure: "Quay 869",
    destination: "Dourges",
    tarief: 520,
    // A DISTANCE now, not a toll amount: the Engine multiplies it by the rate.
    kilometres: 25,
    tunnel: 0,
  };

  describe("reading a route", () => {
    it("presents the price, the distance and the tunnel as one record", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TUNNEL", "12.50"),
      ]);

      expect(await service.findAll()).toEqual([
        {
          id: ROUTE_ID,
          departure: "Quay 869",
          destination: "Dourges",
          tarief: "520.00",
          kilometres: "25.00",
          tunnel: "12.50",
          hasTunnel: true,
          // Self-describing: an ordinary route says so rather than leaving a
          // caller to infer it from the endpoint it came back on.
          type: "NORMAL",
          combinationGroupId: null,
        },
      ]);
    });

    /**
     * A route configured before distances existed. No toll is charged for it
     * until somebody states one — an invented distance would charge a Trip for
     * a road nobody measured.
     */
    it("reads a route with no stated distance as null", async () => {
      routePricingService.findAll.mockResolvedValue({
        items: [routePricing({ kilometres: null })],
        meta: {},
      });

      expect((await service.findAll())[0].kilometres).toBeNull();
    });

    /**
     * An unconfigured cost reads as zero, because that is what it costs. The
     * flag is what separates "configured as zero" from "never configured",
     * which the screen needs and a price does not.
     */
    it("reads an absent cost as zero, and says it is absent", async () => {
      const [configuration] = await service.findAll();

      expect(configuration.tunnel).toBe("0.00");
      expect(configuration.hasTunnel).toBe(false);
    });

    it("reads a cost configured AS zero as configured", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TUNNEL", "0.00"),
      ]);

      const [configuration] = await service.findAll();

      expect(configuration.tunnel).toBe("0.00");
      expect(configuration.hasTunnel).toBe(true);
    });

    /** Configuration is read whole; a page-2 route would simply be missing. */
    it("asks for every route rather than a first page", async () => {
      await service.findAll();

      expect(routePricingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 200 }),
        // Ordinary routes only. A Combination leg is half a pair and is never
        // listed as a route an operator could edit on its own.
        "NORMAL",
      );
    });
  });

  describe("configuring a route", () => {
    it("writes the price with its distance, and the tunnel cost", async () => {
      await service.create(SAVE);

      expect(routePricingService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          departure: "Quay 869",
          destination: "Dourges",
          basePrice: 520,
          kilometres: 25,
        }),
      );
      // One cost, not two: the toll is no longer stored per route.
      expect(routeCostService.create).toHaveBeenCalledTimes(1);
    });

    /** The price first: its duplicate check is what refuses a second route. */
    it("creates the price before any cost", async () => {
      const order: string[] = [];

      routePricingService.create.mockImplementation(async () => {
        order.push("price");

        return routePricing();
      });
      routeCostService.create.mockImplementation(async () => {
        order.push("cost");

        return routeCost("TUNNEL", "12.50");
      });

      await service.create(SAVE);

      expect(order[0]).toBe("price");
    });

    /** A refused route must leave nothing behind. */
    it("writes no cost when the route is refused", async () => {
      routePricingService.create.mockRejectedValue(new Error("duplicate"));

      await expect(service.create(SAVE)).rejects.toThrow();
      expect(routeCostService.create).not.toHaveBeenCalled();
    });

    /** Zero is an amount an operator may configure, not an absence. */
    it("stores a zero amount as a real cost row", async () => {
      await service.create({ ...SAVE, kilometres: 0, tunnel: 0 });

      expect(routeCostService.create).toHaveBeenCalledTimes(1);
      expect(routeCostService.create.mock.calls[0][0].amount).toBe(0);
    });

    /** The distance goes on the route itself; no toll cost row is written. */
    it("writes the distance with the price and no toll cost", async () => {
      await service.create(SAVE);

      expect(routePricingService.create).toHaveBeenCalledWith(
        expect.objectContaining({ kilometres: 25 }),
      );
      for (const [dto] of routeCostService.create.mock.calls) {
        expect(dto.pricingComponentId).not.toBe("component-TOLL");
      }
    });

    it("names the component by code, never by an id from the caller", async () => {
      await service.create(SAVE);

      expect(repository.findPricingComponentByCode).toHaveBeenCalledWith(
        "TUNNEL",
      );
      expect(repository.findPricingComponentByCode).not.toHaveBeenCalledWith(
        "TOLL",
      );
    });

    it("refuses when the catalog has no such component", async () => {
      repository.findPricingComponentByCode.mockResolvedValue(null);

      await expect(service.create(SAVE)).rejects.toBeInstanceOf(
        UnknownPricingComponentException,
      );
    });

    /** The price record needs a name; the screen does not ask for one. */
    it("derives the route name from the two ends", async () => {
      await service.create(SAVE);

      expect(routePricingService.create).toHaveBeenCalledWith(
        expect.objectContaining({ routeName: "Quay 869 - Dourges" }),
      );
    });
  });

  describe("changing a route", () => {
    it("corrects an existing cost rather than adding a second", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TUNNEL", "12.50"),
      ]);

      await service.update(ROUTE_ID, { ...SAVE, tunnel: 25 });

      expect(routeCostService.update).toHaveBeenCalledWith("cost-tunnel", {
        amount: 25,
        // The road travels with the amount, so a cost owned by a Combination leg
        // follows the leg when it moves. For a cost of the road it is the road
        // the lookup just matched and cannot differ.
        departure: "Quay 869",
        destination: "Dourges",
      });
      expect(routeCostService.create).not.toHaveBeenCalled();
    });

    /** The distance travels with the price, on the route record itself. */
    it("writes the new distance onto the route", async () => {
      await service.update(ROUTE_ID, { ...SAVE, kilometres: 42 });

      expect(routePricingService.update).toHaveBeenCalledWith(
        ROUTE_ID,
        expect.objectContaining({ kilometres: 42 }),
      );
    });

    it("reactivates a cost that had been switched off", async () => {
      routeCostService.findAll.mockResolvedValue({
        items: [routeCost("TUNNEL", "12.50", { isActive: false })],
        meta: {},
      });

      await service.update(ROUTE_ID, SAVE);

      expect(routeCostService.activate).toHaveBeenCalledWith("cost-tunnel");
    });

    /**
     * Costs are keyed by the route, so moving the route must take them along.
     * Leaving them behind would strand them on a route that no longer exists
     * and quietly stop charging them.
     */
    it("moves the costs when the route moves", async () => {
      // The cost exists at the OLD pair only, which is what moving means.
      routeCostService.findActiveForRoute.mockImplementation(
        async (_departure: string, destination: string) =>
          destination === "Dourges" ? [routeCost("TUNNEL", "12.50")] : [],
      );

      await service.update(ROUTE_ID, { ...SAVE, destination: "Bousbecque" });

      expect(routeCostService.deactivate).toHaveBeenCalledWith("cost-tunnel");
      expect(routeCostService.create).toHaveBeenCalledWith(
        expect.objectContaining({ destination: "Bousbecque" }),
      );
    });

    it("leaves the costs where they are when only an amount changes", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TUNNEL", "12.50"),
      ]);

      await service.update(ROUTE_ID, { ...SAVE, tarief: 550 });

      expect(routeCostService.deactivate).not.toHaveBeenCalled();
    });
  });

  /**
   * ── REMOVING A ROUTE ──────────────────────────────────────────────────────
   * This was a pair of activation tests. A route now exists or it does not, and
   * its costs go with it: a tunnel cost left behind is matched by departure and
   * destination and would keep charging Trips on a route nobody configured.
   */
  describe("removing a route", () => {
    it("deletes the price and stops its costs", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TUNNEL", "12.50"),
      ]);

      await service.remove(ROUTE_ID);

      expect(routePricingService.remove).toHaveBeenCalledWith(ROUTE_ID);
      expect(routeCostService.deactivate).toHaveBeenCalledWith("cost-tunnel");
    });

    it("offers no way to switch a route off instead", () => {
      const methods = Object.getOwnPropertyNames(
        RouteConfigurationService.prototype,
      );

      expect(methods).not.toContain("changeState");
    });
  });

  /**
   * ── A COMBINATION LEG IS NOT AN ORDINARY ROUTE ────────────────────────────
   * These endpoints identify a route by its road and write its tunnel against
   * that road. A leg is neither: it exists only as half of a pair, and its tunnel
   * is its own. Reached through here it would be moved away from its partner, and
   * its tunnel written as the road's — silently changing what every ordinary Trip
   * on that road pays.
   */
  describe("a Combination leg reached through the ordinary endpoints", () => {
    const COMBINATION_GROUP_ID = "7d2b8c14-9f3a-4c5e-8b1d-2e3f4a5b6c7d";

    beforeEach(() => {
      routePricingService.findById.mockResolvedValue(
        routePricing({ combinationGroupId: COMBINATION_GROUP_ID }),
      );
    });

    it("refuses to be edited", async () => {
      await expect(service.update(ROUTE_ID, SAVE)).rejects.toThrow(
        /cannot be changed on its own/,
      );
      expect(routePricingService.update).not.toHaveBeenCalled();
    });

    it("refuses to be removed", async () => {
      await expect(service.remove(ROUTE_ID)).rejects.toThrow(
        /cannot be removed on its own/,
      );
      expect(routePricingService.remove).not.toHaveBeenCalled();
    });

    /**
     * The decisive one. The refusal must come BEFORE any write: a leg's tunnel is
     * the leg's, so deactivating "its" road cost would switch off the ORDINARY
     * route's tunnel on the way to failing.
     */
    it("changes no cost on its way to refusing", async () => {
      await expect(service.remove(ROUTE_ID)).rejects.toThrow();
      await expect(service.update(ROUTE_ID, SAVE)).rejects.toThrow();

      expect(routeCostService.deactivate).not.toHaveBeenCalled();
      expect(routeCostService.update).not.toHaveBeenCalled();
      expect(routeCostService.create).not.toHaveBeenCalled();
    });

    it("names the Combination to act on instead", async () => {
      await expect(service.remove(ROUTE_ID)).rejects.toThrow(
        COMBINATION_GROUP_ID,
      );
    });
  });

  /**
   * ── IT TOUCHES NO TRIP ────────────────────────────────────────────────────
   * Configuration is read when a Trip is priced. A Trip already priced keeps
   * the amounts it was priced with, and this service has no way to reach one:
   * it holds no Trip service, no pricing engine and no snapshot writer.
   */
  it("has no route to a Trip, a snapshot or the Engine", () => {
    const collaborators = Object.keys(service as unknown as object);

    expect(collaborators).toEqual(["routePricing", "tunnelCosts", "logger"]);
  });
});
