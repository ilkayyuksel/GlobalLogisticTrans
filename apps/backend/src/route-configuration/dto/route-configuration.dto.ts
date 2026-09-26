import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsString,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from "class-validator";

import { MONEY_DECIMAL_PLACES, MONEY_MAX_VALUE } from "../../common/dto/money";
import { rawValueOf, trim } from "../../common/dto/transforms";
import { RouteCostResponseDto } from "../../route-costs/dto/route-cost-response.dto";
import {
  ROUTE_KILOMETRES_DECIMAL_PLACES,
  ROUTE_KILOMETRES_MAX,
} from "../../route-pricing/dto/create-route-pricing.dto";
import { RoutePricingResponseDto } from "../../route-pricing/dto/route-pricing-response.dto";
import { LEGS_PER_COMBINATION_ROUTE } from "../../route-pricing/exceptions/route-pricing.exceptions";

/**
 * Which kind of route configuration a record is.
 *
 * ── THE DISCRIMINATOR, SPELLED OUT IN THE API ───────────────────────────────
 * NORMAL is an ordinary route standing on its own. COMBINATION is one LEG of a
 * route group that always has exactly two — an outbound and a return, each with
 * its own Tarief, KM and Tunnel, because the two legitimately cost different
 * amounts.
 *
 * Both kinds may describe the same departure and destination. That is not a
 * duplicate: they are read in different pricing contexts, and neither overwrites
 * the other. Every record says which kind it is rather than leaving a caller to
 * infer it from where it was listed.
 *
 * This has nothing to do with a Trip group in the Rittenlijst. That group decides
 * which Trips carry the Backload; this decides what a route COSTS.
 */
export const RouteConfigurationType = {
  NORMAL: "NORMAL",
  COMBINATION: "COMBINATION",
} as const;

export type RouteConfigurationType =
  (typeof RouteConfigurationType)[keyof typeof RouteConfigurationType];

/** Money leaves as exact decimal text, never as a JSON number. */
const ZERO_AMOUNT = (0).toFixed(MONEY_DECIMAL_PLACES);

/** Long enough for any real place name; short enough to stay a place name. */
export const ROUTE_ENDPOINT_MAX_LENGTH = 255;

/**
 * One route, as an operator configures it.
 *
 * ── WHY THIS SHAPE DOES NOT MATCH THE TABLES ────────────────────────────────
 * The database stores a route's price in `route_pricing` and each of its
 * route-dependent costs in `route_cost`, one row per pricing component. That
 * split is right for the Engine: it reads a base price and a set of component
 * costs, and a component can be added without touching the price.
 *
 * It is wrong for a person. An operator configuring "Quay 869 to Dourges"
 * thinks of ONE route with three amounts on it, not of three records to keep in
 * step. Asking them to manage a price row and two cost rows would make a
 * half-configured route — a toll with no tariff, a tariff whose tunnel was
 * forgotten — an ordinary mistake rather than an impossible state.
 *
 * So this is an APPLICATION-LAYER abstraction over the existing tables. There
 * is no new table and no migration: the composition happens in the service,
 * which writes through the existing RoutePricing and RouteCost services and
 * therefore inherits every rule they already enforce.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class RouteConfigurationDto {
  @ApiProperty({
    format: "uuid",
    description:
      "Identity of the configuration, which is the identity of its RoutePricing record. The route costs beneath it are found by the route rather than by this id.",
  })
  id!: string;

  @ApiProperty({
    example: "Quay 869",
    description:
      "Where the route starts, as it was typed. A terminal matches on its canonical form, so PSA Quay 869 and Quay 869 are the same departure.",
  })
  departure!: string;

  @ApiProperty({ example: "Dourges" })
  destination!: string;

  @ApiProperty({
    type: String,
    example: "520.00",
    description:
      "The base price, as a fixed-2 decimal string. Money is never a JSON number.",
  })
  tarief!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "25.00",
    description:
      "The length of the route in kilometres, as a fixed-2 decimal string, or null when nobody has stated it. The Toll a Trip pays is this distance times the configured toll rate, so a route without it is charged no toll.",
  })
  kilometres!: string | null;

  @ApiProperty({ type: String, example: "0.00" })
  tunnel!: string;

  @ApiProperty()
  hasTunnel!: boolean;

  @ApiProperty({
    enum: Object.values(RouteConfigurationType),
    description:
      "NORMAL is an ordinary route; COMBINATION is one leg of a two-leg Combination configuration, which is edited and removed as a whole.",
  })
  type!: RouteConfigurationType;

  @ApiProperty({
    format: "uuid",
    nullable: true,
    description:
      "The Combination this record is a leg of, or null for an ordinary route.",
  })
  combinationGroupId!: string | null;
}

/**
 * One route, read back from the records that store it.
 *
 * Shared by both configuration services: an ordinary route and a Combination leg
 * are the same shape and are composed the same way, and the only difference — the
 * kind — comes straight off the stored discriminator rather than from whichever
 * service happened to ask.
 */
