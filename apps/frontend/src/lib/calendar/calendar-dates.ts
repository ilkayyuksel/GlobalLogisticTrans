/**
 * Calendar dates for the board, as `YYYY-MM-DD` strings.
 *
 * Strings rather than Date objects throughout: the backend's `planningDate` is
 * a DATE column with no timezone, and putting it through a Date would attach
 * one — enough to show yesterday's board to someone west of UTC. Arithmetic is
 * done at UTC midnight and converted straight back to a string, so no local
 * offset ever touches the value.
 */

/**
 * A calendar date as this business writes it: DD/MM/YYYY.
 *
 * ONE formatter for the whole application. The backend speaks ISO — that is a
 * data format and stays untouched — and this is the only place it becomes
 * something a person reads. A second implementation would eventually disagree
 * about the day/month order, which is the one mistake nobody notices until a
 * transport is planned for the wrong date.
 *
 * Anything that is not a calendar date passes through unchanged rather than
 * becoming "NaN/NaN/NaN".
 */
export function formatCalendarDate(isoDate: string | null): string | null {
  if (isoDate === null) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return isoDate;
  }

  const [year, month, day] = isoDate.split("-");

  return `${day}/${month}/${year}`;
}

/** Today, as the operator's own calendar day. */
export function today(): string {
  const now = new Date();

  return toIsoDate(
    new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
    ),
  );
}

/** The same date shifted by whole days. Negative moves backwards. */
export function addDays(isoDate: string, days: number): string {
  const date = fromIsoDate(isoDate);

  if (!date) {
    return isoDate;
  }

  date.setUTCDate(date.getUTCDate() + days);

  return toIsoDate(date);
}

/** A long, unambiguous label — "Thursday 13 August 2026". */
export function toLongLabel(isoDate: string): string {
  const date = fromIsoDate(isoDate);

  if (!date) {
    return isoDate;
  }

  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function isToday(isoDate: string): boolean {
  return isoDate === today();
}

/** Days per week, named so the arithmetic below reads as intent. */
export const DAYS_PER_WEEK = 7;

/**
 * The Monday of the week containing this date.
 *
 * Monday-first because that is how European operations weeks are read, and
 * because the required layout is Monday–Sunday. `getUTCDay()` counts Sunday as
 * 0, so Sunday is shifted back six days rather than forward one — otherwise a
 * Sunday would land in the following week.
 */
export function startOfWeek(isoDate: string): string {
  const date = fromIsoDate(isoDate);

  if (!date) {
    return isoDate;
  }

  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  return addDays(isoDate, -daysSinceMonday);
}

/** The seven dates of the week containing this date, Monday first. */
export function weekDays(isoDate: string): string[] {
  const monday = startOfWeek(isoDate);

  return Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    addDays(monday, index),
  );
}

/** The last day of that week — the Sunday. */
export function endOfWeek(isoDate: string): string {
  return addDays(startOfWeek(isoDate), DAYS_PER_WEEK - 1);
}

export function isCurrentWeek(isoDate: string): boolean {
  return startOfWeek(isoDate) === startOfWeek(today());
}

/** A short weekday name for a column heading — "Mon". */
export function toWeekdayLabel(isoDate: string): string {
  const date = fromIsoDate(isoDate);

  if (!date) {
    return isoDate;
  }

  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });
}

/** The day of the month, for the smaller line under a weekday name. */
export function toDayOfMonthLabel(isoDate: string): string {
  const date = fromIsoDate(isoDate);

  if (!date) {
    return isoDate;
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "1 – 7 September 2026", for the week heading. */
export function toWeekLabel(isoDate: string): string {
  const first = fromIsoDate(startOfWeek(isoDate));
  const last = fromIsoDate(endOfWeek(isoDate));

  if (!first || !last) {
    return isoDate;
  }

  const sameMonth = first.getUTCMonth() === last.getUTCMonth();

  const firstPart = first.toLocaleDateString("en-GB", {
    day: "numeric",
    ...(sameMonth ? {} : { month: "long" }),
    timeZone: "UTC",
  });

  const lastPart = last.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return `${firstPart} – ${lastPart}`;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Null for anything that is not a real calendar date. */
function fromIsoDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }

  const date = new Date(`${isoDate}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}
