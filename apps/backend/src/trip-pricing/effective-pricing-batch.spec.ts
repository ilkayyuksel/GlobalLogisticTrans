import { Prisma } from "@prisma/client";

import { EffectivePricingService } from "./effective-pricing.service";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";
import { TripPricingRepository } from "./trip-pricing.repository";
import { NO_REVIEW_STATUS, type RouteReviewRepository } from "./route-review.repository";

/**
 * The batch read the Ritten list depends on.
 *
 * ── WHAT THESE TESTS ARE REALLY ABOUT ───────────────────────────────────────
 * Correctness of the amounts is proved in `effective-pricing.spec.ts`, against
 * the pure resolver. What matters HERE is the shape of the database access: a
 * page of Trips must cost a fixed number of queries, not a number that grows
 * with the page. So the repositories are counted, not just stubbed.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ENGINE_LINES = [
  { code: "BASE_PRICE", amount: "100.00" },
  { code: "FUEL_SURCHARGE", amount: "15.00" },
  { code: "TOLL", amount: "10.00" },
];

function buildSnapshot(tripId: string) {
  return {
    id: `pricing-${tripId}`,
    tripId,
    routeMatch: null,
    routePricingId: null,
    combinationRouteGroupId: null,
    routeLegs: [],
    items: ENGINE_LINES.map((line) => ({
      pricingComponent: { code: line.code },
      amount: new Prisma.Decimal(line.amount),
      customPropertyId: null,
      description: line.code,
    })),
  };
}

function tripIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `trip-${index + 1}`);
}

describe("EffectivePricingService.findForTrips", () => {
  let service: EffectivePricingService;
  let findCurrentByTripIds: jest.Mock;
  let findOverridesForTrips: jest.Mock;
  let findReviewStatus: jest.Mock;

  beforeEach(() => {
    findCurrentByTripIds = jest
      .fn()
      .mockImplementation((ids: readonly string[]) =>
        Promise.resolve(ids.map(buildSnapshot)),
      );
    findOverridesForTrips = jest.fn().mockResolvedValue([]);
    findReviewStatus = jest.fn().mockResolvedValue(NO_REVIEW_STATUS);

    service = new EffectivePricingService(
      {
        findForTrips: findOverridesForTrips,
        findForTrip: jest.fn().mockResolvedValue([]),
      } as unknown as TripPricingOverrideRepository,
      {
        findCurrentByTripIds,
      } as unknown as TripPricingRepository,
      { findReviewStatus } as unknown as RouteReviewRepository,
    );
  });

  describe("the number of queries does not grow with the page", () => {
    it.each([1, 2, 20, 100])("uses three reads for %i Trips", async (count) => {
      await service.findForTrips(tripIds(count));

      expect(findCurrentByTripIds).toHaveBeenCalledTimes(1);
      expect(findOverridesForTrips).toHaveBeenCalledTimes(1);
      expect(findReviewStatus).toHaveBeenCalledTimes(1);
    });

    it.each([1, 2, 20, 100])("prices all %i Trips", async (count) => {
      const result = await service.findForTrips(tripIds(count));

      expect(result.size).toBe(count);
    });

    /** Both queries receive every id at once, rather than one id at a time. */
    it("passes the whole page to each query", async () => {
      const ids = tripIds(100);

      await service.findForTrips(ids);

      expect(findCurrentByTripIds).toHaveBeenCalledWith(ids);
      expect(findOverridesForTrips).toHaveBeenCalledWith(ids);
    });
  });

  /** Asking the database a question with no possible answer is still a round trip. */
  it("queries nothing for an empty list", async () => {
    const result = await service.findForTrips([]);

    expect(result.size).toBe(0);
    expect(findCurrentByTripIds).not.toHaveBeenCalled();
    expect(findOverridesForTrips).not.toHaveBeenCalled();
  });

  it("keys the result by Trip id", async () => {
    const result = await service.findForTrips(["trip-1", "trip-2"]);

    expect([...result.keys()].sort()).toEqual(["trip-1", "trip-2"]);
    expect(result.get("trip-1")?.tarief.toFixed(2)).toBe("100.00");
  });

  /**
   * A caller that repeats an id gets one entry, not a corrupted one. The map
   * makes this true by construction, which is the reason for a map.
   */
  it("handles a duplicated Trip id safely", async () => {
    const result = await service.findForTrips(["trip-1", "trip-1"]);

    expect(result.size).toBe(1);
    expect(result.get("trip-1")?.tarief.toFixed(2)).toBe("100.00");
  });

  /**
   * Absent rather than zeroed: a Trip that was never priced and a Trip priced
   * at nothing are different facts, and the list must be able to tell them
   * apart. The same distinction findForTrip makes by returning null.
   */
  it("omits a Trip that has never been priced", async () => {
    findCurrentByTripIds.mockResolvedValue([buildSnapshot("trip-1")]);

    const result = await service.findForTrips(["trip-1", "trip-2"]);

    expect(result.has("trip-1")).toBe(true);
    expect(result.has("trip-2")).toBe(false);
  });

  describe("overrides", () => {
    it("applies each Trip's own correction and nobody else's", async () => {
      findOverridesForTrips.mockResolvedValue([
        {
          tripId: "trip-1",
          componentCode: "BASE_PRICE",
          amount: new Prisma.Decimal("120.00"),
        },
      ]);

      const result = await service.findForTrips(["trip-1", "trip-2"]);

      expect(result.get("trip-1")?.tarief.toFixed(2)).toBe("120.00");
      // Fuel follows the corrected Tarief at the snapshot's own 15%.
      expect(result.get("trip-1")?.brandstof.toFixed(2)).toBe("18.00");

      expect(result.get("trip-2")?.tarief.toFixed(2)).toBe("100.00");
      expect(result.get("trip-2")?.brandstof.toFixed(2)).toBe("15.00");
    });

    it("applies several corrections to the same Trip", async () => {
      findOverridesForTrips.mockResolvedValue([
        {
          tripId: "trip-1",
          componentCode: "BASE_PRICE",
          amount: new Prisma.Decimal("120.00"),
        },
        {
          tripId: "trip-1",
          componentCode: "TOLL",
          amount: new Prisma.Decimal("30.00"),
        },
      ]);

      const pricing = (await service.findForTrips(["trip-1"])).get("trip-1");

      expect(pricing?.tarief.toFixed(2)).toBe("120.00");
      expect(pricing?.tol.toFixed(2)).toBe("30.00");
      // 120.00 + 18.00 + 30.00, with no other component on this snapshot.
      expect(pricing?.totaal.toFixed(2)).toBe("168.00");
    });

    it("gives the same answer as the single-Trip read", async () => {
      findOverridesForTrips.mockResolvedValue([
        {
          tripId: "trip-1",
          componentCode: "TOLL",
          amount: new Prisma.Decimal("30.00"),
        },
      ]);

      const batched = (await service.findForTrips(["trip-1"])).get("trip-1");

      expect(batched?.tarief.toFixed(2)).toBe("100.00");
      expect(batched?.brandstof.toFixed(2)).toBe("15.00");
      expect(batched?.tol.toFixed(2)).toBe("30.00");
      expect(batched?.totaal.toFixed(2)).toBe("145.00");
    });
  });

  /**
   * ── THE PRICE CHECK OF THE ROUTE THAT PRICED THE TRIP ─────────────────────
   * The Routeprijzen page's own `reviewed` mark, read live by the ids the
   * snapshot recorded — the group's mark for a Combination — and never a copy.
   */
  describe("the review mark of the route that priced a Trip", () => {
    function pricedOn(tripId: string, routePricingId: string | null, combinationRouteGroupId: string | null = null) {
      return { ...buildSnapshot(tripId), routeMatch: routePricingId ? "EXACT" : "NOT_FOUND", routePricingId, combinationRouteGroupId };
    }

    it("reads every priced route and Combination at once, by the recorded ids", async () => {
      findCurrentByTripIds.mockResolvedValue([
        pricedOn("trip-1", "route-1"),
        pricedOn("trip-2", "route-1"),
        pricedOn("trip-3", "leg-2", "combination-1"),
        pricedOn("trip-4", null),
      ]);

      await service.findForTrips(["trip-1", "trip-2", "trip-3", "trip-4"]);

      // A leg is never looked up as a route of its own: its group is.
      expect(findReviewStatus).toHaveBeenCalledWith(["route-1"], ["combination-1"]);
    });

    it("follows the mark in both directions", async () => {
      findCurrentByTripIds.mockResolvedValue([pricedOn("trip-1", "route-1"), pricedOn("trip-2", "route-2")]);
      findReviewStatus.mockResolvedValue({
        routes: new Map([
          ["route-1", false],
          ["route-2", true],
        ]),
        combinations: new Map(),
      });

      const result = await service.findForTrips(["trip-1", "trip-2"]);

      expect(result.get("trip-1")?.routeMatch.reviewed).toBe(false);
      expect(result.get("trip-2")?.routeMatch.reviewed).toBe(true);
    });

    it("gives a Combination's Trip the Combination's mark", async () => {
      findCurrentByTripIds.mockResolvedValue([pricedOn("trip-1", "leg-2", "combination-1")]);
      findReviewStatus.mockResolvedValue({
        routes: new Map([["leg-2", true]]),
        combinations: new Map([["combination-1", false]]),
      });

      expect((await service.findForTrips(["trip-1"])).get("trip-1")?.routeMatch.reviewed).toBe(false);
    });

    /** Not a route to check: nothing matched, or the configuration is gone. */
    it("says nothing for a Trip priced on no route, or on one since removed", async () => {
      findCurrentByTripIds.mockResolvedValue([pricedOn("trip-1", null), pricedOn("trip-2", "removed-route")]);

      const result = await service.findForTrips(["trip-1", "trip-2"]);

      expect(result.get("trip-1")?.routeMatch.reviewed).toBeNull();
      expect(result.get("trip-2")?.routeMatch.reviewed).toBeNull();
    });

    it("reads the mark for the single-Trip read too", async () => {
      findCurrentByTripIds.mockResolvedValue([pricedOn("trip-1", "route-1")]);
      findReviewStatus.mockResolvedValue({ routes: new Map([["route-1", false]]), combinations: new Map() });

      expect((await service.findForTrip("trip-1"))?.routeMatch.reviewed).toBe(false);
    });
  });
});
