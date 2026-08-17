import { request } from "./client";
import type { PricingSnapshot, TripPricing, TripPricingItem } from "./types";

/**
 * The pricing endpoints.
 *
 * Every amount returned here is a preformatted string and is displayed exactly
 * as received. Nothing in this module — or anywhere on this side — adds,
 * multiplies or rounds money. The Pricing Engine calculated the snapshot and
 * the stored total is the answer.
 */

const PRICING_PATH = "/api/v1/trip-pricing";
const PRICING_ITEMS_PATH = "/api/v1/trip-pricing-items";

/**
 * The snapshot of a Trip, or null when it has none.
 *
 * Null is an ordinary state, not an error: a Trip that has never been closed
 * has never been priced. The backend returns null rather than a 404 precisely
 * so this distinction survives.
 */
export function getTripPricing(
  tripId: string,
  signal?: AbortSignal,
): Promise<TripPricing | null> {
  return request<TripPricing | null>(`${PRICING_PATH}/trip/${tripId}`, {
    signal,
  });
}

/** The lines of a snapshot. The backend returns them in calculation order. */
export async function listPricingItems(
  tripPricingId: string,
  signal?: AbortSignal,
): Promise<TripPricingItem[]> {
  const response = await request<{ items: TripPricingItem[] }>(
    `${PRICING_ITEMS_PATH}/trip-pricing/${tripPricingId}`,
    { signal },
  );

  return response.items;
}

/**
 * Recalculates a Trip's pricing and returns the newly stored snapshot.
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
 * `getPricingSnapshot` costs two requests per Trip. An export of a month would
 * be hundreds of round trips for one file, so this asks the backend's bulk read
 * instead — one request per hundred Trips, each returning the snapshots WITH
 * their lines.
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
 * A Trip's complete pricing, in one call for the caller.
 *
 * The two requests are sequential because the second needs the snapshot's id.
 * When there is no snapshot there are no items to ask for, so nothing further
 * is fetched.
 */
export async function getPricingSnapshot(
  tripId: string,
  signal?: AbortSignal,
): Promise<PricingSnapshot | null> {
  const pricing = await getTripPricing(tripId, signal);

  if (!pricing) {
    return null;
  }

  return { pricing, items: await listPricingItems(pricing.id, signal) };
}
