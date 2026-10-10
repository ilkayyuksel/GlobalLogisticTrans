import { request } from "./client";
import type { PricingSnapshot } from "./types";

/**
 * The pricing endpoints.
 *
 * Every amount returned here is a preformatted string and is displayed exactly
 * as received. Nothing in this module — or anywhere on this side — adds,
 * multiplies or rounds money. The Pricing Engine calculated the snapshot and
 * the stored total is the answer.
 */

const PRICING_PATH = "/api/v1/trip-pricing";

/**
 * Recalculates a Trip's pricing and returns the newly stored snapshot — its
 * header, lines and the route it was matched to, read back from storage in the
 * same shape `getPricingSnapshot` returns.
 *
 * The Trip must be CLOSED; the backend enforces that and reports a conflict
 * otherwise. This also produces the FIRST snapshot for a CLOSED Trip that has
 * none, which is how a Trip is recovered after a failed automatic calculation.
 */
export function reprocessTripPricing(
  tripId: string,
  signal?: AbortSignal,
): Promise<PricingSnapshot> {
  return request<PricingSnapshot>(`${PRICING_PATH}/trip/${tripId}/reprocess`, {
    method: "POST",
    signal,
  });
}

/** The largest number of Trips one snapshots request may ask about. */
const MAX_SNAPSHOT_TRIP_IDS = 100;

/**
 * The stored pricing of many Trips, for an export.
 *
 * ── WHY IN BATCHES ─────────────────────────────────────────────────────────
 * One request per Trip would make an export of a month hundreds of round
 * trips for one file, so this asks the backend's bulk read in batches — one
 * request per hundred Trips, each returning the snapshots WITH their lines.
 *
 * Trips with no snapshot are simply absent from the answer, so the map returned
 * here has no entry for them. That is the honest shape: an unpriced Trip has no
 * pricing, which is different from a pricing of zero.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Reading pricing never causes a Trip to be priced.
 */
export async function fetchPricingSnapshots(
  tripIds: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, PricingSnapshot>> {
  const byTripId = new Map<string, PricingSnapshot>();

  for (let start = 0; start < tripIds.length; start += MAX_SNAPSHOT_TRIP_IDS) {
    const batch = tripIds.slice(start, start + MAX_SNAPSHOT_TRIP_IDS);

    if (batch.length === 0) {
      break;
    }

    const snapshots = await request<PricingSnapshot[]>(
      `${PRICING_PATH}/snapshots`,
      { query: { tripIds: batch.join(",") }, signal },
    );

    for (const snapshot of snapshots) {
      byTripId.set(snapshot.pricing.tripId, snapshot);
    }
  }

  return byTripId;
}

/**
 * The current snapshot of a Trip — header, lines and matched route — or null
 * when it has none (never priced, or not CLOSED).
 *
 * ONE request, through the bulk read: the backend reads the three in one
 * consistent read, so the route shown always belongs to the amounts shown. Two
 * requests could straddle a recalculation and pair one calculation's route
 * with another's lines.
 */
export async function getPricingSnapshot(
  tripId: string,
  signal?: AbortSignal,
): Promise<PricingSnapshot | null> {
  const snapshots = await request<PricingSnapshot[]>(`${PRICING_PATH}/snapshots`, {
    query: { tripIds: tripId },
    signal,
  });

  return snapshots.find((snapshot) => snapshot.pricing.tripId === tripId) ?? null;
}
