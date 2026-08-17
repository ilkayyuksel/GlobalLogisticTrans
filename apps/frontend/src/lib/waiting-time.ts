/**
 * Waiting time, as people say it and as the database stores it.
 *
 * ── ONE MODEL, TWO REPRESENTATIONS ──────────────────────────────────────────
 * The column is and stays `waiting_time_minutes`, a single integer. Nobody
 * thinks in 135 minutes though — they think "2 uur 15 min" — so every screen
 * shows and edits hours and minutes, and this module is the ONLY place the two
 * are converted. A second conversion somewhere else would eventually disagree
 * about 60, or about 0, and quietly bill the wrong waiting time.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const MINUTES_PER_HOUR = 60;

/** What a badly filled editor produced, so a caller can say which field. */
export type WaitingTimeError =
  | "hoursNotWholeNumber"
  | "hoursNegative"
  | "minutesNotWholeNumber"
  | "minutesOutOfRange";

export interface WaitingTimeParseResult {
  /** Total minutes, ready for `waitingTimeMinutes`. Null when input was blank. */
  readonly totalMinutes: number | null;
  /** Absent when the input was acceptable. */
  readonly error?: WaitingTimeError;
}

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
 * Turns what was typed into total minutes, or says what is wrong with it.
 *
 * INVALID INPUT IS REFUSED, NOT REPAIRED. "1 uur 90 min" could be read as 2:30,
 * but silently rewriting what someone typed is how a mistyped 9 becomes an
 * hour and a half of billed waiting: the editor says the minutes must be under
 * 60 and lets them correct it.
 *
 * Two blank fields mean "no waiting time recorded" and produce null — which is
 * what the backend stores to clear the value.
 */
export function parseWaitingTime(
  hours: string,
  minutes: string,
): WaitingTimeParseResult {
  const trimmedHours = hours.trim();
  const trimmedMinutes = minutes.trim();

  if (trimmedHours === "" && trimmedMinutes === "") {
    return { totalMinutes: null };
  }

  const parsedHours = trimmedHours === "" ? 0 : Number(trimmedHours);
  const parsedMinutes = trimmedMinutes === "" ? 0 : Number(trimmedMinutes);

  if (!Number.isInteger(parsedHours)) {
    return { totalMinutes: null, error: "hoursNotWholeNumber" };
  }

  if (parsedHours < 0) {
    return { totalMinutes: null, error: "hoursNegative" };
  }

  if (!Number.isInteger(parsedMinutes)) {
    return { totalMinutes: null, error: "minutesNotWholeNumber" };
  }

  if (parsedMinutes < 0 || parsedMinutes >= MINUTES_PER_HOUR) {
    return { totalMinutes: null, error: "minutesOutOfRange" };
  }

  return { totalMinutes: parsedHours * MINUTES_PER_HOUR + parsedMinutes };
}
