import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";

import { trimToNull } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import { MAINTENANCE_NOTES_MAX_LENGTH } from "./create-maintenance.dto";

/**
 * Completing the current cycle of a maintenance record.
 *
 * The record is NOT closed: it is planned again on `nextMaintenanceDate` and
 * goes back to PLANNED, while the cycle that ended is kept in its history.
 */
export class CompleteMaintenanceDto {
  @ApiProperty({
    description:
      "Required. The planned date of the cycle being completed, as the client showed it. A request naming a date the record no longer has — a double submit, a second open tab — is refused with 409 instead of recording the same cycle twice.",
    format: "date",
    example: "2026-09-09",
  })
  @IsCalendarDateString()
  plannedDate!: string;

  @ApiPropertyOptional({
    description:
      "The day the work was actually done. Defaults to today, and may not lie in the future.",
    format: "date",
    example: "2026-09-14",
  })
  @IsOptional()
  @IsCalendarDateString()
  completedOn?: string;

  @ApiProperty({
    description:
      "Required. The date the same record is planned again for; it becomes the record's maintenance date.",
    format: "date",
    example: "2027-03-14",
  })
  @IsCalendarDateString()
  nextMaintenanceDate!: string;

  @ApiPropertyOptional({
    description: "Extra information about this execution, kept in the history.",
    maxLength: MAINTENANCE_NOTES_MAX_LENGTH,
    nullable: true,
    example: "Groot onderhoud uitgevoerd, olie en filters vervangen",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(MAINTENANCE_NOTES_MAX_LENGTH)
  notes?: string | null;
}
