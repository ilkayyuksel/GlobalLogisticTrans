import { countTrips } from "./trip-counts";
import type { ListTripsParams } from "./trips";

/**
 * The figures above the Ritten list.
 *
 * They describe the selected period and every active filter EXCEPT the status
 * one: the counters are how a planner switches between Open, Afgewerkt,
 * Geannuleerd and Totaal, so counting them under the current status would make
 * the others read zero as soon as one was chosen.
 *
 * ── WHY GEANNULEERD IS COUNTED ──────────────────────────────────────────────
 * Because the total includes it. "18 open, 0 afgewerkt, 19 totaal" reads as a
 * broken filter; "18 open, 0 afgewerkt, 1 geannuleerd, 19 totaal" reads as the
 * arithmetic it is. The missing counter is what made Alles look like it was
 * hiding rows rather than including one more.
 *
 * Four small parallel requests, each returning a single row and a total. The
 * payloads do not grow with the dataset, and no figure is ever derived from the
 * rows on screen.
 */

export interface RittenCounts {
  open: number;
  closed: number;
  /**
   * Cancelled Trips in the period.
   *
   * Counted because the total includes them: without it the three figures do
   * not add up and the filter looks wrong.
   */
  cancelled: number;
  /** Every status the backend shows by default — DELETED stays hidden. */
  total: number;
}

export async function getRittenCounts(
  params: ListTripsParams,
  signal?: AbortSignal,
): Promise<RittenCounts> {
  const { status: _ignoredStatus, page: _ignoredPage, ...scope } = params;

  const [open, closed, cancelled, total] = await Promise.all([
    countTrips({ ...scope, status: "OPEN" }, signal),
    countTrips({ ...scope, status: "CLOSED" }, signal),
    countTrips({ ...scope, status: "CANCELLED" }, signal),
    countTrips(scope, signal),
  ]);

  return { open, closed, cancelled, total };
}
