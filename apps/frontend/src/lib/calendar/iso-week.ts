import { addDays, startOfWeek } from "@/lib/calendar/calendar-dates";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_FROM_MONDAY_TO_THURSDAY = 3;

/**
 * The ISO-8601 week number of a calendar date — Monday-first, the same weeks
 * `startOfWeek` and the rest of the screens use.
 *
 * ── THE WEEK BELONGS TO ITS THURSDAY ────────────────────────────────────────
 * ISO weeks are numbered by the year their Thursday falls in, which is what
 * makes the turn of the year come out right: Friday 1 January 2027 is in week
 * 53 of 2026, and Monday 30 December 2024 is week 1 of 2025. So the week's
 * Thursday is found first, and its day of the year decides the number.
 *
 * Null for anything that is not a calendar date. Display only: the date itself
 * is never changed.
 */
export function isoWeekOf(isoDate: string | null): number | null {
  if (!isCalendarDate(isoDate)) {
    return null;
  }

  const thursday = addDays(startOfWeek(isoDate), DAYS_FROM_MONDAY_TO_THURSDAY);
  const daysIntoYear =
    (Date.parse(`${thursday}T00:00:00.000Z`) - Date.parse(`${thursday.slice(0, 4)}-01-01T00:00:00.000Z`)) /
    MS_PER_DAY;

  return Number.isFinite(daysIntoYear) ? Math.floor(daysIntoYear / 7) + 1 : null;
}

/** A real day: `2026-02-30` parses — JavaScript rolls it into March — but is none. */
function isCalendarDate(isoDate: string | null): isoDate is string {
  if (isoDate === null || !ISO_DATE.test(isoDate)) {
    return false;
  }

  const parsed = new Date(`${isoDate}T00:00:00.000Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate;
}
