/**
 * The duration between the two clock times a waiting time was read off.
 *
 * ── WHY THE BACKEND DERIVES IT ──────────────────────────────────────────────
 * `waiting_time_start`, `waiting_time_end` and `waiting_time_minutes` describe
 * one fact three ways, and pricing bills from the third. If a client could send
 * all three independently, the money and the evidence for it could disagree —
 * so the minutes are never accepted from a caller when the times are given.
 * They are computed here, from the stored window, and that is what makes the
 * three consistent by construction.
 *
 * ── THE RULES, WHICH ARE THE PRODUCT'S OWN ──────────────────────────────────
 * The columns hold a TIME OF DAY, so the window is always less than 24 hours:
 *
 *   end after begin   → the same day.       10:00 → 12:15 is 135 minutes
 *   end before begin  → the next morning.   22:00 → 02:00 is 240 minutes
 *   end equal begin   → ZERO, never a day.  10:00 → 10:00 is 0 minutes
 *
 * The last one is a decision rather than an oversight. "The truck waited
 * exactly twenty-four hours" and "it did not wait" look identical in two time
 * fields, and reading it as a day would bill a full day for a mistyped repeat.
 * Zero is the safe reading; a genuine day-long wait needs a way to say so that
 * these fields do not have.
 *
 * A negative duration is therefore unrepresentable: the midnight rule turns
 * what would be negative into the next morning.
 *
 * ── THE FRONTEND HAS THE SAME RULES, AND WHY ────────────────────────────────
 * `apps/frontend/src/lib/waiting-time.ts` computes the same thing to show a
 * duration WHILE SOMEBODY IS TYPING, before anything is sent. That preview
 * cannot come from here without a round trip per keystroke. The two are kept
 * honest by the same three examples being asserted on both sides; the stored
 * value is always this one, never the browser's.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/**
 * Minutes between two times of day.
 *
 * Both are `Date` objects carrying a Prisma `TIME` value, whose date part is
 * meaningless — only the clock reading is used, which is what keeps this
 * independent of how the driver's date was stored.
 */
export function waitingWindowMinutes(begin: Date, end: Date): number {
  const beginMinutes = toMinutesOfDay(begin);
  const endMinutes = toMinutesOfDay(end);

  // Past midnight the end is on the next day; equal times are zero, never a day.
  return endMinutes >= beginMinutes
    ? endMinutes - beginMinutes
    : endMinutes + MINUTES_PER_DAY - beginMinutes;
}

/**
 * What to store for the three waiting-time columns, given what was sent.
 *
 * ── THE THREE STATES ────────────────────────────────────────────────────────
 *   both times      → store them, and the duration derived from them
 *   both cleared    → store null for all three: the entry is removed
 *   neither sent    → touch nothing; this update is not about waiting time
 *
 * A HALF-FILLED window is refused by the DTO before it reaches here, so an end
 * with no beginning cannot arrive: it is not zero, and guessing which it meant
 * would either bill nothing or bill from midnight.
 */
export interface WaitingTimeWrite {
  waitingTimeStart?: Date | null;
  waitingTimeEnd?: Date | null;
  waitingTimeMinutes?: number | null;
}

export function toWaitingTimeWrite(
  begin: Date | null | undefined,
  end: Date | null | undefined,
): WaitingTimeWrite {
  if (begin === undefined && end === undefined) {
    return {};
  }

  if (begin === null || end === null) {
    return {
      waitingTimeStart: null,
      waitingTimeEnd: null,
      waitingTimeMinutes: null,
    };
  }

  return {
    waitingTimeStart: begin,
    waitingTimeEnd: end,
    waitingTimeMinutes: waitingWindowMinutes(begin as Date, end as Date),
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
 * like any other and must reprice.
 */
export function changesWaitingTimeWindow(update: {
  waitingTimeStart?: string | null;
  waitingTimeEnd?: string | null;
}): boolean {
  return (
    update.waitingTimeStart !== undefined || update.waitingTimeEnd !== undefined
  );
}
