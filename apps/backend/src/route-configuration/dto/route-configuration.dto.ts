import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsNumber, IsString, Max, Min, MaxLength } from "class-validator";

import { MONEY_DECIMAL_PLACES, MONEY_MAX_VALUE } from "../../common/dto/money";
import { rawValueOf, trim } from "../../common/dto/transforms";

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
    example: "18.00",
    description:
      "The configured Toll for this route. \"0.00\" both when it is configured as zero and when it is not configured at all — the two are indistinguishable to a price, and `hasToll` says which it is.",
  })
  toll!: string;

  @ApiProperty({ type: String, example: "0.00" })
  tunnel!: string;

  @ApiProperty({
    description:
      "True when a Toll cost is actually configured for this route, as opposed to absent. A Trip carrying the Toll property on a route with no Toll cost is charged nothing and the gap is logged.",
  })
  hasToll!: boolean;

  @ApiProperty()
  hasTunnel!: boolean;

  @ApiProperty({
    description:
      "Only an ACTIVE configuration prices a Trip. Deactivating keeps the record and its history.",
  })
  isActive!: boolean;
}

/**
 * The amounts a route carries.
 *
 * All three are required on create: a route configured through this screen is
 * complete by construction, which is the whole reason the abstraction exists.
 * Zero is a legitimate amount for any of them — a route genuinely without a
 * tunnel — and is stored as an explicit zero rather than as an absence.
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

  @ApiProperty({ example: 18, minimum: 0, maximum: MONEY_MAX_VALUE })
  @Transform(rawValueOf)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  toll!: number;

  @ApiProperty({ example: 0, minimum: 0, maximum: MONEY_MAX_VALUE })
  @Transform(rawValueOf)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  tunnel!: number;
}

/** Activating or deactivating one configuration. */
export class ChangeRouteConfigurationStateDto {
  @ApiPropertyOptional({
    description:
      "True activates the configuration, false deactivates it. Deactivating never deletes: the record and everything priced against it stay.",
  })
  @Transform(rawValueOf)
  @IsBoolean()
  isActive!: boolean;
}
