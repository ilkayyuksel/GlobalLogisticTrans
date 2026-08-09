import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, TransformFnParams } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { rawValueOf, trim, trimToNull } from "../../common/dto/transforms";

export const VEHICLE_LICENSE_PLATE_MAX_LENGTH = 20;
export const VEHICLE_DESCRIPTION_MAX_LENGTH = 200;
export const VEHICLE_BRAND_MAX_LENGTH = 100;
export const VEHICLE_MODEL_MAX_LENGTH = 100;
export const VEHICLE_NOTES_MAX_LENGTH = 2000;

/** Static bounds — a clock-derived maximum would make validation untestable. */
export const VEHICLE_YEAR_MIN = 1900;
export const VEHICLE_YEAR_MAX = 2100;

/**
 * Six-digit hex. Three-digit shorthand is rejected on purpose: "#fff" and
 * "#ffffff" are the same colour but different strings, which would defeat the
 * uniqueness rule. All existing planning colours are already six-digit.
 */
export const PLANNING_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Canonicalises the planning colour to lowercase.
 *
 * Hex colours are case-insensitive by definition, so "#AABBCC" and "#aabbcc"
 * are the same colour. Storing one form is what makes the uniqueness check
 * meaningful rather than trivially bypassable by changing case.
 */
export function toCanonicalPlanningColor(
  params: TransformFnParams,
): unknown {
  const value = rawValueOf(params);

  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

export class CreateVehicleDto {
  @ApiProperty({
    description:
      "Licence plate. Must be unique among active vehicles. Stored exactly as entered.",
    maxLength: VEHICLE_LICENSE_PLATE_MAX_LENGTH,
    example: "1-ABC-123",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(VEHICLE_LICENSE_PLATE_MAX_LENGTH)
  licensePlate!: string;

  @ApiProperty({
    description:
      "Planning colour as a six-digit hex value. Must be unique among active vehicles. Normalised to lowercase.",
    pattern: "^#[0-9A-Fa-f]{6}$",
    example: "#2563eb",
  })
  @Transform(toCanonicalPlanningColor)
  @IsString()
  @Matches(PLANNING_COLOR_PATTERN, {
    message: "displayColor must be a six-digit hex colour, for example #2563eb",
  })
  displayColor!: string;

  @ApiPropertyOptional({
    maxLength: VEHICLE_DESCRIPTION_MAX_LENGTH,
    nullable: true,
    example: "Main long-distance tractor unit.",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(VEHICLE_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    maxLength: VEHICLE_BRAND_MAX_LENGTH,
    nullable: true,
    example: "Volvo",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(VEHICLE_BRAND_MAX_LENGTH)
  brand?: string | null;

  @ApiPropertyOptional({
    maxLength: VEHICLE_MODEL_MAX_LENGTH,
    nullable: true,
    example: "FH16",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(VEHICLE_MODEL_MAX_LENGTH)
  model?: string | null;

  @ApiPropertyOptional({
    minimum: VEHICLE_YEAR_MIN,
    maximum: VEHICLE_YEAR_MAX,
    nullable: true,
    example: 2021,
  })
  @IsOptional()
  @IsInt()
  @Min(VEHICLE_YEAR_MIN)
  @Max(VEHICLE_YEAR_MAX)
  year?: number | null;

  @ApiPropertyOptional({
    maxLength: VEHICLE_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(VEHICLE_NOTES_MAX_LENGTH)
  notes?: string | null;
}
