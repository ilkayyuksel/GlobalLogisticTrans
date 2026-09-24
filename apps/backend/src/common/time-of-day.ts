/**
 * Clock-time helpers for TIME columns.
 *
 * A TIME column carries no date and no timezone, but Prisma models it as a
 * JavaScript Date anchored to 1970-01-01 UTC. Everything here works in UTC so a
 * server in any timezone reads back the same wall-clock value it wrote — a
 * local-time Date would shift the hour and silently change the planning.
 *
 * Lives in common/ because Trip is not the only entity with planned times:
 * exports and future planning views read the same columns.
 */

/** `HH:MM` or `HH:MM:SS`. Seconds are optional because planning works in minutes. */
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** The date Prisma anchors a bare TIME value to. */
const TIME_EPOCH_DATE = "1970-01-01";

export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && CLOCK_TIME_PATTERN.test(value);
}

/**
 * Converts "HH:MM" or "HH:MM:SS" into the Date a TIME column expects.
 * Assumes isClockTime passed.
 */
export function toUtcTime(clockTime: string): Date {
  const withSeconds =
    clockTime.length === "HH:MM".length ? `${clockTime}:00` : clockTime;

  return new Date(`${TIME_EPOCH_DATE}T${withSeconds}.000Z`);
}

/**
 * Renders a TIME value back to "HH:MM:SS".
 *
 * Always emits seconds so the response shape stays constant whether the caller
 * supplied them or not.
 */
export function toClockTime(time: Date): string {
  return time.toISOString().slice("1970-01-01T".length, "1970-01-01T00:00:00".length);
}

/**
 * A stored clock time as a person reads it: `08:00:00` becomes `08:00`.
 *
 * Seconds are noise on anything a person reads — planning works in minutes, and
 * every time in this system is stored to the minute anyway. The same rule the
 * Trip history already applies before comparing two times, and the same one the
 * interface applies before showing one; it lives here so all three say it once.
 *
 * Null passes through: a Trip without a planned time has none to render, and an
 * invented one would put a promise on a driver's phone that nobody made.
 */
export function toClockLabel(clockTime: string | null): string | null {
  return clockTime === null ? null : clockTime.slice(0, "HH:MM".length);
}
