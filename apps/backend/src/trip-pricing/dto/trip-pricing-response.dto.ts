import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PricingCalculationStatus, TripPricing } from "@prisma/client";

import { MONEY_DECIMAL_PLACES } from "../../common/dto/money";

/**
 * Public shape of a pricing snapshot.
 *
 * `totalPrice` is serialised as a fixed-precision string, not a JSON number.
 * The column is NUMERIC(12,2); rendering it as a float would reintroduce the
 * binary rounding the decimal type exists to avoid. That matters more here than
 * anywhere else in the system — this value is invoiced, exported to Excel and
 * expected to match the sum of its items exactly.
 */
export class TripPricingResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid", description: "The Trip this snapshot prices." })
  tripId!: string;

  @ApiProperty({
    description: "Calculated total, always with two decimals.",
    type: String,
    example: "482.35",
  })
  totalPrice!: string;

  @ApiProperty({
    description:
      "Always EUR. The column exists so future multi-currency support needs no migration.",
    example: "EUR",
  })
  currency!: string;

  @ApiProperty({
    format: "date-time",
    description: "When the calculation that produced this snapshot ran.",
  })
  calculatedAt!: Date;

  @ApiProperty({ example: "1.4.0" })
  pricingEngineVersion!: string;

  @ApiProperty({ example: "2026.08" })
  pricingRuleVersion!: string;

  @ApiProperty({ enum: PricingCalculationStatus })
  calculationStatus!: PricingCalculationStatus;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

export function toTripPricingResponse(
  tripPricing: TripPricing,
): TripPricingResponseDto {
  return {
    id: tripPricing.id,
    tripId: tripPricing.tripId,
    totalPrice: tripPricing.totalPrice.toFixed(MONEY_DECIMAL_PLACES),
    currency: tripPricing.currency,
    calculatedAt: tripPricing.calculatedAt,
    pricingEngineVersion: tripPricing.pricingEngineVersion,
    pricingRuleVersion: tripPricing.pricingRuleVersion,
    calculationStatus: tripPricing.calculationStatus,
    notes: tripPricing.notes,
    createdAt: tripPricing.createdAt,
    updatedAt: tripPricing.updatedAt,
  };
}
