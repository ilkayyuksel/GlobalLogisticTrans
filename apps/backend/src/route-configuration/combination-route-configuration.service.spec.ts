import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RouteCostService } from "../route-costs/route-cost.service";
import { CombinationRouteConfigurationService } from "./combination-route-configuration.service";
import { RouteComponentCostService } from "./route-component-cost.service";

const GROUP_ID = "7d2b8c14-9f3a-4c5e-8b1d-2e3f4a5b6c7d";
const OUTBOUND_ID = "5a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const RETURN_ID = "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f";
const TUNNEL_COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TOLL_COMPONENT_ID = "3c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

/**
 * A Combination, as an operator configures it: one record with two legs.
 *
 * ── THE COLLISION THIS EXISTS TO PREVENT ────────────────────────────────────
 * A Combination's outbound often runs the very road an ordinary Trip also runs,
 * and the two are priced differently on purpose. Route costs used to be matched
 * by departure and destination alone, so both would have read and written ONE
 * tunnel row: correcting the Combination's tunnel would silently change what
 * every ordinary Trip on that road pays.
 *
 * A leg therefore OWNS its tunnel. These tests assert that the owner is written,
 * that the leg's tunnel is read by the leg, and that the road's rows are never
 * consulted for a leg — which is what keeps the two configurations independent.
 *
 * ── AND WHAT IT IS NOT ──────────────────────────────────────────────────────
 * Not a Trip group. The €50 Backload follows TripGroup membership and is decided
 * by the Engine; this decides what the two legs COST. Nothing here can reach a
 * Trip, and the last test proves it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** One leg, as the underlying price record returns it. */
function legPrice(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    routeName: "Antwerp - Kallo",
    departure: "Antwerp",
    destination: "Kallo",
    basePrice: "100.00",
    combinationGroupId: GROUP_ID,
    combinationLegPosition: 1,
    notes: null,
    createdAt: new Date("2026-09-26T00:00:00Z"),
    updatedAt: new Date("2026-09-26T00:00:00Z"),
    ...overrides,
  };
}

function storedCombination() {
  return {
    id: GROUP_ID,
    legs: [
      legPrice(OUTBOUND_ID),
      legPrice(RETURN_ID, {
        routeName: "Kallo - Antwerp",
        departure: "Kallo",
        destination: "Antwerp",
        basePrice: "80.00",
        combinationLegPosition: 2,
      }),
    ],
    overSt: { tarief: "50.00", toll: "5.00", tunnel: null },
    createdAt: new Date("2026-09-26T00:00:00Z"),
    updatedAt: new Date("2026-09-26T00:00:00Z"),
  };
}

/** A tunnel cost, owned by a leg or by the road. */
function tunnelCost(
  id: string,
  amount: string,
  routePricingId: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    departure: "Antwerp",
    destination: "Kallo",
    pricingComponentId: TUNNEL_COMPONENT_ID,
    pricingComponent: {
      id: TUNNEL_COMPONENT_ID,
      code: "TUNNEL",
      name: "Tunnel",
    },
    amount,
    routePricingId,
    notes: null,
    isActive: true,
    createdAt: new Date("2026-09-26T00:00:00Z"),
    updatedAt: new Date("2026-09-26T00:00:00Z"),
    ...overrides,
  };
}

const SAVE = {
  legs: [
    {
      departure: "Antwerp",
      destination: "Kallo",
      tarief: 100,
      toll: 20,
      tunnel: 12.5,
    },
    {
      departure: "Kallo",
      destination: "Antwerp",
      tarief: 80,
      toll: 15,
      tunnel: 0,
    },
  ],
};

