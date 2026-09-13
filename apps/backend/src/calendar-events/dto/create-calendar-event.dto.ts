import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

import { trim } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import { IsClockTimeString } from "../../common/validators/is-clock-time-string.validator";

export const CALENDAR_EVENT_TITLE_MAX_LENGTH = 200;

/**
 * A new Agenda item.
 *
 * Only what the Agenda asks for: a title, the day, the start and — optionally —
 * the end. Without an end the item lasts one hour; the backend decides that, so
 * every client creates the same item.
 */
export class CreateCalendarEventDto {
  @ApiProperty({
    description: "Required text; surrounding spaces are removed.",
    maxLength: CALENDAR_EVENT_TITLE_MAX_LENGTH,
    example: "Vergadering",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(CALENDAR_EVENT_TITLE_MAX_LENGTH)
  title!: string;

  @ApiProperty({
    description: "The day the item is on.",
    format: "date",
    example: "2026-09-14",
  })
  @IsCalendarDateString()
  date!: string;

  @ApiProperty({
    description:
      "Wall-clock start, HH:MM (seconds are dropped). Not before the Agenda's day start (06:00).",
    example: "10:00",
  })
  @IsClockTimeString()
  startTime!: string;

  @ApiPropertyOptional({
    description:
      "Wall-clock end, after the start and not after the Agenda's day end (23:00). Omitted or null: one hour after the start.",
    nullable: true,
    example: "11:30",
  })
  @IsOptional()
  @IsClockTimeString()
  endTime?: string | null;
}
