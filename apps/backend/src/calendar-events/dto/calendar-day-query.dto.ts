import { ApiProperty } from "@nestjs/swagger";

import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";

/** The one day the Agenda shows. Required: there is no "every item" list. */
export class CalendarDayQueryDto {
  @ApiProperty({
    description:
      "The calendar day, as the operator reads it. A DATE with no timezone: the Dashboard sends its own today.",
    format: "date",
    example: "2026-09-14",
  })
  @IsCalendarDateString()
  date!: string;
}
