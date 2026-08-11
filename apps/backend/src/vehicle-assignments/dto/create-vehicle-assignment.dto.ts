import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

import { trimToNull } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";

export const ASSIGNMENT_NOTES_MAX_LENGTH = 2000;

export class CreateVehicleAssignmentDto {
  @ApiProperty({ format: "uuid", description: "Vehicle being assigned." })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({ format: "uuid", description: "Driver receiving the vehicle." })
  @IsUUID()
  driverId!: string;

  @ApiProperty({
    description: "First day the assignment applies. Inclusive.",
    example: "2026-03-01",
  })
  @IsCalendarDateString()
  validFrom!: string;

  @ApiPropertyOptional({
    description:
      "Last day the assignment applies, inclusive. Omit or send null for an open-ended assignment, which automatically closes the previous open-ended assignment of the same vehicle or driver.",
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
