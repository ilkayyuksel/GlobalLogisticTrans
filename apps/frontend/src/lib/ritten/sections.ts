import type { Trip } from "@/lib/api/types";
import { guaranteedDates, type RittenView } from "./period";

/**
 * Trips arranged into the date sections a Ritten view shows.
 *
 * Grouping only. Nothing here filters, sorts or hides a Trip: the backend
 * already decided which Trips belong to the period and in what order, and
 * re-deciding any of that in the browser would eventually disagree with it —
 * and would only ever be right about the page currently loaded.
 */

export interface DateSection {
  /** `YYYY-MM-DD`, or null for the Trips that have no planning date yet. */
  readonly date: string | null;
  readonly trips: Trip[];
}

/**
 * The sections for one view.
 *
 * A week keeps all seven days even when a day is empty, because an empty
 * Tuesday is information. A month shows only the days that hold work, which is
 * the question the month view answers. Any Trip whose date falls outside the
 * guaranteed set is still shown, in its own section, rather than dropped: it
 * would mean the backend returned something the filter did not ask for, and
 * hiding that would hide a real problem.
 */
export function buildSections(
  view: RittenView,
  anchor: string,
  trips: readonly Trip[],
): DateSection[] {
  const byDate = new Map<string, Trip[]>();
  /*
   * A Trip created by hand may have no planning date. It belongs to no day, so
   * it cannot go in a date section — and inventing one for it, today's or the
   * anchor's, would be a scheduling decision nobody made. It is collected here
   * and shown under its own heading instead, where it stays visible until
   * somebody schedules it.
   */
  const unscheduled: Trip[] = [];

  for (const date of guaranteedDates(view, anchor)) {
    byDate.set(date, []);
  }

  for (const trip of trips) {
    if (trip.planningDate === null) {
      unscheduled.push(trip);
      continue;
    }

    const existing = byDate.get(trip.planningDate);

    if (existing) {
      existing.push(trip);
    } else {
      byDate.set(trip.planningDate, [trip]);
    }
  }

  const dated = [...byDate.entries()]
    .map(([date, dateTrips]) => ({ date, trips: dateTrips }) as DateSection)
    .sort((left, right) =>
      (left.date as string).localeCompare(right.date as string),
    );

  // Last: the days are the plan, and the unscheduled work is what has yet to
  // enter it.
  return unscheduled.length > 0
    ? [...dated, { date: null, trips: unscheduled }]
    : dated;
}
