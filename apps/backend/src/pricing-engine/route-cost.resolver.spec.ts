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
  let routeCostService: { findActiveForRoute: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let resolver: RouteCostResolver;

  beforeEach(() => {
    routeCostService = { findActiveForRoute: jest.fn().mockResolvedValue([]) };
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

  it("calculates nothing and totals nothing", () => {
    const source = RouteCostResolver.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("Decimal");
    expect(source).not.toContain("plus(");
  });
});
