import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  PricingCalculationStatus,
  RouteMatchMethod,
  TripPricing,
} from "@prisma/client";

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

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "The route configuration this calculation took its Tarief, Toll and Tunnel from; null when none matched or the snapshot predates the record.",
  })
  routePricingId!: string | null;

  @ApiPropertyOptional({
    enum: RouteMatchMethod,
    enumName: "RouteMatchMethod",
    nullable: true,
    description:
      "How that route was matched. Null on a snapshot written before this was recorded. The full account — the road(s) and the Combination — is `routeMatch` on the snapshot read.",
  })
  routeMatchMethod!: RouteMatchMethod | null;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  combinationRouteGroupId!: string | null;

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
    routePricingId: tripPricing.routePricingId,
    routeMatchMethod: tripPricing.routeMatch,
    combinationRouteGroupId: tripPricing.combinationRouteGroupId,
    createdAt: tripPricing.createdAt,
    updatedAt: tripPricing.updatedAt,
  };
}
