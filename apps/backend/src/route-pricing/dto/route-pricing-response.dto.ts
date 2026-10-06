import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RoutePricing } from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";
import { CombinationRouteGroup } from "@prisma/client";

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

  @ApiProperty({
    description:
      "Whether an administrator has been through this route's prices. Bookkeeping only: nothing about pricing reads it, and an unreviewed route prices exactly as a reviewed one does. Meaningless on a Combination leg, whose group carries the mark.",
  })
  reviewed!: boolean;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/**
 * Over ST: the Combination's own Tarief, Toll and Tunnel.
 *
 * Fixed-2 strings like every amount here, or null when nobody has stated one.
 * Configuration only: the Pricing Engine does not read these yet.
 */
export class CombinationOverStDto {
  @ApiProperty({ type: String, nullable: true, example: "50.00" })
  tarief!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "5.00" })
  toll!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "0.00" })
  tunnel!: string | null;
}

/** The Over ST amounts of a stored group, as the API carries them. */
export function toCombinationOverSt(
  group: Pick<CombinationRouteGroup, "overStBasePrice" | "overStToll" | "overStTunnel">,
): CombinationOverStDto {
  const money = (value: CombinationRouteGroup["overStToll"]) =>
    value === null ? null : value.toFixed(BASE_PRICE_DECIMAL_PLACES);

  return {
    tarief: money(group.overStBasePrice),
    toll: money(group.overStToll),
    tunnel: money(group.overStTunnel),
  };
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
    description:
      "Whether an administrator has been through this Combination's prices. On the group, because the group is what a person configures, edits, removes and therefore reviews.",
  })
  reviewed!: boolean;

  @ApiProperty({
    type: [RoutePricingResponseDto],
    description: "Exactly two legs, outbound first.",
  })
  legs!: RoutePricingResponseDto[];

  @ApiProperty({ type: CombinationOverStDto })
  overSt!: CombinationOverStDto;

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
    combinationGroupId: routePricing.combinationGroupId,
    combinationLegPosition: routePricing.combinationLegPosition,
    reviewed: routePricing.reviewed,
    notes: routePricing.notes,
    createdAt: routePricing.createdAt,
    updatedAt: routePricing.updatedAt,
  };
}
