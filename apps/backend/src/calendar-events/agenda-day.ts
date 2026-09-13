import { toClockTime, toUtcTime } from "../common/time-of-day";

/**
 * The Agenda's day, and the rules for placing an item in it.
 *
 * Business rules, so they live here and nowhere else: the day endpoint sends
 * the range with every answer, and the calendar draws exactly the hours this
 * file allows instead of keeping a copy of its own.
 *
 * Everything works in minutes since midnight. The Agenda plans in minutes;
 * seconds a client sends are dropped rather than stored, so an item can never
 * end "after" its start by half a minute nobody can see.
 */

/** The first moment of the Agenda's day. */
export const AGENDA_DAY_START = "06:00";

/** The latest end an item may have. The day's last hour block is 22:00–23:00. */
export const AGENDA_DAY_END = "23:00";

/** How long an item lasts when no end is given. */
export const DEFAULT_DURATION_MINUTES = 60;

const MINUTES_PER_HOUR = 60;

export interface AgendaSlot {
  readonly startMinute: number;
  readonly endMinute: number;
}

export type AgendaSlotProblem = "END_NOT_AFTER_START" | "OUTSIDE_AGENDA_DAY";

/** Minutes since midnight of "HH:MM" or "HH:MM:SS". Assumes isClockTime passed. */
export function toMinuteOfDay(clockTime: string): number {
  const [hours, minutes] = clockTime.split(":").map(Number);

  return hours * MINUTES_PER_HOUR + minutes;
}

/** "HH:MM" for a minute of the day. */
export function toClockLabelOfMinute(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / MINUTES_PER_HOUR);
  const minutes = minuteOfDay % MINUTES_PER_HOUR;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** The value a TIME column stores for a minute of the day. */
export function toTimeColumn(minuteOfDay: number): Date {
  return toUtcTime(toClockLabelOfMinute(minuteOfDay));
}

/** The minute of the day a TIME column holds. */
export function minuteOfTimeColumn(time: Date): number {
  return toMinuteOfDay(toClockTime(time));
}

/**
 * The end an item gets: the one given, or DEFAULT_DURATION_MINUTES after the
 * start. Decided here, once, so an item saved without an end lasts exactly one
 * hour whichever screen created it.
 */
export function resolveEndMinute(
  startMinute: number,
  endMinute: number | null,
): number {
  return endMinute ?? startMinute + DEFAULT_DURATION_MINUTES;
}

/**
 * What is wrong with a slot, or null when nothing is.
 *
 * An item must end after it starts — an item of no length can be neither drawn
 * nor tapped — and must lie within the Agenda's day. Nothing in the domain
 * supports an item before 06:00 or after 23:00: the calendar would have nowhere
 * to show it, so it is refused rather than stored out of sight.
 */
export function agendaSlotProblem(slot: AgendaSlot): AgendaSlotProblem | null {
  if (slot.endMinute <= slot.startMinute) {
    return "END_NOT_AFTER_START";
  }

  if (
    slot.startMinute < toMinuteOfDay(AGENDA_DAY_START) ||
    slot.endMinute > toMinuteOfDay(AGENDA_DAY_END)
  ) {
    return "OUTSIDE_AGENDA_DAY";
  }

  return null;
}
