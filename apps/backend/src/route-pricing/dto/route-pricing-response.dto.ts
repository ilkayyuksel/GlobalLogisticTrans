import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RoutePricing } from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";
import { BASE_PRICE_DECIMAL_PLACES } from "./create-route-pricing.dto";

/**
 * Public shape of a RoutePricing.
 *
 * `basePrice` is serialised as a fixed-precision string, not a JSON number.
 * The column is NUMERIC(12,2); rendering it as a float would reintroduce the
 * binary rounding that the decimal type exists to avoid, which matters because
 * the Pricing Engine will read these values.
 */
export class RoutePricingResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Antwerp - Rotterdam" })
  routeName!: string;

  @ApiProperty({ example: "Antwerp" })
  departure!: string;

  @ApiProperty({ example: "Rotterdam" })
  destination!: string;

  @ApiProperty({
    description: "Base price in EUR, always with two decimals.",
    type: String,
    example: "380.00",
  })
  basePrice!: string;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({
    description:
      "Only active records are eligible for pricing. Deactivated records are retained so historical Trip pricing stays reproducible.",
  })
  isActive!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class PaginatedRoutePricingDto {
  @ApiProperty({ type: [RoutePricingResponseDto] })
  items!: RoutePricingResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export function toRoutePricingResponse(
  routePricing: RoutePricing,
): RoutePricingResponseDto {
  return {
    id: routePricing.id,
    routeName: routePricing.routeName,
    departure: routePricing.departure,
    destination: routePricing.destination,
    basePrice: routePricing.basePrice.toFixed(BASE_PRICE_DECIMAL_PLACES),
    notes: routePricing.notes,
    isActive: routePricing.isActive,
    createdAt: routePricing.createdAt,
    updatedAt: routePricing.updatedAt,
  };
}
