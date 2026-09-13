import { ApiProperty } from "@nestjs/swagger";

import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";

/**
 * The days the Agenda shows: a week for the calendar, one day for the
 * Dashboard. Both ends are inclusive DATEs with no timezone.
 */
export class CalendarRangeQueryDto {
  @ApiProperty({
    description: "The first day, inclusive.",
    format: "date",
    example: "2026-09-14",
  })
  @IsCalendarDateString()
  from!: string;

  @ApiProperty({
    description:
      "The last day, inclusive; not before `from`, and at most six days after it. The Dashboard asks for today to today.",
    format: "date",
    example: "2026-09-20",
  })
  @IsCalendarDateString()
  to!: string;
}
