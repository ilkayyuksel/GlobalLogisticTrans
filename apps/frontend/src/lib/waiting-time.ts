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
 * So the editor asks for the two moments and this works out the minutes, which
 * is what the column stores and what pricing bills from.
 *
 * The fields hold a TIME OF DAY and nothing else, so the window they describe
 * is always less than 24 hours:
 *
 *   end after begin   → the same day.       10:00 → 12:30 is 2 u 30 min
 *   end before begin  → the next day.       22:00 → 02:00 is 4 u
 *   end equal begin   → ZERO, never a day.  10:00 → 10:00 is 0 min
 *
 * The last one is a decision, not an oversight. "The truck waited exactly
 * twenty-four hours" and "it did not wait" look identical in two time fields,
 * and reading it as a day would bill a full day for a mistyped repeat. Zero is
 * the safe reading; a genuine 24-hour wait needs a way to say so that these
 * fields do not have.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

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

  // Past midnight the end is on the next day; equal times are zero, never a day.
  return {
    totalMinutes:
      endMinutes >= beginMinutes
        ? endMinutes - beginMinutes
        : endMinutes + MINUTES_PER_DAY - beginMinutes,
  };
}
