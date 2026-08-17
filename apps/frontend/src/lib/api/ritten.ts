import { countTrips } from "./trip-counts";
import type { ListTripsParams } from "./trips";

/**
 * The three figures above the Ritten list.
 *
 * They describe the selected period and every active filter EXCEPT the status
 * one: the counters are how a planner switches between Open, Afgewerkt and
 * Totaal, so counting them under the current status would make two of the three
 * read zero as soon as one was chosen.
 *
 * Three small parallel requests, each returning a single row and a total. The
 * payloads do not grow with the dataset, and no figure is ever derived from the
 * rows on screen.
 */

export interface RittenCounts {
  open: number;
  closed: number;
  /** Every status the backend shows by default — DELETED stays hidden. */
  total: number;
}

export async function getRittenCounts(
  params: ListTripsParams,
  signal?: AbortSignal,
): Promise<RittenCounts> {
  const { status: _ignoredStatus, page: _ignoredPage, ...scope } = params;

  const [open, closed, total] = await Promise.all([
    countTrips({ ...scope, status: "OPEN" }, signal),
    countTrips({ ...scope, status: "CLOSED" }, signal),
    countTrips(scope, signal),
  ]);

  return { open, closed, total };
}
