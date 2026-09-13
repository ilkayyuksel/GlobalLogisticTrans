import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

import { trim } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import { IsClockTimeString } from "../../common/validators/is-clock-time-string.validator";
import { CALENDAR_EVENT_TITLE_MAX_LENGTH } from "./create-calendar-event.dto";

/** Present, or deliberately left out — but never null. */
const isSent = (_object: object, value: unknown): boolean => value !== undefined;

/**
 * Changing an Agenda item: its title, its day, its start, its end.
 *
 * Omitted fields are unchanged. A null end means "one hour after the start",
 * exactly as when the item was created. A new day moves the whole item; it
 * stays a single-day item within the Agenda's hours.
 */
export class UpdateCalendarEventDto {
  @ApiPropertyOptional({
    description: "Text; surrounding spaces are removed. Cannot be emptied.",
    maxLength: CALENDAR_EVENT_TITLE_MAX_LENGTH,
    example: "Vergadering met klant",
  })
  @Transform(trim)
  @ValidateIf(isSent)
  @IsString()
  @MinLength(1)
  @MaxLength(CALENDAR_EVENT_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    description: "The day the item moves to. Omitted: unchanged.",
    format: "date",
    example: "2026-09-16",
  })
  @ValidateIf(isSent)
  @IsCalendarDateString()
  date?: string;

  @ApiPropertyOptional({
    description: "Wall-clock start, HH:MM. Omitted: unchanged.",
    example: "10:30",
  })
  @ValidateIf(isSent)
  @IsClockTimeString()
  startTime?: string;

  @ApiPropertyOptional({
    description:
      "Wall-clock end, HH:MM. Omitted: unchanged. Null: one hour after the start.",
    nullable: true,
    example: "12:00",
  })
  @IsOptional()
  @IsClockTimeString()
  endTime?: string | null;
}
