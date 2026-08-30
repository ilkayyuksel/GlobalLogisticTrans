import { AppLoggerService } from "../logger/app-logger.service";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RouteCostService } from "../route-costs/route-cost.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { RouteConfigurationService } from "./route-configuration.service";
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
    notes: null,
    isActive: true,
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
    pricingComponent: { id: TOLL_COMPONENT_ID, code, name: code },
    amount,
    notes: null,
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
    activate: jest.Mock;
    deactivate: jest.Mock;
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
      activate: jest.fn().mockResolvedValue(routePricing()),
      deactivate: jest
        .fn()
        .mockResolvedValue(routePricing({ isActive: false })),
    };
    routeCostService = {
      findAll: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      findActiveForRoute: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(routeCost("TOLL", "18.00")),
      update: jest.fn().mockResolvedValue(routeCost("TOLL", "18.00")),
      activate: jest.fn().mockResolvedValue(routeCost("TOLL", "18.00")),
      deactivate: jest.fn().mockResolvedValue(routeCost("TOLL", "18.00")),
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

    service = new RouteConfigurationService(
      routePricingService as unknown as RoutePricingService,
      routeCostService as unknown as RouteCostService,
      repository as unknown as RouteCostRepository,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  const SAVE = {
    departure: "Quay 869",
    destination: "Dourges",
    tarief: 520,
    toll: 18,
    tunnel: 0,
  };

  describe("reading a route", () => {
    it("presents the price and both costs as one record", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TOLL", "18.00"),
        routeCost("TUNNEL", "12.50"),
      ]);

      expect(await service.findAll()).toEqual([
        {
          id: ROUTE_ID,
          departure: "Quay 869",
          destination: "Dourges",
          tarief: "520.00",
          toll: "18.00",
          tunnel: "12.50",
          hasToll: true,
          hasTunnel: true,
          isActive: true,
        },
      ]);
    });

    /**
     * An unconfigured cost reads as zero, because that is what it costs. The
     * flag is what separates "configured as zero" from "never configured",
     * which the screen needs and a price does not.
     */
    it("reads an absent cost as zero, and says it is absent", async () => {
      const [configuration] = await service.findAll();

      expect(configuration.toll).toBe("0.00");
      expect(configuration.hasToll).toBe(false);
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

    it("shows an inactive configuration too", async () => {
      routePricingService.findAll.mockResolvedValue({
        items: [routePricing({ isActive: false })],
        meta: {},
      });

      expect((await service.findAll())[0].isActive).toBe(false);
    });

    /** Configuration is read whole; a page-2 route would simply be missing. */
    it("asks for every route rather than a first page", async () => {
      await service.findAll();

      expect(routePricingService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 200 }),
      );
    });
  });

  describe("configuring a route", () => {
    it("writes the price and both costs", async () => {
      await service.create(SAVE);

      expect(routePricingService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          departure: "Quay 869",
          destination: "Dourges",
          basePrice: 520,
        }),
      );
      expect(routeCostService.create).toHaveBeenCalledTimes(2);
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

        return routeCost("TOLL", "18.00");
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
      await service.create({ ...SAVE, toll: 0, tunnel: 0 });

      expect(routeCostService.create).toHaveBeenCalledTimes(2);
      for (const [dto] of routeCostService.create.mock.calls) {
        expect(dto.amount).toBe(0);
      }
    });

    it("names the components by code, never by an id from the caller", async () => {
      await service.create(SAVE);

      expect(repository.findPricingComponentByCode).toHaveBeenCalledWith("TOLL");
      expect(repository.findPricingComponentByCode).toHaveBeenCalledWith(
        "TUNNEL",
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
        routeCost("TOLL", "18.00"),
      ]);

      await service.update(ROUTE_ID, { ...SAVE, toll: 25 });

      expect(routeCostService.update).toHaveBeenCalledWith("cost-toll", {
        amount: 25,
      });
      expect(routeCostService.create).toHaveBeenCalledTimes(1); // the tunnel
    });

    it("reactivates a cost that had been switched off", async () => {
      routeCostService.findAll.mockResolvedValue({
        items: [routeCost("TOLL", "18.00", { isActive: false })],
        meta: {},
      });

      await service.update(ROUTE_ID, SAVE);

      expect(routeCostService.activate).toHaveBeenCalledWith("cost-toll");
    });

    /**
     * Costs are keyed by the route, so moving the route must take them along.
     * Leaving them behind would strand them on a route that no longer exists
     * and quietly stop charging them.
     */
    it("moves the costs when the route moves", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TOLL", "18.00"),
      ]);

      await service.update(ROUTE_ID, { ...SAVE, destination: "Bousbecque" });

      expect(routeCostService.deactivate).toHaveBeenCalledWith("cost-toll");
      expect(routeCostService.create).toHaveBeenCalledWith(
        expect.objectContaining({ destination: "Bousbecque" }),
      );
    });

    it("leaves the costs where they are when only an amount changes", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TOLL", "18.00"),
      ]);

      await service.update(ROUTE_ID, { ...SAVE, tarief: 550 });

      expect(routeCostService.deactivate).not.toHaveBeenCalled();
    });
  });

  /**
   * The price and both costs move together. A route priced at zero but still
   * charging a toll is a state the operator never asked for and could not see
   * on a screen that shows one switch.
   */
  describe("activating and deactivating", () => {
    it("switches the costs off with the price", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TOLL", "18.00"),
        routeCost("TUNNEL", "12.50"),
      ]);

      await service.changeState(ROUTE_ID, { isActive: false });

      expect(routePricingService.deactivate).toHaveBeenCalledWith(ROUTE_ID);
      expect(routeCostService.deactivate).toHaveBeenCalledTimes(2);
    });

    it("switches them back on with it", async () => {
      routeCostService.findAll.mockResolvedValue({
        items: [routeCost("TOLL", "18.00", { isActive: false })],
        meta: {},
      });

      await service.changeState(ROUTE_ID, { isActive: true });

      expect(routePricingService.activate).toHaveBeenCalledWith(ROUTE_ID);
      expect(routeCostService.activate).toHaveBeenCalledWith("cost-toll");
    });

    /** Deactivating is not deleting: every Trip priced against it keeps its price. */
    it("deletes nothing", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("TOLL", "18.00"),
      ]);

      await service.changeState(ROUTE_ID, { isActive: false });

      expect(routeCostService).not.toHaveProperty("remove");
      expect(routePricingService).not.toHaveProperty("remove");
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

    expect(collaborators).toEqual([
      "routePricing",
      "routeCosts",
      "routeCostRepository",
      "logger",
    ]);
  });
});
