import {
  TRIP_FETCH_MAX_ROWS,
  TooManyTripsError,
  collectTrips,
} from "./trip-pages";
import type { ListTripsParams } from "./trips";
import type { Trip } from "./types";

/**
 * Every Trip matching the current filters — not just the page on screen.
 *
 * ── THE PAGING ITSELF LIVES IN `trip-pages.ts` ──────────────────────────────
 * It used to live here, and then the Week and Month views turned out to need
 * exactly the same thing: a whole result set rather than a page. Rather than
 * grow a second loop that would eventually disagree with this one about a
 * boundary or a limit, the loop moved to a shared module and this became what
 * it always was — the export's name for it, with the export's own error.
 *
 * A server-side export endpoint is still the proper solution and is still
 * reported as a gap. This is the honest version of what can be built without
 * one.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Kept as the export's own name for the shared limit. */
export const EXPORT_MAX_ROWS = TRIP_FETCH_MAX_ROWS;

/**
 * Raised when the filtered period is too large to export from the browser.
 *
 * Its own type because the Ritten page shows a different sentence for an export
 * that is too large than for a period that is too large to display, and the two
 * must stay tellable apart.
 */
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
  try {
    return await collectTrips(params, EXPORT_MAX_ROWS, signal);
  } catch (error: unknown) {
    // Translated at the boundary, so the export keeps saying "export" while the
    // shared collector stays neutral about who called it.
    if (error instanceof TooManyTripsError) {
      throw new ExportTooLargeError(error.totalItems);
    }

    throw error;
  }
}
