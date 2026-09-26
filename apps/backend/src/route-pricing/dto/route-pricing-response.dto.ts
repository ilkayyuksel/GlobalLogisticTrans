import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RoutePricing } from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";
import {
  BASE_PRICE_DECIMAL_PLACES,
  ROUTE_KILOMETRES_DECIMAL_PLACES,
} from "./create-route-pricing.dto";

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

  @ApiPropertyOptional({
    description:
      "Length of the route in kilometres, always with two decimals. Null when nobody has stated it, in which case no toll is charged.",
    type: String,
    nullable: true,
    example: "25.00",
  })
  kilometres!: string | null;

  @ApiPropertyOptional({
    description:
      "The Combination route configuration this record is a leg of, or null when it is an ordinary route. Both kinds may describe the same departure and destination: they are read in different pricing contexts and neither overwrites the other.",
    format: "uuid",
    nullable: true,
  })
  combinationGroupId!: string | null;

  @ApiPropertyOptional({
    description:
      "Which leg of the Combination this is — 1 the outbound, 2 the return — or null for an ordinary route.",
    type: Number,
    nullable: true,
    example: 1,
  })
  combinationLegPosition!: number | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/**
 * One Combination route configuration: a group and its two legs.
 *
 * The legs come back in configured order — the outbound first — and there are
 * always exactly two. A group with any other number of legs is not a state the
 * application can produce.
 */
export class CombinationRoutePricingDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({
    type: [RoutePricingResponseDto],
    description: "Exactly two legs, outbound first.",
  })
  legs!: RoutePricingResponseDto[];

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
    /*
     * Exact decimal text, like every other number that leaves this API: a
     * distance multiplied by a rate is money, and money is never a float.
     */
    kilometres:
      routePricing.kilometres === null
        ? null
        : routePricing.kilometres.toFixed(ROUTE_KILOMETRES_DECIMAL_PLACES),
    combinationGroupId: routePricing.combinationGroupId,
    combinationLegPosition: routePricing.combinationLegPosition,
    notes: routePricing.notes,
    createdAt: routePricing.createdAt,
    updatedAt: routePricing.updatedAt,
  };
}
