import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";

import { trimToNull } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import { ASSIGNMENT_NOTES_MAX_LENGTH } from "./create-vehicle-assignment.dto";

/**
 * Only the end of the period and the notes may be edited.
 *
 * `vehicleId`, `driverId` and `validFrom` define which period this record
 * represents; changing any of them would rewrite history rather than correct
 * it, so a mistake is fixed by ending this assignment and creating a new one.
 */
export class UpdateVehicleAssignmentDto {
  @ApiPropertyOptional({
    description:
      "New last day, inclusive. Send null to reopen the assignment. Rejected once the assignment has already ended.",
    nullable: true,
    example: "2026-06-30",
  })
  @IsOptional()
  @IsCalendarDateString()
  validTo?: string | null;

  @ApiPropertyOptional({
    maxLength: ASSIGNMENT_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(ASSIGNMENT_NOTES_MAX_LENGTH)
  notes?: string | null;
}
