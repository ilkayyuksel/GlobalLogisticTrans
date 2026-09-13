import { request } from "./client";

/**
 * The Agenda endpoints.
 *
 * A day is asked for as a whole — its items AND the hours the Agenda shows —
 * and the calendar and the Dashboard ask the same question, so there is one
 * dataset. Whether an item may exist, and how long it lasts without an end, is
 * the backend's answer.
 *
 * The date is "YYYY-MM-DD" and the times "HH:MM:SS", wall-clock values passed
 * through untouched: no Date object ever carries them, so no timezone can move
 * an appointment to another hour or day.
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

export interface CalendarDay {
  date: string;
  /** The first moment the Agenda shows and accepts, `HH:MM`. */
  dayStart: string;
  /** The latest end an item may have, `HH:MM`. */
  dayEnd: string;
  /** Ordered by the backend: start, then end, then id. */
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

/** Exactly `UpdateCalendarEventDto`: the day cannot change. */
export interface UpdateCalendarEventPayload {
  title?: string;
  startTime?: string;
  /** Null: one hour after the start. */
  endTime?: string | null;
}

export function getCalendarDay(
  date: string,
  signal?: AbortSignal,
): Promise<CalendarDay> {
  return request<CalendarDay>(CALENDAR_EVENTS_PATH, { query: { date }, signal });
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
