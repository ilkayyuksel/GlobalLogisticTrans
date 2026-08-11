/**
 * Calendar-date helpers for DATE columns.
 *
 * DATE columns carry no time and no timezone. Everything here works in UTC so a
 * server running in any timezone stores and compares the same calendar day —
 * a local-time Date would shift the day either side of midnight.
 */

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True only for a real calendar day.
 *
 * Date.parse alone is not enough: it rolls overflow forward, so "2026-02-31"
 * silently becomes 3 March instead of failing.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const rebuilt = new Date(Date.UTC(year, month - 1, day));

  return (
    rebuilt.getUTCFullYear() === year &&
    rebuilt.getUTCMonth() === month - 1 &&
    rebuilt.getUTCDate() === day
  );
}

/** Converts "YYYY-MM-DD" into midnight UTC. Assumes isCalendarDate passed. */
export function toUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Renders a Date back to "YYYY-MM-DD". */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
}

/** Today as midnight UTC, so it compares cleanly against a DATE column. */
export function todayUtc(): Date {
  return toUtcDate(toIsoDate(new Date()));
}