describe("CombinationRouteConfigurationService", () => {
  let combinationPricing: {
    findAll: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    replaceLegs: jest.Mock;
    remove: jest.Mock;
  };
  let routeCostService: {
    findActiveForRoute: jest.Mock;
    findActiveForRoutePricing: jest.Mock;
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    activate: jest.Mock;
    deactivate: jest.Mock;
  };
  let repository: { findPricingComponentByCode: jest.Mock };
  let service: CombinationRouteConfigurationService;

  beforeEach(() => {
    combinationPricing = {
      findAll: jest.fn().mockResolvedValue([storedCombination()]),
      findById: jest.fn().mockResolvedValue(storedCombination()),
      create: jest.fn().mockResolvedValue(storedCombination()),
      replaceLegs: jest.fn().mockResolvedValue(storedCombination()),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    routeCostService = {
      // Neither the road nor either leg has a tunnel unless a test says so.
      findActiveForRoute: jest.fn().mockResolvedValue([]),
      findActiveForRoutePricing: jest.fn().mockResolvedValue([]),
      findAll: jest.fn().mockResolvedValue({ items: [] }),
      create: jest.fn().mockResolvedValue(tunnelCost("cost-new", "0.00", null)),
      update: jest.fn().mockResolvedValue(tunnelCost("cost-1", "0.00", null)),
      activate: jest.fn().mockResolvedValue(tunnelCost("cost-1", "0.00", null)),
      deactivate: jest.fn().mockResolvedValue(undefined),
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

    service = new CombinationRouteConfigurationService(
      combinationPricing as unknown as CombinationRoutePricingService,
      // The real tunnel-cost service over the same mocks: stubbing it would leave
      // these tests asserting nothing about the rows that actually get written.
      new RouteComponentCostService(
        routeCostService as unknown as RouteCostService,
        repository as unknown as RouteCostRepository,
        logger,
      ),
      logger,
    );
  });

  describe("configuring a Combination", () => {
    it("writes both legs through the service that holds the transaction", async () => {
      await service.create(SAVE);

      expect(combinationPricing.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({ departure: "Antwerp", basePrice: 100 }),
          expect.objectContaining({ departure: "Kallo", basePrice: 80 }),
        ],
        undefined,
      );
    });

    it("writes no distance onto either leg", async () => {
      await service.create(SAVE);

      const [legs] = combinationPricing.create.mock.calls[0];

      for (const leg of legs) {
        expect(leg).not.toHaveProperty("kilometres");
      }
    });

    /** Each leg's Toll is its own, owned by the leg like its Tunnel. */
    it("writes each leg's toll against the leg itself", async () => {
      await service.create(SAVE);

      expect(routeCostService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          routePricingId: OUTBOUND_ID,
          pricingComponentId: TOLL_COMPONENT_ID,
          amount: 20,
        }),
      );
      expect(routeCostService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          routePricingId: RETURN_ID,
          pricingComponentId: TOLL_COMPONENT_ID,
          amount: 15,
        }),
      );
    });

    /** Over ST travels with the legs into the same transaction. */
    it("passes Over ST to the service that writes the group", async () => {
      const overSt = { tarief: 50, toll: 5, tunnel: 0 };

      await service.create({ ...SAVE, overSt });

      expect(combinationPricing.create).toHaveBeenCalledWith(expect.any(Array), overSt);
    });

    /** The price record needs a name and the screen does not ask for one. */
    it("names each leg after its own two ends", async () => {
      await service.create(SAVE);

      const [legs] = combinationPricing.create.mock.calls[0];

      expect(legs.map((each: { routeName: string }) => each.routeName)).toEqual([
        "Antwerp - Kallo",
        "Kallo - Antwerp",
      ]);
    });

    /*
     * ── EACH LEG OWNS ITS TUNNEL ──────────────────────────────────────────
     * The owner is what keeps the Combination's tunnel apart from the ordinary
     * route's on the same road.
     */
    it("writes each leg's tunnel against the leg itself", async () => {
      await service.create(SAVE);

      expect(routeCostService.create).toHaveBeenCalledWith(
        expect.objectContaining({ routePricingId: OUTBOUND_ID, amount: 12.5 }),
      );
      expect(routeCostService.create).toHaveBeenCalledWith(
        expect.objectContaining({ routePricingId: RETURN_ID, amount: 0 }),
      );
    });

    it("never writes a leg's tunnel as a cost of the road", async () => {
      await service.create(SAVE);

      for (const [call] of routeCostService.create.mock.calls) {
        expect(call.routePricingId).not.toBeNull();
      }
    });

    /** A tunnel of zero is a decision, and is stored as a real row. */
    it("stores a tunnel of zero rather than no row", async () => {
      await service.create(SAVE);

      // A toll and a tunnel for each of the two legs.
      expect(routeCostService.create).toHaveBeenCalledTimes(4);
    });

    it("records the road each leg's tunnel is charged on", async () => {
      await service.create(SAVE);

      const roads = routeCostService.create.mock.calls
        .filter(([call]) => call.pricingComponentId === TUNNEL_COMPONENT_ID)
        .map(([call]) => [call.departure, call.destination]);

      expect(roads).toEqual([
        ["Antwerp", "Kallo"],
        ["Kallo", "Antwerp"],
      ]);
    });

    it("writes the legs before their tunnels, so a refusal leaves nothing", async () => {
      const order: string[] = [];
      combinationPricing.create.mockImplementation(async () => {
        order.push("legs");

        return storedCombination();
      });
      routeCostService.create.mockImplementation(async () => {
        order.push("tunnel");

        return tunnelCost("cost-new", "0.00", OUTBOUND_ID);
      });

      await service.create(SAVE);

      expect(order).toEqual(["legs", "tunnel", "tunnel", "tunnel", "tunnel"]);
    });
  });

  describe("reading a Combination", () => {
    it("presents both legs as one record with the group's identity", async () => {
      const [combination] = await service.findAll();

      expect(combination.id).toBe(GROUP_ID);
      expect(combination.legs).toHaveLength(2);
    });

    it("marks both legs as Combination legs naming their group", async () => {
      const [combination] = await service.findAll();

      for (const leg of combination.legs) {
        expect(leg.type).toBe("COMBINATION");
        expect(leg.combinationGroupId).toBe(GROUP_ID);
      }
    });

    it("keeps each leg's own Tarief", async () => {
      const [combination] = await service.findAll();

      expect(combination.legs.map((leg) => leg.tarief)).toEqual([
        "100.00",
        "80.00",
      ]);
    });

    it("reads each leg's tunnel by the leg, never by the road", async () => {
      await service.findAll();

      expect(routeCostService.findActiveForRoutePricing).toHaveBeenCalledWith(
        OUTBOUND_ID,
      );
      expect(routeCostService.findActiveForRoutePricing).toHaveBeenCalledWith(
        RETURN_ID,
      );
      expect(routeCostService.findActiveForRoute).not.toHaveBeenCalled();
    });

    it("presents each leg's own tunnel amount", async () => {
      routeCostService.findActiveForRoutePricing.mockImplementation(
        async (routePricingId: string) =>
          routePricingId === OUTBOUND_ID
            ? [tunnelCost("cost-outbound", "12.50", OUTBOUND_ID)]
            : [tunnelCost("cost-return", "3.75", RETURN_ID)],
      );

      const [combination] = await service.findAll();

      expect(combination.legs.map((leg) => leg.tunnel)).toEqual([
        "12.50",
        "3.75",
      ]);
    });

    /** A leg with no tunnel row reads as zero, and says the row is absent. */
    it("reads a leg with no tunnel as zero", async () => {
      const [combination] = await service.findAll();

      expect(combination.legs[0].tunnel).toBe("0.00");
      expect(combination.legs[0].hasTunnel).toBe(false);
    });

    it("presents the Combination's Over ST beside its legs", async () => {
      const [combination] = await service.findAll();

      expect(combination.overSt).toEqual({ tarief: "50.00", toll: "5.00", tunnel: null });
    });

    it("presents each leg's own toll", async () => {
      routeCostService.findActiveForRoutePricing.mockImplementation(
        async (routePricingId: string) => [
          {
            ...tunnelCost(`cost-${routePricingId}`, "0.00", routePricingId),
            pricingComponentId: TOLL_COMPONENT_ID,
            pricingComponent: { id: TOLL_COMPONENT_ID, code: "TOLL", name: "Toll" },
            amount: routePricingId === OUTBOUND_ID ? "20.00" : "15.00",
          },
        ],
      );

      const [combination] = await service.findAll();

      expect(combination.legs.map((leg) => leg.toll)).toEqual(["20.00", "15.00"]);
      expect(combination.legs.every((leg) => leg.hasToll)).toBe(true);
    });

    it("returns nothing when no Combination is configured", async () => {
      combinationPricing.findAll.mockResolvedValue([]);

      expect(await service.findAll()).toEqual([]);
    });
  });

  describe("changing a Combination", () => {
    it("rewrites both legs in one edit", async () => {
      await service.update(GROUP_ID, SAVE);

      expect(combinationPricing.replaceLegs).toHaveBeenCalledWith(
        GROUP_ID,
        [
          expect.objectContaining({ departure: "Antwerp" }),
          expect.objectContaining({ departure: "Kallo" }),
        ],
        undefined,
      );
    });

    /** Omitted Over ST is left alone — the leg sync depends on exactly this. */
    it("leaves Over ST alone when the edit does not send it", async () => {
      await service.update(GROUP_ID, SAVE);

      expect(combinationPricing.replaceLegs.mock.calls[0][2]).toBeUndefined();
    });

    it("writes Over ST when the edit sends it", async () => {
      const overSt = { tarief: 60, toll: null, tunnel: 2.5 };

      await service.update(GROUP_ID, { ...SAVE, overSt });

      expect(combinationPricing.replaceLegs.mock.calls[0][2]).toEqual(overSt);
    });

    it("rewrites both tunnels against the legs that survived the edit", async () => {
      routeCostService.findActiveForRoutePricing.mockImplementation(
        async (routePricingId: string) => [
          tunnelCost(`cost-${routePricingId}`, "1.00", routePricingId),
        ],
      );

      await service.update(GROUP_ID, SAVE);

      expect(routeCostService.update).toHaveBeenCalledWith(
        `cost-${OUTBOUND_ID}`,
        expect.objectContaining({ amount: 12.5 }),
      );
      // The toll is a different component, so it is a new row beside the tunnel.
      expect(routeCostService.create).toHaveBeenCalledWith(
        expect.objectContaining({ routePricingId: OUTBOUND_ID, amount: 20 }),
      );
      expect(routeCostService.update).toHaveBeenCalledWith(
        `cost-${RETURN_ID}`,
        expect.objectContaining({ amount: 0 }),
      );
    });

    /**
     * A leg's tunnel is owned by the leg, so moving the leg cannot strand it the
     * way an ordinary route's cost would be stranded. The row's recorded road
     * follows the leg instead of being deactivated and rewritten.
     */
    it("moves a leg's tunnel with the leg rather than deactivating it", async () => {
      routeCostService.findActiveForRoutePricing.mockResolvedValue([
        tunnelCost("cost-outbound", "12.50", OUTBOUND_ID, {
          departure: "Zwijndrecht",
        }),
      ]);

      await service.update(GROUP_ID, SAVE);

      expect(routeCostService.update).toHaveBeenCalledWith(
        "cost-outbound",
        expect.objectContaining({ departure: "Antwerp", destination: "Kallo" }),
      );
      expect(routeCostService.deactivate).not.toHaveBeenCalled();
    });

    it("reactivates a leg's tunnel that had been switched off", async () => {
      routeCostService.findAll.mockResolvedValue({
        items: [
          tunnelCost("cost-outbound", "12.50", OUTBOUND_ID, {
            isActive: false,
          }),
        ],
      });

      await service.update(GROUP_ID, SAVE);

      expect(routeCostService.activate).toHaveBeenCalledWith("cost-outbound");
    });
  });

  describe("removing a Combination", () => {
    /** The GROUP, never a leg: the cascade takes both legs and both tunnels. */
    it("removes the whole Combination", async () => {
      await service.remove(GROUP_ID);

      expect(combinationPricing.remove).toHaveBeenCalledWith(GROUP_ID);
    });

    it("deactivates no cost of the road, which belongs to no leg", async () => {
      await service.remove(GROUP_ID);

      expect(routeCostService.deactivate).not.toHaveBeenCalled();
    });
  });

  /**
   * ── IT TOUCHES NO TRIP ────────────────────────────────────────────────────
   * Configuration is read when a Trip is priced; a Trip already priced keeps the
   * amounts it was priced with. The €50 Backload follows TripGroup membership and
   * is decided by the Engine, which this service cannot reach: it holds no Trip
   * service, no engine and no snapshot writer.
   */
  it("has no route to a Trip, a snapshot or the Engine", () => {
    expect(Object.keys(service as unknown as object)).toEqual([
      "combinationPricing",
      "routeCosts",
      "logger",
    ]);
  });
});
