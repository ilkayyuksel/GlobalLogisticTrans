import { ApiPropertyOptional } from "@nestjs/swagger";
import { MaintenanceStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import { MONEY_DECIMAL_PLACES, MONEY_MAX_VALUE } from "../../common/dto/money";
import { trim, trimToNull } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";
import {
  MAINTENANCE_DESCRIPTION_MAX_LENGTH,
  MAINTENANCE_NOTES_MAX_LENGTH,
  MAINTENANCE_TYPE_MAX_LENGTH,
  MAINTENANCE_WORKSHOP_MAX_LENGTH,
  MILEAGE_MAX,
  toRawNumber,
} from "./create-maintenance.dto";

/**
 * Partial update. Omitted fields are unchanged; an explicit null clears a
 * nullable one.
 *
 * `vehicleId` is absent on purpose: the documented rule is that a maintenance
 * record is never reassigned to another asset. Moving one would rewrite the
 * history of two vehicles at once.
 *
 * `status`, `maintenanceDate` and `description` are NOT NULL in the database,
 * so they use @ValidateIf rather than @IsOptional — @IsOptional also skips
 * null, which would let a null reach a NOT NULL column.
 */
export class UpdateMaintenanceDto {
  @ApiPropertyOptional({
    enum: MaintenanceStatus,
    description: "Cannot be cleared. CANCELLED is how a maintenance is undone.",
  })
  @ValidateIf((dto: UpdateMaintenanceDto) => dto.status !== undefined)
  @IsEnum(MaintenanceStatus)
  status?: MaintenanceStatus;

  @ApiPropertyOptional({
    maxLength: MAINTENANCE_TYPE_MAX_LENGTH,
    nullable: true,
    example: "Herstelling",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAINTENANCE_TYPE_MAX_LENGTH)
  maintenanceType?: string | null;

  @ApiPropertyOptional({
    description: "Cannot be cleared — the column is NOT NULL.",
    format: "date",
    example: "2026-08-14",
  })
  @ValidateIf((dto: UpdateMaintenanceDto) => dto.maintenanceDate !== undefined)
  @IsCalendarDateString()
  maintenanceDate?: string;

  @ApiPropertyOptional({
    description: "Cannot be cleared — the column is NOT NULL.",
    maxLength: MAINTENANCE_DESCRIPTION_MAX_LENGTH,
  })
  @ValidateIf((dto: UpdateMaintenanceDto) => dto.description !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAINTENANCE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MILEAGE_MAX,
    nullable: true,
    description: "Entered by hand. Send null to clear.",
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MILEAGE_MAX)
  mileage?: number | null;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MONEY_MAX_VALUE,
    nullable: true,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  cost?: number | null;

  @ApiPropertyOptional({
    maxLength: MAINTENANCE_WORKSHOP_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(MAINTENANCE_WORKSHOP_MAX_LENGTH)
  workshop?: string | null;

  @ApiPropertyOptional({ format: "date", nullable: true })
  @IsOptional()
  @IsCalendarDateString()
  nextMaintenanceDate?: string | null;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MILEAGE_MAX,
    nullable: true,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MILEAGE_MAX)
  nextMaintenanceMileage?: number | null;

  @ApiPropertyOptional({
    maxLength: MAINTENANCE_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(MAINTENANCE_NOTES_MAX_LENGTH)
  notes?: string | null;
}
