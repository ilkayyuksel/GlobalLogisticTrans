import { ApiProperty } from "@nestjs/swagger";
import { CalendarEvent } from "@prisma/client";

import { toIsoDate } from "../../common/dates";
import { toClockTime } from "../../common/time-of-day";
import {
  minuteOfTimeColumn,
  resolveEndMinute,
  toTimeColumn,
} from "../agenda-day";

/** A TIME column cannot hold 24:00; the last minute of the day is its ceiling. */
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/**
 * One Agenda item.
 *
 * The date is "YYYY-MM-DD" and the times are "HH:MM:SS" wall-clock values — one
 * DATE and two TIME columns, with no timezone. Serialising them as timestamps
 * would move a 07:00 meeting for anyone reading it in another zone.
 *
 * `endTime` is always present: an item saved without an end was given one hour
 * when it was created.
 */
export class CalendarEventResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Vergadering" })
  title!: string;

  @ApiProperty({ format: "date", example: "2026-09-14" })
  date!: string;

  @ApiProperty({ example: "10:00:00" })
  startTime!: string;

  @ApiProperty({ example: "11:00:00" })
  endTime!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** One day of the Agenda, with the hours it is drawn in. */
export class CalendarDayDto {
  @ApiProperty({ format: "date", example: "2026-09-14" })
  date!: string;

  @ApiProperty({
    description: "The first moment the Agenda shows and accepts.",
    example: "06:00",
  })
  dayStart!: string;

  @ApiProperty({
    description: "The latest end an item may have.",
    example: "23:00",
  })
  dayEnd!: string;

  @ApiProperty({
    type: [CalendarEventResponseDto],
    description:
      "The day's items, ordered by the database: start time, then end time, then id.",
  })
  items!: CalendarEventResponseDto[];
}

export function toCalendarEventResponse(
  event: CalendarEvent,
): CalendarEventResponseDto {
  return {
    id: event.id,
    title: event.title,
    date: toIsoDate(event.startDate),
    startTime: toClockTime(event.startTime),
    endTime: endTimeOf(event),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/**
 * This API always stores an end. A row written some other way may lack one, and
 * is shown with the same one-hour default a new item gets.
 */
function endTimeOf(event: CalendarEvent): string {
  if (event.endTime) {
    return toClockTime(event.endTime);
  }

  const endMinute = resolveEndMinute(minuteOfTimeColumn(event.startTime), null);

  return toClockTime(toTimeColumn(Math.min(endMinute, LAST_MINUTE_OF_DAY)));
}
