import { listTrips, type ListTripsParams } from "./trips";
import type { Paginated, Trip } from "./types";

/**
 * Collecting every Trip a filter matches, not merely the first page of them.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Two screens need a WHOLE result set rather than a page: the Excel export,
 * which would otherwise write a file describing only what was on screen, and
 * the Week and Month views, whose day headings promise a whole period.
 *
 * The second one was a real bug. A week of 142 Trips came back as page one of
 * two, the sections were built from those 100 rows, and Monday — which sorts
 * LAST, because the backend orders `planningDate` descending — rendered empty
 * while the counters above it said 142. A day of work simply vanished.
 *
 * ── ONE IMPLEMENTATION, TWO CALLERS ─────────────────────────────────────────
 * The export had solved this first. Rather than write a second paging loop for
 * the period views — which would eventually disagree with this one about a
 * boundary, a limit or an empty page — the loop lives here and both callers use
 * it.
 *
 * ── BOUNDED, ALWAYS ─────────────────────────────────────────────────────────
 * It asks once, reads the TRUE total, and refuses up front when that total is
 * larger than the caller allows. So the number of requests is known before the
 * first page is even read, and this can never become an uncontrolled crawl.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The largest page `GET /trips` accepts. One request covers 200 Trips. */
export const TRIP_PAGE_SIZE = 200;

/**
 * The most Trips one screen or one file may collect: 25 requests.
 *
 * Beyond this the answer is a backend endpoint, not a longer loop — so the
 * caller is refused rather than left waiting, and the refusal says so.
 */
export const TRIP_FETCH_MAX_ROWS = 5000;

/** Raised when the filtered set is too large to collect from the browser. */
export class TooManyTripsError extends Error {
  constructor(
    readonly totalItems: number,
    readonly limit: number,
  ) {
    super(
      `This selection contains ${totalItems} trips, which is more than one request may collect (${limit}).`,
    );
    this.name = "TooManyTripsError";
  }
}

/**
 * Every Trip matching `params`, in the backend's own order.
 *
 * ── SEQUENTIAL, NOT PARALLEL ────────────────────────────────────────────────
 * A burst of page requests would put the whole period on the database at once
 * for no perceptible gain — the second page is not needed until the first has
 * been read. Sequential also means a failure stops the loop rather than
 * arriving alongside three others.
 *
 * ── AND IT NEVER RETURNS A PARTIAL SET QUIETLY ──────────────────────────────
 * A page that fails REJECTS. Returning what had been collected so far would
 * hand the caller an incomplete period that looks exactly like a complete one,
 * which is the bug this module exists to end rather than to relocate.
 */
export async function collectTrips(
  params: ListTripsParams,
  limit: number,
  signal?: AbortSignal,
): Promise<Trip[]> {
  const query = { ...params, pageSize: TRIP_PAGE_SIZE };
  const firstPage = await listTrips({ ...query, page: 1 }, signal);

  if (firstPage.meta.totalItems > limit) {
    throw new TooManyTripsError(firstPage.meta.totalItems, limit);
  }

  const trips = [...firstPage.items];

  for (let page = 2; page <= firstPage.meta.totalPages; page += 1) {
    const next = await listTrips({ ...query, page }, signal);

    trips.push(...next.items);

    // A short page means the result shrank under us — another operator closing
    // a Trip, say. Stopping is right; looping to a fixed page count would spin.
    if (next.items.length === 0) {
      break;
    }
  }

  return trips;
}

/**
 * A whole period, shaped like a page so the list can render it unchanged.
 *
 * ── WHY IT PRETENDS TO BE ONE PAGE ──────────────────────────────────────────
 * Everything downstream — the sections, the pagination control, the truncation
 * notice — already reads `Paginated<Trip>`. Handing it a single page that
 * happens to hold the entire period means none of them needs to learn about
 * multi-page loading, and the notice stops firing for exactly the right reason:
 * `totalPages` is genuinely 1, because everything really is here.
 *
 * `pageSize` reports the true total rather than 200, so the metadata describes
 * what was actually delivered instead of how it was fetched.
 */
export async function fetchPeriodTrips(
  params: ListTripsParams,
  signal?: AbortSignal,
): Promise<Paginated<Trip>> {
  const items = await collectTrips(params, TRIP_FETCH_MAX_ROWS, signal);

  return {
    items,
    meta: {
      page: 1,
      pageSize: Math.max(items.length, 1),
      totalItems: items.length,
      totalPages: 1,
    },
  };
}
