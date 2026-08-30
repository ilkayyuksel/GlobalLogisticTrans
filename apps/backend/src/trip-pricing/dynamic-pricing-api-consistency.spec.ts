import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingEngineService } from "../pricing-engine/pricing-engine.service";
import { PricingRecalculationService } from "../pricing-engine/pricing-recalculation.service";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { toEffectivePricingDto } from "./dto/effective-pricing.dto";
import { EffectivePricingService } from "./effective-pricing.service";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";
import { TripPricingRepository } from "./trip-pricing.repository";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_TRIP_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

/**
 * What a mutation answers and what the Ritten list shows are the same figures.
 *
 * ── WHY THIS NEEDS ITS OWN SUITE ────────────────────────────────────────────
 * A dynamic-pricing write recalculates and returns the Trip's breakdown, and
 * the Ritten row updates from that response WITHOUT refetching the list. So the
 * screen now believes an answer it will not confirm until the next load — and
 * if the two reads could disagree, the disagreement would sit on screen
 * unnoticed until something else happened to refresh the page.
 *
 * They cannot disagree, and this proves why: both go through
 * EffectivePricingService, which applies one resolver to one stored snapshot.
 * The mutation asks for one Trip and the list asks for a page, but the answer
 * per Trip is produced by the same code — so the assertion is equality of the
 * two DTOs, not equality of two hand-written expectations.
 *
 * The service is REAL here. Only the three repositories are doubles, standing
 * in for the rows the Engine wrote.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ENGINE_LINES = [
  { code: "BASE_PRICE", amount: "520.00" },
  { code: "FUEL_SURCHARGE", amount: "78.00" },
  { code: "TOLL", amount: "18.00" },
  { code: "WAITING_TIME", amount: "60.00" },
  { code: "CUSTOM_PROPERTY", amount: "100.00" },
  { code: "COST_CONFIRMATION", amount: "165.00" },
];

function buildItems(lines: readonly { code: string; amount: string }[]) {
  return lines.map((line) => ({
    pricingComponent: { code: line.code },
    amount: new Prisma.Decimal(line.amount),
    customPropertyId: null,
    description: line.code,
  }));
}

describe("a mutation's pricing equals the Ritten list's pricing", () => {
  let effectivePricing: EffectivePricingService;
  let recalculation: PricingRecalculationService;
  let overrideRows: { tripId: string; componentCode: string; amount: Prisma.Decimal }[];

  beforeEach(() => {
    overrideRows = [];

    const snapshotOf = (tripId: string) => ({
      id: `pricing-${tripId}`,
      tripId,
      items: buildItems(ENGINE_LINES),
    });

    effectivePricing = new EffectivePricingService(
      {
        findByTripPricingId: jest
          .fn()
          .mockResolvedValue(buildItems(ENGINE_LINES)),
      } as unknown as TripPricingItemRepository,
      {
        findForTrip: jest.fn((tripId: string) =>
          Promise.resolve(overrideRows.filter((row) => row.tripId === tripId)),
        ),
        findForTrips: jest.fn((ids: readonly string[]) =>
          Promise.resolve(overrideRows.filter((row) => ids.includes(row.tripId))),
        ),
      } as unknown as TripPricingOverrideRepository,
      {
        findByTripId: jest.fn((tripId: string) =>
          Promise.resolve(snapshotOf(tripId)),
        ),
        findManyByTripIds: jest.fn((ids: readonly string[]) =>
          Promise.resolve(ids.map(snapshotOf)),
        ),
      } as unknown as TripPricingRepository,
    );

    recalculation = new PricingRecalculationService(
      {
        calculateAndStore: jest.fn().mockResolvedValue({
          tripId: TRIP_ID,
          isReprocess: true,
          lines: [],
          calculationStatus: "CALCULATED",
        }),
      } as unknown as PricingEngineService,
      effectivePricing,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  /** What the Ritten list would show for a Trip on the next load. */
  async function listPricingOf(tripId: string) {
    const byTrip = await effectivePricing.findForTrips([tripId, OTHER_TRIP_ID]);

    return toEffectivePricingDto(byTrip.get(tripId) as never);
  }

  it("answers the same eight amounts a later list read would", async () => {
    const { pricing } = await recalculation.recalculate(TRIP_ID);

    expect(pricing).toEqual(await listPricingOf(TRIP_ID));
  });

  it("answers the same per-component detail too", async () => {
    const { pricing } = await recalculation.recalculate(TRIP_ID);
    const fromList = await listPricingOf(TRIP_ID);

    expect(pricing?.components).toEqual(fromList.components);
  });

  /**
   * A correction lives in its own table and is applied on top at READ time, so
   * both paths must apply it — and both must derive Brandstof from the
   * corrected Tarief rather than from the Engine's own.
   */
  it("agrees with the list when the Tarief was corrected by hand", async () => {
    overrideRows.push({
      tripId: TRIP_ID,
      componentCode: "BASE_PRICE",
      amount: new Prisma.Decimal("620.00"),
    });

    const { pricing } = await recalculation.recalculate(TRIP_ID);

    expect(pricing?.tarief).toBe("620.00");
    // 78 / 520 is 15%, applied to the corrected 620.
    expect(pricing?.brandstof).toBe("93.00");
    expect(pricing).toEqual(await listPricingOf(TRIP_ID));
  });

  /**
   * ── ONLY THE TRIP THAT CHANGED ──────────────────────────────────────────
   * The Ritten list reads a whole page, so a correction leaking between rows
   * would be invisible in a single-Trip test and expensive in production.
   */
  it("leaves the other Trip on the page untouched", async () => {
    overrideRows.push({
      tripId: TRIP_ID,
      componentCode: "BASE_PRICE",
      amount: new Prisma.Decimal("620.00"),
    });

    await recalculation.recalculate(TRIP_ID);

    expect((await listPricingOf(OTHER_TRIP_ID)).tarief).toBe("520.00");
  });

  /**
   * ── AND THE LIST STILL COSTS A FIXED NUMBER OF QUERIES ──────────────────
   * The row-local update exists so the list is NOT refetched after a write. The
   * list itself keeps its batched read: two queries for a page, whatever the
   * page holds.
   */
  it("still reads a whole page in two queries", async () => {
    const snapshots = effectivePricing["snapshots"] as unknown as {
      findManyByTripIds: jest.Mock;
      findByTripId: jest.Mock;
    };
    const overrides = effectivePricing["overrides"] as unknown as {
      findForTrips: jest.Mock;
    };

    await effectivePricing.findForTrips(
      Array.from({ length: 50 }, (_, index) => `trip-${index}`),
    );

    expect(snapshots.findManyByTripIds).toHaveBeenCalledTimes(1);
    expect(overrides.findForTrips).toHaveBeenCalledTimes(1);
    expect(snapshots.findByTripId).not.toHaveBeenCalled();
  });
});
