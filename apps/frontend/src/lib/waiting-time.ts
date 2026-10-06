/**
 * Waiting time, as people say it and as the database stores it.
 *
 * ── ONE MODEL, TWO REPRESENTATIONS ──────────────────────────────────────────
 * The column is and stays `waiting_time_minutes`, a single integer. Nobody
 * thinks in 135 minutes though — they read a clock twice and they say
 * "2 uur 15 min" — so every screen ENTERS two times and DISPLAYS a duration,
 * and this module is the ONLY place either conversion happens. A second one
 * somewhere else would eventually disagree about 60, or about midnight, and
 * quietly bill the wrong waiting time.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const MINUTES_PER_HOUR = 60;

export interface WaitingTimeParts {
  readonly hours: number;
  readonly minutes: number;
}

/**
 * Splits stored minutes into hours and minutes.
 *
 * Null stays null: a Trip with no recorded waiting time is not a Trip with zero
 * waiting time, and the difference matters — one was never measured, the other
 * was measured as nothing.
 */
export function toWaitingTimeParts(
  totalMinutes: number | null,
): WaitingTimeParts | null {
  if (totalMinutes === null) {
    return null;
  }

  return {
    hours: Math.floor(totalMinutes / MINUTES_PER_HOUR),
    minutes: totalMinutes % MINUTES_PER_HOUR,
  };
}

/**
 * How a waiting time reads in a table.
 *
 * Compact on purpose: a column of "0 u 15 min" is harder to scan than one of
 * "15 min". Whole hours drop the minutes, and everything under an hour drops
 * the hours — but zero is written out as "0 min", because an empty-looking cell
 * would be indistinguishable from one that was never filled in.
 */
export function formatWaitingTime(totalMinutes: number | null): string | null {
  const parts = toWaitingTimeParts(totalMinutes);

  if (!parts) {
    return null;
  }

  if (parts.hours === 0) {
    return `${parts.minutes} min`;
  }

  return parts.minutes === 0
    ? `${parts.hours} u`
    : `${parts.hours} u ${parts.minutes} min`;
}

/**
 * ── FROM TWO CLOCK TIMES TO A DURATION ──────────────────────────────────────
 * An operator does not read a duration off anything — they read a clock twice.
 * So the editor asks for the two moments and this PREVIEWS the minutes the
 * backend will store and pricing will bill from. The stored value is always
 * the backend's (`waiting-window.ts`); the same examples are asserted on both
 * sides so the two cannot drift.
 *
 * Only the time inside 06:00 → 20:00 counts, on each day the window touches:
 *
 *   10:00 → 12:00            same day   → 2 u
 *   05:00 → 07:00            same day   → 1 u
 *   10:00 → 08:00 next day              → 12 u
 *   10:00 → 12:00 next day              → 16 u
 *   22:00 → 02:00 next day              → 0 min
 *
 * The fields hold a TIME OF DAY, so the day of the end is a separate choice:
 * "volgende dag". An end before its begin is the next day whether or not it
 * is ticked — a same-day window cannot run backwards. Equal times without it
 * are ZERO, never a day: a mistyped repeat must not bill one.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Waiting counts from 06:00 … */
const COUNTED_FROM_MINUTE_OF_DAY = 6 * MINUTES_PER_HOUR;
/** … until 20:00, on every day the window touches. */
const COUNTED_UNTIL_MINUTE_OF_DAY = 20 * MINUTES_PER_HOUR;

/** A window spans at most the begin day and the day after it. */
const DAYS_A_WINDOW_CAN_TOUCH = [0, 1] as const;

/** `HH:mm`, as an `<input type="time">` produces it. */
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type WaitingWindowError = "beginInvalid" | "endInvalid";

export interface WaitingWindowResult {
  /** Total minutes, ready for `waitingTimeMinutes`. Null when both are blank. */
  readonly totalMinutes: number | null;
  readonly error?: WaitingWindowError;
}

/** The minutes since midnight, or null when the text is not a clock time. */
function toMinutesOfDay(value: string): number | null {
  const match = CLOCK_TIME.exec(value.trim());

  if (!match) {
    return null;
  }

  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

/**
 * The waiting time between two clock times.
 *
 * Both blank means "no waiting time recorded" and produces null, which is what
 * the backend stores to clear the value. One blank is a half-filled window and
 * is refused rather than guessed at — an end with no beginning is not zero.
 */
export function waitingWindowMinutes(
  begin: string,
  end: string,
  endsNextDay = false,
): WaitingWindowResult {
  const trimmedBegin = begin.trim();
  const trimmedEnd = end.trim();

  if (trimmedBegin === "" && trimmedEnd === "") {
    return { totalMinutes: null };
  }

  const beginMinutes = toMinutesOfDay(trimmedBegin);

  if (beginMinutes === null) {
    return { totalMinutes: null, error: "beginInvalid" };
  }

  const endMinutes = toMinutesOfDay(trimmedEnd);

  if (endMinutes === null) {
    return { totalMinutes: null, error: "endInvalid" };
  }

  const isNextDay = endsNextDay || endMinutes < beginMinutes;

  return {
    totalMinutes: countedMinutesBetween(
      beginMinutes,
      endMinutes + (isNextDay ? MINUTES_PER_DAY : 0),
    ),
  };
}

/**
 * Whether the end can only be on the next day: it lies before the begin.
 *
 * The editor shows "volgende dag" ticked and fixed then, because unticking it
 * could not make the window a same-day one.
 */
export function isNextDayImplied(begin: string, end: string): boolean {
  const beginMinutes = toMinutesOfDay(begin);
  const endMinutes = toMinutesOfDay(end);

  return beginMinutes !== null && endMinutes !== null && endMinutes < beginMinutes;
}

/** The part of `[from, until)` inside 06:00 → 20:00 on the begin day or the next. */
function countedMinutesBetween(from: number, until: number): number {
  return DAYS_A_WINDOW_CAN_TOUCH.reduce<number>((counted, day) => {
    const dayStart = day * MINUTES_PER_DAY;
    const overlap =
      Math.min(until, dayStart + COUNTED_UNTIL_MINUTE_OF_DAY) -
      Math.max(from, dayStart + COUNTED_FROM_MINUTE_OF_DAY);

    return counted + Math.max(0, overlap);
  }, 0);
}
