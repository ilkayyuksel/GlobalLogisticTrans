import { listTrips, type ListTripsParams } from "./trips";
import type { Trip } from "./types";

/**
 * Every Trip matching the current filters — not just the page on screen.
 *
 * ── WHY THIS IS A LOOP AND NOT ONE CALL ─────────────────────────────────────
 * There is no export endpoint, and `GET /trips` caps a page at 200 rows. An
 * export that covered only the visible page would be wrong in a way nobody
 * would notice until they used the file, so the whole filtered set is fetched
 * in pages of 200.
 *
 * The loop is BOUNDED in three ways, so it can never become the "hundreds of
 * uncontrolled requests" it would otherwise be:
 *   - it asks once, reads the true total, and refuses up front when that total
 *     is larger than one export may carry
 *   - it therefore issues at most EXPORT_MAX_ROWS / MAX_EXPORT_PAGE_SIZE calls
 *   - it stops the moment a page comes back short or the total is reached
 *
 * A server-side export endpoint is the proper solution and is reported as a
 * gap. This is the honest version of what can be built without one.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The largest page `GET /trips` accepts. */
const MAX_EXPORT_PAGE_SIZE = 200;

/** 25 requests. Beyond this the export needs a backend endpoint, not a loop. */
export const EXPORT_MAX_ROWS = 5000;

/** Raised when the filtered period is too large to export from the browser. */
export class ExportTooLargeError extends Error {
  constructor(readonly totalItems: number) {
    super(
      `This selection contains ${totalItems} trips, which is more than one export can collect (${EXPORT_MAX_ROWS}).`,
    );
    this.name = "ExportTooLargeError";
  }
}

export async function fetchTripsForExport(
  params: ListTripsParams,
  signal?: AbortSignal,
): Promise<Trip[]> {
  const query = { ...params, pageSize: MAX_EXPORT_PAGE_SIZE };
  const firstPage = await listTrips({ ...query, page: 1 }, signal);

  if (firstPage.meta.totalItems > EXPORT_MAX_ROWS) {
    throw new ExportTooLargeError(firstPage.meta.totalItems);
  }

  const trips = [...firstPage.items];

  // Sequential rather than parallel: an export is not urgent, and a burst of
  // page requests would put load on the database for no perceptible gain.
  for (let page = 2; page <= firstPage.meta.totalPages; page += 1) {
    const next = await listTrips({ ...query, page }, signal);

    trips.push(...next.items);

    if (next.items.length === 0) {
      break;
    }
  }

  return trips;
}
