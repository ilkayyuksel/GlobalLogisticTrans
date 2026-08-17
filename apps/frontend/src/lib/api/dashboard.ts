import { countTrips } from "./trip-counts";
import { listTrips } from "./trips";
import type { Trip } from "./types";
import { endOfWeek, startOfWeek, today } from "@/lib/calendar/calendar-dates";

/**
 * The figures the Dashboard shows.
 *
 * EVERY NUMBER HERE COMES FROM THE BACKEND. Each count is `meta.totalItems` on
 * a filtered Trip query with `pageSize=1` — the database counts the rows and
 * the browser reads the answer. Nothing is tallied client-side, so the figures
 * describe the whole dataset rather than whatever happened to be on one page.
 *
 * The statistics the backend cannot answer are absent from this module
 * entirely, rather than being approximated here:
 *
 *   - average waiting time: no aggregation endpoint exists, and computing it
 *     would mean downloading every Trip to average one column
 *   - maintenance warnings: no maintenance API exists
 *   - today's calendar: no calendar API exists
 *   - top terminals / plates: no aggregation endpoint exists
 *
 * Those are reported as gaps and shown as unavailable, never invented.
 */

export interface DashboardCounts {
  totalTrips: number;
  today: number;
  thisWeek: number;
  open: number;
  closed: number;
}

/**
 * The five counts, fetched together.
 *
 * Five small parallel requests rather than one unavailable aggregate endpoint.
 * Each returns a single row plus a total, so the payloads are tiny and none of
 * them grows with the size of the dataset.
 */
export async function getDashboardCounts(
  signal?: AbortSignal,
): Promise<DashboardCounts> {
  const day = today();

  const [totalTrips, todayCount, thisWeek, open, closed] = await Promise.all([
    countTrips({}, signal),
    countTrips({ planningDate: day }, signal),
    countTrips(
      { planningDateFrom: startOfWeek(day), planningDateTo: endOfWeek(day) },
      signal,
    ),
    countTrips({ status: "OPEN" }, signal),
    countTrips({ status: "CLOSED" }, signal),
  ]);

  return { totalTrips, today: todayCount, thisWeek, open, closed };
}

/** How many recent Trips the Dashboard lists. */
export const RECENT_TRIPS_LIMIT = 5;

/**
 * The most recent Trips.
 *
 * One request. Each Trip already carries its vehicle and its resolved effective
 * driver, so the list renders without a single follow-up call.
 */
export async function getRecentTrips(signal?: AbortSignal): Promise<Trip[]> {
  const page = await listTrips({ pageSize: RECENT_TRIPS_LIMIT }, signal);

  return page.items;
}
