import type { Trip } from "@/lib/api/types";

/**
 * The order the legs of a Combination are READ IN, which is not the order they
 * are stored in.
 *
 * ── DISPLAY ONLY ────────────────────────────────────────────────────────────
 * The backend returns a Combination's Trips in its own order and must keep
 * doing so: import order, export order, pricing order and the Trips' own ids
 * all stay exactly as they are. This is a presentation rule and it lives here,
 * beside the dialog that uses it — nothing persists it, and a refresh fetches
 * the ordinary data and applies it again.
 *
 * ── DUB BEFORE ANR ──────────────────────────────────────────────────────────
 * An operator reads a Combination in the direction the containers travel, and
 * the booking prefix says which half is which. So a DUB leg is shown first and
 * an ANR leg second, however the two arrived.
 *
 * This is NOT an alphabetical sort. Sorting the whole list alphabetically would
 * reorder bookings the rule says nothing about, and their order carries meaning
 * this module has no business overriding. Only the two known prefixes move;
 * everything else keeps the position it came in with.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Lower comes first. Anything unrecognised sits between them, undisturbed. */
const RANK_BY_PREFIX = { DUB: 0, ANR: 2 } as const;

/** Where a booking with neither prefix sits: between DUB and ANR, in place. */
const UNRANKED = 1;

function rankOf(trip: Trip): number {
  const booking = trip.bookingNumber?.trim().toUpperCase() ?? "";

  for (const [prefix, rank] of Object.entries(RANK_BY_PREFIX)) {
    if (booking.startsWith(prefix)) {
      return rank;
    }
  }

  return UNRANKED;
}

/**
 * A NEW array, ordered for display. The input is never mutated — it is the
 * fetched response, and other views read the same objects.
 *
 * `Array.prototype.sort` is stable in every engine this runs on, so two DUB
 * legs, two ANR legs, or two unrecognised bookings keep the relative order the
 * backend gave them.
 */
export function toGroupDisplayOrder(trips: readonly Trip[]): Trip[] {
  return [...trips].sort((left, right) => rankOf(left) - rankOf(right));
}
