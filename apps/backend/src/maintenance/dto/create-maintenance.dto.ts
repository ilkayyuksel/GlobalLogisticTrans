import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MaintenanceStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { MONEY_DECIMAL_PLACES, MONEY_MAX_VALUE } from "../../common/dto/money";
import { rawValueOf, trim, trimToNull } from "../../common/dto/transforms";
import { IsCalendarDateString } from "../../common/validators/is-calendar-date-string.validator";

export const MAINTENANCE_TYPE_MAX_LENGTH = 100;
export const MAINTENANCE_DESCRIPTION_MAX_LENGTH = 2000;
export const MAINTENANCE_WORKSHOP_MAX_LENGTH = 200;
export const MAINTENANCE_NOTES_MAX_LENGTH = 2000;

/**
 * An odometer reading, in kilometres.
 *
 * The upper bound is generous rather than meaningful — a truck may genuinely
 * pass two million kilometres — and exists only so a typo of ten digits is
 * refused rather than stored.
 */
export const MILEAGE_MAX = 9_999_999;

/**
 * Reads the raw request value for a numeric field.
 *
 * The global ValidationPipe runs with enableImplicitConversion, which turns
 * "12.5" into 12.5 before @IsInt ever sees it — so a fractional mileage would
 * silently become a valid integer-looking number. Reading the original value
 * keeps @IsInt able to refuse it.
 */
export function toRawNumber(params: Parameters<typeof rawValueOf>[0]): unknown {
  const value = rawValueOf(params);

  return typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : value;
}

/**
 * A maintenance event, as the Administrator records it.
 *
 * ── V1 SCOPE ────────────────────────────────────────────────────────────────
 * `mileage` and `nextMaintenanceMileage` are ENTERED BY HAND. Nothing in this
 * system tracks a vehicle's current odometer, and neither field may be read as
 * if it did: `mileage` is what the odometer said when this work was done, and
 * `nextMaintenanceMileage` is when the next work is planned. There is no
 * interval table, no schedule and no automatic calculation.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The asset is a Vehicle. The column also permits a Trailer, but trailer
 * maintenance has no UI in this version and accepting a trailer id here would
 * create rows nothing can show.
 */
export class CreateMaintenanceDto {
  @ApiProperty({
    format: "uuid",
    description: "The Vehicle this maintenance belongs to. Must exist.",
  })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({
    enum: MaintenanceStatus,
    description:
      "Lifecycle of the maintenance itself. A maintenance that should no longer happen becomes CANCELLED — records are never deleted.",
  })
  @IsEnum(MaintenanceStatus)
  status!: MaintenanceStatus;

  @ApiPropertyOptional({
    description:
      "What kind of work this is, in the Administrator's own words — Onderhoud, Herstelling, Banden, Keuring. Free text on purpose: a new kind of work must never require a migration.",
    maxLength: MAINTENANCE_TYPE_MAX_LENGTH,
    nullable: true,
    example: "Onderhoud",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAINTENANCE_TYPE_MAX_LENGTH)
  maintenanceType?: string | null;

  @ApiProperty({
    description: "The day the work was done, or is planned for.",
    format: "date",
    example: "2026-08-14",
  })
  @IsCalendarDateString()
  maintenanceDate!: string;

  @ApiProperty({
    description: "What was done.",
    maxLength: MAINTENANCE_DESCRIPTION_MAX_LENGTH,
    example: "Grote beurt, olie en filters vervangen",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(MAINTENANCE_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiPropertyOptional({
    description:
      "Odometer reading when this work was done, in kilometres, entered by hand. NOT the vehicle's current mileage — this system has no odometer.",
    minimum: 0,
    maximum: MILEAGE_MAX,
    nullable: true,
    example: 245_000,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MILEAGE_MAX)
  mileage?: number | null;

  @ApiPropertyOptional({
    description:
      "What the work cost, in EUR. Stored as NUMERIC(12,2) and returned as a fixed-2 string; never negative.",
    minimum: 0,
    maximum: MONEY_MAX_VALUE,
    nullable: true,
    example: 1250.5,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  cost?: number | null;

  @ApiPropertyOptional({
    description: "Where the work was done. Shown in the UI as 'Garage'.",
    maxLength: MAINTENANCE_WORKSHOP_MAX_LENGTH,
    nullable: true,
    example: "Garage Peeters",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(MAINTENANCE_WORKSHOP_MAX_LENGTH)
  workshop?: string | null;

  @ApiPropertyOptional({
    description:
      "When the next maintenance is planned. The Administrator's plan — nothing derives or maintains it.",
    format: "date",
    nullable: true,
    example: "2027-02-14",
  })
  @IsOptional()
  @IsCalendarDateString()
  nextMaintenanceDate?: string | null;

  @ApiPropertyOptional({
    description:
      "The odometer reading at which the next maintenance is due, entered by hand. Whether it has been reached cannot be answered by this system, which knows no current mileage.",
    minimum: 0,
    maximum: MILEAGE_MAX,
    nullable: true,
    example: 275_000,
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
