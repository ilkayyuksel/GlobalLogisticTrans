import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import {
  HEX_COLOR_MESSAGE,
  HEX_COLOR_PATTERN,
  toCanonicalHexColor,
} from "../../common/dto/color";
import { MONEY_DECIMAL_PLACES, MONEY_MAX_VALUE } from "../../common/dto/money";
import { rawValueOf, trim, trimToNull } from "../../common/dto/transforms";
import {
  DISPLAY_ORDER_MAX,
  PROPERTY_DESCRIPTION_MAX_LENGTH,
  PROPERTY_NAME_MAX_LENGTH,
} from "./create-custom-property.dto";

/**
 * Partial update. Omitted fields are left untouched; an explicit null clears an
 * optional field. Prisma distinguishes the two natively.
 *
 * `name` and `displayOrder` are NOT NULL in the database, so both use
 * @ValidateIf rather than @IsOptional: @IsOptional also skips null, which would
 * let a null reach a NOT NULL column.
 *
 * `isActive` is absent on purpose — activation is a separate operation with its
 * own duplicate-name check.
 */
export class UpdateCustomPropertyDto {
  @ApiPropertyOptional({
    description: "Cannot be cleared — the column is NOT NULL.",
    maxLength: PROPERTY_NAME_MAX_LENGTH,
  })
  @ValidateIf((dto: UpdateCustomPropertyDto) => dto.name !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PROPERTY_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    maxLength: PROPERTY_DESCRIPTION_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(PROPERTY_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      "Send null to remove the configured amount. Changing it never recalculates historical Trips.",
    minimum: 0,
    maximum: MONEY_MAX_VALUE,
    nullable: true,
  })
  @Transform(rawValueOf)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  defaultPrice?: number | null;

  @ApiPropertyOptional({
    description: "Cannot be cleared — the column is NOT NULL.",
    minimum: 0,
    maximum: DISPLAY_ORDER_MAX,
  })
  @ValidateIf((dto: UpdateCustomPropertyDto) => dto.displayOrder !== undefined)
  @Transform(rawValueOf)
  @IsInt()
  @Min(0)
  @Max(DISPLAY_ORDER_MAX)
  displayOrder?: number;

  @ApiPropertyOptional({
    pattern: "^#[0-9A-Fa-f]{6}$",
    nullable: true,
  })
  @Transform(toCanonicalHexColor)
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: `color ${HEX_COLOR_MESSAGE}` })
  color?: string | null;
}
