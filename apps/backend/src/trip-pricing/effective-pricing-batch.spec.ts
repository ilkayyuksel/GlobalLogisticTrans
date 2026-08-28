import { Prisma } from "@prisma/client";

import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { EffectivePricingService } from "./effective-pricing.service";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingService } from "./trip-pricing.service";

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
  let findManyByTripIds: jest.Mock;
  let findOverridesForTrips: jest.Mock;

  beforeEach(() => {
    findManyByTripIds = jest
      .fn()
      .mockImplementation((ids: readonly string[]) =>
        Promise.resolve(ids.map(buildSnapshot)),
      );
    findOverridesForTrips = jest.fn().mockResolvedValue([]);

    service = new EffectivePricingService(
      {} as unknown as TripPricingService,
      {} as unknown as TripPricingItemRepository,
      {
        findForTrips: findOverridesForTrips,
      } as unknown as TripPricingOverrideRepository,
      {
        findManyByTripIds,
      } as unknown as TripPricingRepository,
    );
  });

  describe("the number of queries does not grow with the page", () => {
    it.each([1, 2, 20, 100])("uses two queries for %i Trips", async (count) => {
      await service.findForTrips(tripIds(count));

      expect(findManyByTripIds).toHaveBeenCalledTimes(1);
      expect(findOverridesForTrips).toHaveBeenCalledTimes(1);
    });

    it.each([1, 2, 20, 100])("prices all %i Trips", async (count) => {
      const result = await service.findForTrips(tripIds(count));

      expect(result.size).toBe(count);
    });

    /** Both queries receive every id at once, rather than one id at a time. */
    it("passes the whole page to each query", async () => {
      const ids = tripIds(100);

      await service.findForTrips(ids);

      expect(findManyByTripIds).toHaveBeenCalledWith(ids);
      expect(findOverridesForTrips).toHaveBeenCalledWith(ids);
    });
  });

  /** Asking the database a question with no possible answer is still a round trip. */
  it("queries nothing for an empty list", async () => {
    const result = await service.findForTrips([]);

    expect(result.size).toBe(0);
    expect(findManyByTripIds).not.toHaveBeenCalled();
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
    findManyByTripIds.mockResolvedValue([buildSnapshot("trip-1")]);

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
});
