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
