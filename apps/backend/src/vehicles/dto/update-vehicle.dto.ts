import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import { trim, trimToNull } from "../../common/dto/transforms";
import {
  PLANNING_COLOR_PATTERN,
  VEHICLE_BRAND_MAX_LENGTH,
  VEHICLE_DESCRIPTION_MAX_LENGTH,
  VEHICLE_LICENSE_PLATE_MAX_LENGTH,
  VEHICLE_MODEL_MAX_LENGTH,
  VEHICLE_NOTES_MAX_LENGTH,
  VEHICLE_YEAR_MAX,
  VEHICLE_YEAR_MIN,
  toCanonicalPlanningColor,
} from "./create-vehicle.dto";

/**
 * Partial update. Omitted fields are left untouched; an explicit null clears an
 * optional field. Prisma distinguishes the two natively — `undefined` means "no
 * change", `null` means "set to null".
 *
 * `licensePlate` and `displayColor` are NOT NULL in the database, so both use
 * @ValidateIf rather than @IsOptional: @IsOptional also skips null, which would
 * let a null through to a NOT NULL column.
 */
export class UpdateVehicleDto {
  @ApiPropertyOptional({
    description: "Cannot be cleared — the column is NOT NULL.",
    maxLength: VEHICLE_LICENSE_PLATE_MAX_LENGTH,
    example: "1-ABC-123",
  })
  @ValidateIf((dto: UpdateVehicleDto) => dto.licensePlate !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(VEHICLE_LICENSE_PLATE_MAX_LENGTH)
  licensePlate?: string;

  @ApiPropertyOptional({
    description: "Cannot be cleared — the column is NOT NULL.",
    pattern: "^#[0-9A-Fa-f]{6}$",
    example: "#16a34a",
  })
  @ValidateIf((dto: UpdateVehicleDto) => dto.displayColor !== undefined)
  @Transform(toCanonicalPlanningColor)
  @IsString()
  @Matches(PLANNING_COLOR_PATTERN, {
    message: "displayColor must be a six-digit hex colour, for example #2563eb",
  })
  displayColor?: string;

  @ApiPropertyOptional({
    maxLength: VEHICLE_DESCRIPTION_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(VEHICLE_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    maxLength: VEHICLE_BRAND_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(VEHICLE_BRAND_MAX_LENGTH)
  brand?: string | null;

  @ApiPropertyOptional({
    maxLength: VEHICLE_MODEL_MAX_LENGTH,
    nullable: true,
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
