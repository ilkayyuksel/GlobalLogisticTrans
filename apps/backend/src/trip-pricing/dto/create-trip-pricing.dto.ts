import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PricingCalculationStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import {
  MONEY_DECIMAL_PLACES,
  MONEY_MAX_VALUE,
} from "../../common/dto/money";
import { rawValueOf, trim, trimToNull } from "../../common/dto/transforms";

export const PRICING_VERSION_MAX_LENGTH = 100;
export const PRICING_NOTES_MAX_LENGTH = 2000;

/**
 * Reads the raw request value so the pipe's implicit conversion cannot turn a
 * string or boolean into a number behind the validator's back — `"abc"` must be
 * rejected, not silently coerced into a price.
 */
export function toRawNumber(params: Parameters<typeof rawValueOf>[0]): unknown {
  return rawValueOf(params);
}

/**
 * Body for persisting a pricing snapshot.
 *
 * Every value here is supplied by the caller — the future Pricing Engine — and
 * stored verbatim. This module computes nothing: it does not derive
 * `totalPrice`, does not stamp `calculatedAt`, and does not infer a status.
 * Accepting the values rather than producing them is what keeps the calculation
 * in one place and this module a pure store.
 *
 * `currency` is absent on purpose. pricing_rules.md states pricing is always
 * calculated in EUR, and the column already defaults to it. Accepting a
 * currency would imply a multi-currency capability that does not exist yet.
 */
export class CreateTripPricingDto {
  @ApiProperty({
    format: "uuid",
    description:
      "The Trip this snapshot prices. The Trip must exist, must be CLOSED, and must not already have a snapshot.",
  })
  @IsUUID()
  tripId!: string;

  @ApiProperty({
    description:
      "The calculated total, as produced by the Pricing Engine. Stored as NUMERIC(12,2); at most two decimals. Never recomputed here.",
    minimum: 0,
    maximum: MONEY_MAX_VALUE,
    example: 482.35,
  })
  @Transform(toRawNumber)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  totalPrice!: number;

  @ApiProperty({
    description:
      "When the calculation ran. Supplied by the caller rather than stamped here, so the snapshot records the calculation's own moment.",
    format: "date-time",
    example: "2026-08-11T09:15:00.000Z",
  })
  @IsDateString()
  calculatedAt!: string;

  @ApiProperty({
    description:
      "Version of the Pricing Engine that produced this result. Required, because a snapshot that cannot name its producer cannot be explained later.",
    maxLength: PRICING_VERSION_MAX_LENGTH,
    example: "1.4.0",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PRICING_VERSION_MAX_LENGTH)
  pricingEngineVersion!: string;

  @ApiProperty({
    description: "Version of the pricing rule set applied.",
    maxLength: PRICING_VERSION_MAX_LENGTH,
    example: "2026.08",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PRICING_VERSION_MAX_LENGTH)
  pricingRuleVersion!: string;

  @ApiProperty({
    enum: PricingCalculationStatus,
    description:
      "Outcome of the calculation. FAILED snapshots are stored too, so an unsuccessful run remains visible instead of leaving the Trip silently unpriced.",
    example: PricingCalculationStatus.CALCULATED,
  })
  @IsEnum(PricingCalculationStatus)
  calculationStatus!: PricingCalculationStatus;

  @ApiPropertyOptional({
    description:
      "Free-text explanation of the calculation, for example why it failed or why it was overridden.",
    maxLength: PRICING_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(PRICING_NOTES_MAX_LENGTH)
  notes?: string | null;
}
