import { AppLoggerService } from "../logger/app-logger.service";
import { RouteCostService } from "../route-costs/route-cost.service";
import { RouteCostResolver } from "./route-cost.resolver";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const ROUTE = {
  departure: "MSC PSA European Terminal",
  destination: "Rotterdam",
};

/** One route cost, shaped as RouteCostService returns it. */
function routeCost(
  id: string,
  componentId: string,
  code: string,
  amount: string,
) {
  return {
    id,
    departure: ROUTE.departure,
    destination: ROUTE.destination,
    pricingComponentId: componentId,
    pricingComponent: { id: componentId, code, name: code },
    amount,
    notes: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("RouteCostResolver", () => {
  let routeCostService: {
    findActiveForRoute: jest.Mock;
    findActiveForRoutePricing: jest.Mock;
  };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let resolver: RouteCostResolver;

  beforeEach(() => {
    routeCostService = {
      findActiveForRoute: jest.fn().mockResolvedValue([]),
      findActiveForRoutePricing: jest.fn().mockResolvedValue([]),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    resolver = new RouteCostResolver(
      routeCostService as unknown as RouteCostService,
      logger as unknown as AppLoggerService,
    );
  });

  it("looks the costs up by the Trip's route", async () => {
    await resolver.resolve(TRIP_ID, ROUTE);

    expect(routeCostService.findActiveForRoute).toHaveBeenCalledWith(
      ROUTE.departure,
      ROUTE.destination,
    );
  });

  it("carries everything a calculator needs, so it never looks anything up", async () => {
    routeCostService.findActiveForRoute.mockResolvedValue([
      routeCost("cost-1", "component-toll", "TOLL", "9.75"),
      routeCost("cost-2", "component-tunnel", "TUNNEL", "12.50"),
    ]);

    expect(await resolver.resolve(TRIP_ID, ROUTE)).toEqual([
      {
        routeCostId: "cost-1",
        pricingComponentId: "component-toll",
        componentCode: "TOLL",
        amount: "9.75",
      },
      {
        routeCostId: "cost-2",
        pricingComponentId: "component-tunnel",
        componentCode: "TUNNEL",
        amount: "12.50",
      },
    ]);
  });

  it("keeps amounts as exact strings, never numbers", async () => {
    routeCostService.findActiveForRoute.mockResolvedValue([
      routeCost("cost-1", "component-toll", "TOLL", "9.75"),
    ]);

    const [cost] = await resolver.resolve(TRIP_ID, ROUTE);

    expect(typeof cost.amount).toBe("string");
    expect(cost.amount).toBe("9.75");
  });

  it("preserves the order the service returned", async () => {
    routeCostService.findActiveForRoute.mockResolvedValue([
      routeCost("cost-2", "component-tunnel", "TUNNEL", "12.50"),
      routeCost("cost-1", "component-toll", "TOLL", "9.75"),
    ]);

    const resolved = await resolver.resolve(TRIP_ID, ROUTE);

    expect(resolved.map((cost) => cost.componentCode)).toEqual([
      "TUNNEL",
      "TOLL",
    ]);
  });

  /**
   * A route with nothing configured must not make the Trip unpriceable: most
   * Trips owe no toll at all. Whether a missing cost matters depends on which
   * components the Trip carries, which only a calculator can see.
   */
  describe("a route with no configured costs", () => {
    it("returns an empty list rather than throwing", async () => {
      await expect(resolver.resolve(TRIP_ID, ROUTE)).resolves.toEqual([]);
    });

    it("does not warn, because this is the normal case", async () => {
      await resolver.resolve(TRIP_ID, ROUTE);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("a Trip with no terminal", () => {
    const routeWithoutDeparture = { departure: null, destination: "Rotterdam" };

    it("resolves nothing, because there is no route identity to match", async () => {
      const resolved = await resolver.resolve(TRIP_ID, routeWithoutDeparture);

      expect(resolved).toEqual([]);
      expect(routeCostService.findActiveForRoute).not.toHaveBeenCalled();
    });

    it("warns, because this differs from a route that resolved to nothing", async () => {
      await resolver.resolve(TRIP_ID, routeWithoutDeparture);

      expect(logger.warn).toHaveBeenCalledWith(
        "Trip has no terminal, so no route cost can be matched",
        { tripId: TRIP_ID },
      );
    });
  });

  describe("logging", () => {
    it("logs identifiers, counts and component codes only", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("cost-1", "component-toll", "TOLL", "1234.56"),
      ]);

      await resolver.resolve(TRIP_ID, ROUTE);

      expect(logger.log).toHaveBeenCalledWith("Route costs resolved", {
        tripId: TRIP_ID,
        routeCostCount: 1,
        components: ["TOLL"],
      });
    });

    it("never logs an amount or a route", async () => {
      routeCostService.findActiveForRoute.mockResolvedValue([
        routeCost("cost-1", "component-toll", "TOLL", "1234.56"),
      ]);

      await resolver.resolve(TRIP_ID, ROUTE);

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("1234.56");
      expect(logged).not.toContain("Rotterdam");
    });
  });

  /**
   * ── A COMBINATION LEG OWNS ITS COSTS ──────────────────────────────────────
   * A leg may run the very road an ordinary route also covers, priced
   * differently. Charging the road's tunnel to the leg would mean one amount for
   * two prices that are deliberately different, so a leg's costs are found by the
   * leg and every other Trip's by the road.
   */
  describe("when the Trip matched a Combination leg", () => {
    const COMBINATION_MATCH = {
      routePricingId: "5a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b",
      basePrice: "100.00",
      kilometres: "25.00",
      kind: "COMBINATION" as const,
    };

    const NORMAL_MATCH = {
      routePricingId: "9c858901-8a57-4791-81fe-4c455b099bc9",
      basePrice: "380.00",
      kilometres: "25.00",
      kind: "NORMAL" as const,
    };

    it("reads the costs owned by that leg", async () => {
      await resolver.resolve(TRIP_ID, ROUTE, COMBINATION_MATCH);

      expect(routeCostService.findActiveForRoutePricing).toHaveBeenCalledWith(
        COMBINATION_MATCH.routePricingId,
      );
    });

    /** The decisive one: the ordinary route's tunnel is never even looked at. */
    it("never reads the road's costs", async () => {
      await resolver.resolve(TRIP_ID, ROUTE, COMBINATION_MATCH);

      expect(routeCostService.findActiveForRoute).not.toHaveBeenCalled();
    });

    it("carries the leg's own amounts to the calculators", async () => {
      routeCostService.findActiveForRoutePricing.mockResolvedValue([
        routeCost("cost-leg", "component-tunnel", "TUNNEL", "3.75"),
      ]);

      expect(
        await resolver.resolve(TRIP_ID, ROUTE, COMBINATION_MATCH),
      ).toEqual([
        {
          routeCostId: "cost-leg",
          pricingComponentId: "component-tunnel",
          componentCode: "TUNNEL",
          amount: "3.75",
        },
      ]);
    });

    it("reads the road's costs for an ordinary match", async () => {
      await resolver.resolve(TRIP_ID, ROUTE, NORMAL_MATCH);

      expect(routeCostService.findActiveForRoute).toHaveBeenCalledWith(
        ROUTE.departure,
        ROUTE.destination,
      );
      expect(routeCostService.findActiveForRoutePricing).not.toHaveBeenCalled();
    });

    /** No match at all is the road, which is how every caller behaved before. */
    it("reads the road's costs when nothing was matched", async () => {
      await resolver.resolve(TRIP_ID, ROUTE, null);

      expect(routeCostService.findActiveForRoute).toHaveBeenCalled();
    });

    it("logs the leg it read, and no amount", async () => {
      routeCostService.findActiveForRoutePricing.mockResolvedValue([
        routeCost("cost-leg", "component-tunnel", "TUNNEL", "1234.56"),
      ]);

      await resolver.resolve(TRIP_ID, ROUTE, COMBINATION_MATCH);

      expect(logger.log).toHaveBeenCalledWith(
        "Combination leg route costs resolved",
        expect.objectContaining({
          tripId: TRIP_ID,
          routePricingId: COMBINATION_MATCH.routePricingId,
          routeCostCount: 1,
        }),
      );
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("1234.56");
    });
  });

  it("calculates nothing and totals nothing", () => {
    const source = RouteCostResolver.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("Decimal");
    expect(source).not.toContain("plus(");
  });
});