export function composeRouteConfiguration(
  route: RoutePricingResponseDto,
  tunnel: RouteCostResponseDto | null,
): RouteConfigurationDto {
  return {
    id: route.id,
    departure: route.departure,
    destination: route.destination,
    tarief: route.basePrice,
    // Null travels as null: "nobody has stated the distance" is not the same as
    // a route of no length, and only the first one charges no toll.
    kilometres: route.kilometres,
    tunnel: tunnel?.amount ?? ZERO_AMOUNT,
    hasTunnel: tunnel !== null,
    /*
     * Truthiness rather than a null check: an absent discriminator must read as
     * an ordinary route. Marking one as a Combination is the more damaging
     * mistake of the two, because it would offer an operator a leg to edit that
     * belongs to no pair.
     */
    type: route.combinationGroupId
      ? RouteConfigurationType.COMBINATION
      : RouteConfigurationType.NORMAL,
    combinationGroupId: route.combinationGroupId ?? null,
  };
}

/**
 * The name the underlying price record carries.
 *
 * RoutePricing requires one and this screen does not ask for it: an operator
 * configuring a route has already said what it is by naming both ends, and a
 * second free-text field would be a name that could disagree with them.
 */
export function routeNameOf(route: {
  departure: string;
  destination: string;
}): string {
  return `${route.departure} - ${route.destination}`;
}

/**
 * The amounts a route carries.
 *
 * All of them are required on create: a route configured through this screen is
 * complete by construction, which is the whole reason the abstraction exists.
 * Zero is legitimate for each — a route genuinely without a tunnel, or one that
 * is nought kilometres of tolled road — and is stored as an explicit zero
 * rather than as an absence.
 */
export class SaveRouteConfigurationDto {
  @ApiProperty({
    example: "Quay 869",
    maxLength: ROUTE_ENDPOINT_MAX_LENGTH,
    description:
      "Free text. There is no terminal master data in this system and no city list: the operator types what the route is. A terminal still MATCHES canonically.",
  })
  @Transform(trim)
  @IsString()
  @MaxLength(ROUTE_ENDPOINT_MAX_LENGTH)
  departure!: string;

  @ApiProperty({ example: "Dourges", maxLength: ROUTE_ENDPOINT_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @MaxLength(ROUTE_ENDPOINT_MAX_LENGTH)
  destination!: string;

  @ApiProperty({ example: 520, minimum: 0, maximum: MONEY_MAX_VALUE })
  @Transform(rawValueOf)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  tarief!: number;

  /*
   * A DISTANCE, not an amount: the Toll is derived from it and the configured
   * rate per kilometre. Two decimals, as `trip.distance_km` has always had.
   */
  @ApiProperty({
    example: 25,
    minimum: 0,
    maximum: ROUTE_KILOMETRES_MAX,
    description:
      "Length of the route in kilometres. The Toll is this times the configured toll rate per kilometre; no toll amount is stored per route.",
  })
  @Transform(rawValueOf)
  @IsNumber({ maxDecimalPlaces: ROUTE_KILOMETRES_DECIMAL_PLACES })
  @Min(0)
  @Max(ROUTE_KILOMETRES_MAX)
  kilometres!: number;

  @ApiProperty({ example: 0, minimum: 0, maximum: MONEY_MAX_VALUE })
  @Transform(rawValueOf)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  tunnel!: number;
}

/**
 * One Combination route configuration: a group and its two legs.
 *
 * ── WHY THE GROUP IS IN THE PAYLOAD ─────────────────────────────────────────
 * The legs are edited and removed together, so the identity a caller acts on is
 * the group's and not a leg's. Presenting the pair as two loose routes would
 * offer an operator a way to delete half a Combination, which is exactly the
 * state the model refuses to store.
 */
export class CombinationRouteConfigurationDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({
    type: [RouteConfigurationDto],
    description: `Exactly ${LEGS_PER_COMBINATION_ROUTE} legs, the outbound first.`,
  })
  legs!: RouteConfigurationDto[];
}

/**
 * The two legs of a Combination, as an operator configures them.
 *
 * ── WHY THE COUNT IS VALIDATED HERE TOO ─────────────────────────────────────
 * The service refuses any number but two and writes both in one transaction, and
 * the database refuses a third leg outright. This refuses the request before any
 * of that runs, so a caller sending one leg gets a validation error naming the
 * field rather than a conflict from deeper down.
 */
export class SaveCombinationRouteConfigurationDto {
  @ApiProperty({
    type: [SaveRouteConfigurationDto],
    minItems: LEGS_PER_COMBINATION_ROUTE,
    maxItems: LEGS_PER_COMBINATION_ROUTE,
    description: `Exactly ${LEGS_PER_COMBINATION_ROUTE} legs — the outbound first, then the return. Each carries its own Van, Naar, Tarief, KM and Tunnel: the two directions legitimately cost different amounts.`,
  })
  @IsArray()
  @ArrayMinSize(LEGS_PER_COMBINATION_ROUTE)
  @ArrayMaxSize(LEGS_PER_COMBINATION_ROUTE)
  @ValidateNested({ each: true })
  @Type(() => SaveRouteConfigurationDto)
  legs!: SaveRouteConfigurationDto[];
}
