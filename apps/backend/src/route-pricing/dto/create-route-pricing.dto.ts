import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

import { rawValueOf, trim, trimToNull } from "../../common/dto/transforms";

export const ROUTE_NAME_MAX_LENGTH = 200;
export const ROUTE_LOCATION_MAX_LENGTH = 200;
export const ROUTE_NOTES_MAX_LENGTH = 2000;

/** NUMERIC(12,2) holds ten integer digits and two decimals. */
export const BASE_PRICE_MAX = 9_999_999_999.99;
export const BASE_PRICE_DECIMAL_PLACES = 2;

/**
 * The bounds of a route's length.
 *
 * Two decimals and a ceiling that matches NUMERIC(8,2) — the same precision
 * `trip.distance_km` uses, because it is the same quantity measured on a
 * different thing. Ten thousand kilometres is far beyond any route this
 * business drives and well inside what the column can hold: it refuses the
 * impossible, not the unusual.
 */
export const ROUTE_KILOMETRES_DECIMAL_PLACES = 2;
export const ROUTE_KILOMETRES_MAX = 10_000;

/**
 * Reads the raw request value so the pipe's implicit conversion cannot turn a
 * string or boolean into a number behind the validator's back — `"abc"` must be
 * rejected, not silently coerced.
 */
export function toRawNumber(params: Parameters<typeof rawValueOf>[0]): unknown {
  return rawValueOf(params);
}

export class CreateRoutePricingDto {
  @ApiProperty({
    description: "Human-readable label for the route.",
    maxLength: ROUTE_NAME_MAX_LENGTH,
    example: "Antwerp - Rotterdam",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_NAME_MAX_LENGTH)
  routeName!: string;

  @ApiProperty({
    description:
      "Departure location. Together with destination it identifies the route, which must be unique among active records.",
    maxLength: ROUTE_LOCATION_MAX_LENGTH,
    example: "Antwerp",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_LOCATION_MAX_LENGTH)
  departure!: string;

  @ApiProperty({
    description: "Destination location.",
    maxLength: ROUTE_LOCATION_MAX_LENGTH,
    example: "Rotterdam",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_LOCATION_MAX_LENGTH)
  destination!: string;

  @ApiProperty({
    description:
      "Configured base price in EUR. Stored as NUMERIC(12,2); at most two decimals.",
    minimum: 0,
    maximum: BASE_PRICE_MAX,
    example: 380.0,
  })
  @Transform(toRawNumber)
  @IsNumber({ maxDecimalPlaces: BASE_PRICE_DECIMAL_PLACES })
  @Min(0)
  @Max(BASE_PRICE_MAX)
  basePrice!: number;

  @ApiPropertyOptional({
    description:
      "Length of the route in kilometres, to two decimals. The Toll is derived from it and the configured toll rate, so a route without it is charged no toll.",
    minimum: 0,
    maximum: ROUTE_KILOMETRES_MAX,
    nullable: true,
    example: 25,
  })
  @Transform(toRawNumber)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: ROUTE_KILOMETRES_DECIMAL_PLACES })
  @Min(0)
  @Max(ROUTE_KILOMETRES_MAX)
  kilometres?: number | null;

  @ApiPropertyOptional({
    maxLength: ROUTE_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(ROUTE_NOTES_MAX_LENGTH)
  notes?: string | null;
}
