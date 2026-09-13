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
import { IsClockTimeString } from "../../common/validators/is-clock-time-string.validator";
import { CALENDAR_EVENT_TITLE_MAX_LENGTH } from "./create-calendar-event.dto";

/** Present, or deliberately left out — but never null. */
const isSent = (_object: object, value: unknown): boolean => value !== undefined;

/**
 * Changing an Agenda item: its title, its start, its end.
 *
 * The day is deliberately absent. An edit keeps the item on its own day, and
 * the global whitelist refuses a `date` field outright. Omitted fields are
 * unchanged; a null end means "one hour after the start", exactly as when the
 * item was created.
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
