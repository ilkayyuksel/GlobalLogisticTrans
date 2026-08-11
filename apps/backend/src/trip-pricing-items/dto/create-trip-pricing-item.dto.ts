import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
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

export const ITEM_DESCRIPTION_MAX_LENGTH = 500;
export const ITEM_NOTES_MAX_LENGTH = 2000;

/** pricing_rules.md numbers the calculation sequence from one. */
export const MIN_CALCULATION_ORDER = 1;
/** Guards against an absurd ordinal; the sequence has nine documented steps. */
export const MAX_CALCULATION_ORDER = 10_000;

/** `quantity` is NUMERIC(12,2), the same precision as the money columns. */
export const QUANTITY_DECIMAL_PLACES = MONEY_DECIMAL_PLACES;
export const QUANTITY_MAX_VALUE = MONEY_MAX_VALUE;

/**
 * Reads the raw request value so the pipe's implicit conversion cannot turn a
 * string or boolean into a number behind the validator's back — `"abc"` must be
 * rejected, not silently coerced into an amount.
 */
export function toRawNumber(params: Parameters<typeof rawValueOf>[0]): unknown {
  return rawValueOf(params);
}

/**
 * Body for persisting one line of a pricing breakdown.
 *
 * Every value is supplied by the caller — the future Pricing Engine — and
 * stored verbatim. This module derives no amount, multiplies no quantity by a
 * unit price, and infers no calculation order.
 *
 * `currency` is absent on purpose, exactly as on the parent snapshot:
 * pricing_rules.md states pricing is always calculated in EUR, and the column
 * already defaults to it.
 *
 * There is no type or kind field. An item is classified solely through its
 * PricingComponent, which database_model.md §4.14 names the single source of
 * truth — new pricing kinds arrive as new component rows, never as new columns.
 */
export class CreateTripPricingItemDto {
  @ApiProperty({
    format: "uuid",
    description:
      "The pricing snapshot this line belongs to. An item cannot exist without one.",
  })
  @IsUUID()
  tripPricingId!: string;

  @ApiProperty({
    format: "uuid",
    description:
      "Classifies the line — Base Price, Fuel Surcharge, Waiting Time, Toll, Custom Property, Manual Adjustment and so on. Must reference an active component.",
  })
  @IsUUID()
  pricingComponentId!: string;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "Reference Entity. Names the Custom Property that produced this line, and is only valid on an item classified CUSTOM_PROPERTY. The property need not still be active: a historical Trip keeps the properties it was assigned.",
  })
  @IsOptional()
  @IsUUID()
  customPropertyId?: string | null;

  @ApiProperty({
    description: "Human-readable label for this line of the breakdown.",
    maxLength: ITEM_DESCRIPTION_MAX_LENGTH,
    example: "Fuel surcharge",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ITEM_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiProperty({
    description:
      "The calculated amount for this line, as produced by the Pricing Engine. Stored as NUMERIC(12,2); at most two decimals. May be negative — database_model.md §4.14 allows it, and the column carries no sign constraint. See open point O6.",
    minimum: -MONEY_MAX_VALUE,
    maximum: MONEY_MAX_VALUE,
    example: 57.25,
  })
  @Transform(toRawNumber)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(-MONEY_MAX_VALUE)
  @Max(MONEY_MAX_VALUE)
  amount!: number;

  @ApiProperty({
    description:
      "Position in the calculation sequence defined by pricing_rules.md. Not unique: ordering is required, uniqueness is not.",
    minimum: MIN_CALCULATION_ORDER,
    maximum: MAX_CALCULATION_ORDER,
    example: 3,
  })
  @Transform(toRawNumber)
  @IsInt()
  @Min(MIN_CALCULATION_ORDER)
  @Max(MAX_CALCULATION_ORDER)
  calculationOrder!: number;

  @ApiPropertyOptional({
    description:
      "How many units this line charges for — billable waiting blocks, kilometres. A count is never negative, even though the amount it produces may be.",
    minimum: 0,
    maximum: QUANTITY_MAX_VALUE,
    nullable: true,
    example: 3,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: QUANTITY_DECIMAL_PLACES })
  @Min(0)
  @Max(QUANTITY_MAX_VALUE)
  quantity?: number | null;

  @ApiPropertyOptional({
    description:
      "Price per unit. Sign unconstrained, for the same reason as the amount.",
    minimum: -MONEY_MAX_VALUE,
    maximum: MONEY_MAX_VALUE,
    nullable: true,
    example: 19.5,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(-MONEY_MAX_VALUE)
  @Max(MONEY_MAX_VALUE)
  unitPrice?: number | null;

  @ApiPropertyOptional({
    description: "Free-text explanation of this line.",
    maxLength: ITEM_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(ITEM_NOTES_MAX_LENGTH)
  notes?: string | null;
}
