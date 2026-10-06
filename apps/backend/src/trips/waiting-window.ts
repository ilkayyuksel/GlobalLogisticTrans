/**
 * The waiting time a window of two clock times counts for.
 *
 * ── WHY THE BACKEND DERIVES IT ──────────────────────────────────────────────
 * `waiting_time_start`, `waiting_time_end`, `waiting_time_ends_next_day` and
 * `waiting_time_minutes` describe one fact, and pricing bills from the last.
 * If a client could send them independently, the money and the evidence for it
 * could disagree — so the minutes are never accepted from a caller when the
 * times are given. They are computed here, from the stored window, and that is
 * what makes them consistent by construction.
 *
 * ── ONLY 06:00 → 20:00 COUNTS ───────────────────────────────────────────────
 * Waiting counts only inside the fixed daily window 06:00 → 20:00. Time
 * outside it — the night — is not waiting time, however long the truck stood.
 * The window is a business rule, not a Setting: it is deliberately fixed.
 *
 *   10:00 → 12:00            same day   → 2 u
 *   05:00 → 07:00            same day   → 1 u   (only 06:00–07:00)
 *   10:00 → 08:00 next day              → 12 u  (10–20, then 06–08)
 *   10:00 → 12:00 next day              → 16 u  (10–20, then 06–12)
 *   22:00 → 02:00 next day              → 0     (entirely at night)
 *
 * The result IS `waiting_time_minutes`. The Waiting Time calculator then
 * applies its threshold, allowance and blocks to it exactly as before — this
 * module decides how long the truck waited, never what that costs.
 *
 * ── WHICH DAY THE END IS ON ─────────────────────────────────────────────────
 * The columns hold a TIME OF DAY, so the day of the end is stated separately:
 *
 *   ends next day set   → the end is on the following calendar day
 *   end before begin    → the following day too; a same-day window cannot run
 *                          backwards, so this is the only possible reading
 *   otherwise           → the same day; equal times are ZERO, never a day
 *
 * Equal times without the flag stay zero on purpose: a mistyped repeat must not
 * bill a day. A genuine day-long wait says so with the flag.
 *
 * ── THE FRONTEND HAS THE SAME RULES, AND WHY ────────────────────────────────
 * `apps/frontend/src/lib/waiting-time.ts` computes the same thing to show a
 * duration WHILE SOMEBODY IS TYPING, before anything is sent. That preview
 * cannot come from here without a round trip per keystroke. The two are kept
 * honest by the same examples being asserted on both sides; the stored value
 * is always this one, never the browser's.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Waiting counts from 06:00 … */
const COUNTED_FROM_MINUTE_OF_DAY = 6 * MINUTES_PER_HOUR;
/** … until 20:00, on every day the window touches. */
const COUNTED_UNTIL_MINUTE_OF_DAY = 20 * MINUTES_PER_HOUR;

/** A window spans at most the begin day and the day after it. */
const DAYS_A_WINDOW_CAN_TOUCH = [0, 1] as const;

/**
 * Whether the end is on the day after the begin.
 *
 * Both are `Date` objects carrying a Prisma `TIME` value, whose date part is
 * meaningless — only the clock reading is used.
 */
export function waitingWindowEndsNextDay(
  begin: Date,
  end: Date,
  endsNextDay: boolean,
): boolean {
  return endsNextDay || toMinutesOfDay(end) < toMinutesOfDay(begin);
}

/** The counted minutes of a window — what `waiting_time_minutes` stores. */
export function waitingWindowMinutes(
  begin: Date,
  end: Date,
  endsNextDay: boolean,
): number {
  const beginMinute = toMinutesOfDay(begin);
  const endMinute =
    toMinutesOfDay(end) +
    (waitingWindowEndsNextDay(begin, end, endsNextDay) ? MINUTES_PER_DAY : 0);

  return countedMinutesBetween(beginMinute, endMinute);
}

/**
 * The part of `[from, until)` — minutes since the begin day's midnight — that
 * lies inside 06:00 → 20:00 on the begin day or the day after.
 */
function countedMinutesBetween(from: number, until: number): number {
  return DAYS_A_WINDOW_CAN_TOUCH.reduce<number>((counted, day) => {
    const dayStart = day * MINUTES_PER_DAY;
    const overlap =
      Math.min(until, dayStart + COUNTED_UNTIL_MINUTE_OF_DAY) -
      Math.max(from, dayStart + COUNTED_FROM_MINUTE_OF_DAY);

    return counted + Math.max(0, overlap);
  }, 0);
}

/**
 * What to store for the waiting-time columns, given what was sent.
 *
 * ── THE THREE STATES ────────────────────────────────────────────────────────
 *   both times      → store them, the day of the end, and the counted minutes
 *   both cleared    → store null for the times and minutes: the entry is gone
 *   neither sent    → touch nothing; this update is not about waiting time
 *
 * A HALF-FILLED window is refused before it reaches here, so an end with no
 * beginning cannot arrive: it is not zero, and guessing which it meant would
 * either bill nothing or bill from midnight.
 *
 * The stored flag is the EFFECTIVE day of the end — an end before its begin is
 * stored as next day — so every reader can take the flag at its word.
 */
export interface WaitingTimeWrite {
  waitingTimeStart?: Date | null;
  waitingTimeEnd?: Date | null;
  waitingTimeEndsNextDay?: boolean;
  waitingTimeMinutes?: number | null;
}

export function toWaitingTimeWrite(
  begin: Date | null | undefined,
  end: Date | null | undefined,
  endsNextDay: boolean | undefined,
): WaitingTimeWrite {
  if (begin === undefined && end === undefined) {
    return {};
  }

  if (!begin || !end) {
    return {
      waitingTimeStart: null,
      waitingTimeEnd: null,
      waitingTimeEndsNextDay: false,
      waitingTimeMinutes: null,
    };
  }

  // Omitted means "the same day", as it did before the flag existed.
  const statedNextDay = endsNextDay ?? false;

  return {
    waitingTimeStart: begin,
    waitingTimeEnd: end,
    waitingTimeEndsNextDay: waitingWindowEndsNextDay(begin, end, statedNextDay),
    waitingTimeMinutes: waitingWindowMinutes(begin, end, statedNextDay),
  };
}

function toMinutesOfDay(time: Date): number {
  return time.getUTCHours() * MINUTES_PER_HOUR + time.getUTCMinutes();
}

/**
 * Whether an update is about the waiting-time window at all.
 *
 * The same test `toWaitingTimeWrite` applies — "were the times sent" — named
 * once so the write decision and the pricing decision cannot drift apart. A
 * caller that clears the window sends two explicit nulls, which is a change
 * like any other and must reprice. The day flag only ever travels with the two
 * times (see `assertWaitingWindowIsComplete`), so the times decide.
 */
export function changesWaitingTimeWindow(update: {
  waitingTimeStart?: string | null;
  waitingTimeEnd?: string | null;
}): boolean {
  return (
    update.waitingTimeStart !== undefined || update.waitingTimeEnd !== undefined
  );
}
