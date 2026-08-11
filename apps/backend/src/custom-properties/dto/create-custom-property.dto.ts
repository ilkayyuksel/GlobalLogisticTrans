import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
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
} from "class-validator";

import {
  HEX_COLOR_MESSAGE,
  HEX_COLOR_PATTERN,
  toCanonicalHexColor,
} from "../../common/dto/color";
import { MONEY_DECIMAL_PLACES, MONEY_MAX_VALUE } from "../../common/dto/money";
import { rawValueOf, trim, trimToNull } from "../../common/dto/transforms";

export const PROPERTY_NAME_MAX_LENGTH = 100;
export const PROPERTY_DESCRIPTION_MAX_LENGTH = 500;

/** Generous upper bound; the column is a plain INTEGER. */
export const DISPLAY_ORDER_MAX = 100_000;

export class CreateCustomPropertyDto {
  @ApiProperty({
    description: "Property name. Must be unique among active properties.",
    maxLength: PROPERTY_NAME_MAX_LENGTH,
    example: "TAR",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PROPERTY_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    maxLength: PROPERTY_DESCRIPTION_MAX_LENGTH,
    nullable: true,
    example: "Terminal Access Regulation surcharge.",
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(PROPERTY_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      "Amount the Pricing Engine will read at calculation time. Stored as configuration only — nothing is calculated here.",
    minimum: 0,
    maximum: MONEY_MAX_VALUE,
    nullable: true,
    example: 35,
  })
  @Transform(rawValueOf)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  defaultPrice?: number | null;

  @ApiPropertyOptional({
    description:
      "Position in the selection list. Omit to append after the current highest order.",
    minimum: 0,
    maximum: DISPLAY_ORDER_MAX,
    example: 1,
  })
  @Transform(rawValueOf)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DISPLAY_ORDER_MAX)
  displayOrder?: number;

  @ApiPropertyOptional({
    description: "Display colour as a six-digit hex value, normalised to lowercase.",
    pattern: "^#[0-9A-Fa-f]{6}$",
    nullable: true,
    example: "#f59e0b",
  })
  @Transform(toCanonicalHexColor)
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: `color ${HEX_COLOR_MESSAGE}` })
  color?: string | null;
}
