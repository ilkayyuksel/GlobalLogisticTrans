import { request } from "./client";

/**
 * The Agenda endpoints.
 *
 * A stretch of days is asked for as a whole — its items AND the hours a day
 * shows. The calendar asks for its week and the Dashboard for today: the same
 * call and the same answer, so there is one dataset. Whether an item may exist,
 * and how long it lasts without an end, is the backend's answer.
 *
 * Dates are "YYYY-MM-DD" and times "HH:MM:SS", wall-clock values passed through
 * untouched: no Date object ever carries them, so no timezone can move an
 * appointment to another hour or day.
 */

const CALENDAR_EVENTS_PATH = "/api/v1/calendar-events";

export interface CalendarEvent {
  id: string;
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM:SS`. */
  startTime: string;
  /** `HH:MM:SS`. Always present: an item saved without an end lasts one hour. */
  endTime: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarRange {
  from: string;
  to: string;
  /** The first moment a day shows and accepts, `HH:MM`. */
  dayStart: string;
  /** The latest end an item may have, `HH:MM`. */
  dayEnd: string;
  /** Ordered by the backend: day, start, end, id. */
  items: CalendarEvent[];
}

/** Exactly `CreateCalendarEventDto`. */
export interface CreateCalendarEventPayload {
  title: string;
  date: string;
  startTime: string;
  /** Omitted or null: one hour after the start. */
  endTime?: string | null;
}

/** Exactly `UpdateCalendarEventDto`. */
export interface UpdateCalendarEventPayload {
  title?: string;
  /** Moves the whole item to another day. */
  date?: string;
  startTime?: string;
  /** Null: one hour after the start. */
  endTime?: string | null;
}

/** The items from `from` to `to`, both included — at most a week. */
export function getCalendarRange(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<CalendarRange> {
  return request<CalendarRange>(CALENDAR_EVENTS_PATH, {
    query: { from, to },
    signal,
  });
}

export function createCalendarEvent(
  payload: CreateCalendarEventPayload,
  signal?: AbortSignal,
): Promise<CalendarEvent> {
  return request<CalendarEvent>(CALENDAR_EVENTS_PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateCalendarEvent(
  calendarEventId: string,
  payload: UpdateCalendarEventPayload,
  signal?: AbortSignal,
): Promise<CalendarEvent> {
  return request<CalendarEvent>(`${CALENDAR_EVENTS_PATH}/${calendarEventId}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/** Answers with the item that was removed. */
export function deleteCalendarEvent(
  calendarEventId: string,
  signal?: AbortSignal,
): Promise<CalendarEvent> {
  return request<CalendarEvent>(`${CALENDAR_EVENTS_PATH}/${calendarEventId}`, {
    method: "DELETE",
    signal,
  });
}
