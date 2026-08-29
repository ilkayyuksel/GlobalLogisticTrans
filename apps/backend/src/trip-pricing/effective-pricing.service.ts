import { Injectable } from "@nestjs/common";

import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { TripPricingRepository } from "./trip-pricing.repository";
import {
  EffectivePricing,
  resolveEffectivePricing,
  type EngineAmount,
  type OverrideAmount,
} from "./effective-pricing";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";

/**
 * The effective pricing of a Trip — the shared source every screen reads.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * The Ritten columns, the Trip detail panel and both Excel exports all need the
 * same four answers: what each component is worth, what Others adds up to, what
 * EK is, and what the Total comes to. Computing that in four places would mean
 * four chances to disagree about money. It is computed here, and they select
 * from the result.
 *
 * The arithmetic itself is in `effective-pricing.ts`, which is pure and knows
 * nothing about the database. This class only fetches what that function needs.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class EffectivePricingService {
  /*
   * REPOSITORIES ONLY, and deliberately so.
   *
   * This service is read-only and it is now on the Trip list's own path, so it
   * must not depend on TripPricingService — that service resolves a Trip
   * through TripService to raise a 404, which would make the Trip module depend
   * on the pricing module while the pricing module already depends on Trip. The
   * cycle is avoided by not creating it: existence is the caller's question,
   * and an unpriced or unknown Trip is the same answer here either way — no
   * pricing.
   */
  constructor(
    /*
     * The REPOSITORY rather than the item service: the response DTO carries a
     * component id and a formatted string, and this layer needs the component
     * CODE and an exact Decimal. Reading the rows avoids parsing back what was
     * just formatted.
     */
    private readonly tripPricingItems: TripPricingItemRepository,
    private readonly overrides: TripPricingOverrideRepository,
    /*
     * Both reads. The repository returns snapshots WITH their lines and
     * component codes in one query, which is what keeps a whole page of Trips
     * off the N+1 path.
     */
    private readonly snapshots: TripPricingRepository,
  ) {}

  /**
   * One Trip's effective breakdown, or null when it has never been priced.
   *
   * Null rather than a zeroed breakdown: a Trip that was never priced and a
   * Trip priced at nothing are different facts, and showing zeros for the first
   * would state the second.
   */
  async findForTrip(tripId: string): Promise<EffectivePricing | null> {
    const snapshot = await this.snapshots.findByTripId(tripId);

    if (!snapshot) {
      return null;
    }

    const [items, overrideRows] = await Promise.all([
      this.tripPricingItems.findByTripPricingId(snapshot.id),
      this.overrides.findForTrip(tripId),
    ]);

    return resolveEffectivePricing(
      items.map(toEngineAmount),
      overrideRows.map(toOverrideAmount),
    );
  }

  /**
   * The effective breakdown of many Trips, in a fixed number of queries.
   *
   * ── WHY THIS EXISTS BESIDE findForTrip ──────────────────────────────────
   * The Ritten list shows a whole page of Trips at once. Calling findForTrip in
   * a loop would issue two queries per row, so a hundred Trips would cost two
   * hundred round trips — the N+1 the list must never produce. This costs TWO
   * queries whatever the page size: the snapshots arrive with their lines and
   * component codes already joined, and every override of every Trip comes back
   * in one IN query.
   *
   * Keyed by Trip id rather than returned as a list, because the caller matches
   * pricing to rows it already holds. A Trip that has never been priced is
   * ABSENT from the map rather than present with zeros — the same distinction
   * findForTrip makes by returning null.
   */
  async findForTrips(
    tripIds: readonly string[],
  ): Promise<Map<string, EffectivePricing>> {
    // No ids is not a query. Prisma would happily send an empty IN list, but
    // asking the database a question with no possible answer is still a round
    // trip.
    if (tripIds.length === 0) {
      return new Map();
    }

    const [snapshots, overrideRows] = await Promise.all([
      this.snapshots.findManyByTripIds(tripIds),
      this.overrides.findForTrips(tripIds),
    ]);

    const overridesByTrip = new Map<string, OverrideAmount[]>();

    for (const row of overrideRows) {
      const existing = overridesByTrip.get(row.tripId) ?? [];

      existing.push(toOverrideAmount(row));
      overridesByTrip.set(row.tripId, existing);
    }

    const byTrip = new Map<string, EffectivePricing>();

    for (const snapshot of snapshots) {
      byTrip.set(
        snapshot.tripId,
        resolveEffectivePricing(
          snapshot.items.map(toEngineAmount),
          overridesByTrip.get(snapshot.tripId) ?? [],
        ),
      );
    }

    return byTrip;
  }
}

/** A stored item, as the pure resolver needs it. */
function toEngineAmount(item: {
  pricingComponent: { code: string };
  amount: EngineAmount["amount"];
  customPropertyId: string | null;
  description: string;
}): EngineAmount {
  return {
    componentCode: item.pricingComponent.code,
    amount: item.amount,
    customPropertyId: item.customPropertyId,
    description: item.description,
  };
}

function toOverrideAmount(row: {
  componentCode: string;
  amount: OverrideAmount["amount"];
}): OverrideAmount {
  return { componentCode: row.componentCode, amount: row.amount };
}
