import { listTrips, type ListTripsParams } from "./trips";

/**
 * How many Trips match, without fetching them.
 *
 * THE DATABASE DOES THE COUNTING. One row is requested and only
 * `meta.totalItems` is read, so the figure describes every matching Trip rather
 * than whatever happened to be on the page in view. Counting rendered rows
 * would silently mean "on this page", which on an operations screen is a number
 * someone acts on.
 *
 * It lives beside `trips.ts` rather than inside it because both the Dashboard
 * and Ritten count, and a shared helper keeps that one behaviour in one place.
 */
export async function countTrips(
  params: ListTripsParams = {},
  signal?: AbortSignal,
): Promise<number> {
  const page = await listTrips({ ...params, pageSize: 1 }, signal);

  return page.meta.totalItems;
}
