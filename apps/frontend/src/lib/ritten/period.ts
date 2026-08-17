import {
  addDays,
  endOfWeek,
  startOfWeek,
  today,
  weekDays,
} from "@/lib/calendar/calendar-dates";

/**
 * The period a Ritten view covers.
 *
 * All three views are LISTS of Trips over a range of planning dates — a day, a
 * week, a month. Nothing here knows about hours: the period is a range of
 * calendar dates and nothing more, which is exactly what the backend's
 * `planningDate` filters accept.
 *
 * The day and week arithmetic is reused from `board-dates`, which is plain UTC
 * calendar maths with its own tests. Dates travel as `YYYY-MM-DD` strings from
 * end to end: the backend column is a DATE with no timezone, and putting one
 * through a local `Date` would show yesterday's list to anyone west of UTC.
 */

export const RITTEN_VIEWS = ["day", "week", "month"] as const;

export type RittenView = (typeof RITTEN_VIEWS)[number];

/** What the backend is asked for. Exactly one of the two shapes is used. */
export interface PeriodQuery {
  planningDate?: string;
  planningDateFrom?: string;
  planningDateTo?: string;
}

export function isRittenView(value: unknown): value is RittenView {
  return RITTEN_VIEWS.includes(value as RittenView);
}

/** Today, as the operator's own calendar day. */
export function todayAnchor(): string {
  return today();
}

/**
 * The date filter for this period.
 *
 * A single day uses `planningDate`, which the backend documents as overriding
 * the range — asking for both would be ambiguous.
 */
export function periodQuery(view: RittenView, anchor: string): PeriodQuery {
  if (view === "day") {
    return { planningDate: anchor };
  }

  return {
    planningDateFrom: periodStart(view, anchor),
    planningDateTo: periodEnd(view, anchor),
  };
}

export function periodStart(view: RittenView, anchor: string): string {
  if (view === "day") {
    return anchor;
  }

  return view === "week" ? startOfWeek(anchor) : startOfMonth(anchor);
}

export function periodEnd(view: RittenView, anchor: string): string {
  if (view === "day") {
    return anchor;
  }

  return view === "week" ? endOfWeek(anchor) : endOfMonth(anchor);
}

/** The next or previous period of the same kind. */
export function shiftPeriod(
  view: RittenView,
  anchor: string,
  steps: number,
): string {
  if (view === "day") {
    return addDays(anchor, steps);
  }

  if (view === "week") {
    return startOfWeek(addDays(startOfWeek(anchor), steps * DAYS_PER_WEEK));
  }

  return addMonths(startOfMonth(anchor), steps);
}

/** Whether this period is the one containing today. */
export function isCurrentPeriod(view: RittenView, anchor: string): boolean {
  return periodStart(view, anchor) === periodStart(view, todayAnchor());
}

/**
 * The dates a period is guaranteed to contain.
 *
 * A week always shows its seven days, empty ones included: a day with no work
 * is a fact a planner acts on, and omitting it would make the week read as
 * though that day did not exist. A month is deliberately not enumerated — it is
 * grouped from the Trips that came back, so it answers "which days have work"
 * rather than printing thirty-one mostly empty headings.
 */
export function guaranteedDates(view: RittenView, anchor: string): string[] {
  if (view === "day") {
    return [anchor];
  }

  return view === "week" ? weekDays(anchor) : [];
}

const DAYS_PER_WEEK = 7;

export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function endOfMonth(isoDate: string): string {
  // Day 0 of the next month is the last day of this one.
  const date = fromIsoDate(startOfMonth(isoDate));

  if (!date) {
    return isoDate;
  }

  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);

  return toIsoDate(date);
}

/**
 * The same day-of-month a number of months away, clamped to the month's length.
 *
 * Only ever called with the first of a month here, but the clamp keeps it
 * honest: without it, one month after 31 January would be 3 March.
 */
export function addMonths(isoDate: string, months: number): string {
  const date = fromIsoDate(isoDate);

  if (!date) {
    return isoDate;
  }

  const dayOfMonth = date.getUTCDate();

  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);

  const lastDayOfTargetMonth = Number(endOfMonth(toIsoDate(date)).slice(8));

  date.setUTCDate(Math.min(dayOfMonth, lastDayOfTargetMonth));

  return toIsoDate(date);
}

/** `YYYY-MM`, the value an `<input type="month">` exchanges. */
export function toMonthInputValue(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function fromMonthInputValue(value: string): string | null {
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : null;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromIsoDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }

  const date = new Date(`${isoDate}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}
