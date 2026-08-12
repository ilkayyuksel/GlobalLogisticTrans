import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
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

/**
 * Locations are matched against Trip fields, so these bounds mirror the ones
 * RoutePricing uses for the same two columns.
 */
export const ROUTE_COST_LOCATION_MAX_LENGTH = 200;
export const ROUTE_COST_NOTES_MAX_LENGTH = 2000;

export class CreateRouteCostDto {
  @ApiProperty({
    description:
      "Departure location, matched against the Trip terminal. Together with destination and pricingComponentId it identifies the record, which must be unique among active rows.",
    maxLength: ROUTE_COST_LOCATION_MAX_LENGTH,
    example: "Antwerp Terminal",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_COST_LOCATION_MAX_LENGTH)
  departure!: string;

  @ApiProperty({
    description:
      "Destination location, matched against the Trip destination city.",
    maxLength: ROUTE_COST_LOCATION_MAX_LENGTH,
    example: "Rotterdam",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_COST_LOCATION_MAX_LENGTH)
  destination!: string;

  @ApiProperty({
    description:
      "The route-priced pricing component this amount belongs to, such as TOLL or TUNNEL. A component is route-priced when a custom property links to it; any other component is rejected.",
    format: "uuid",
  })
  @IsUUID()
  pricingComponentId!: string;

  @ApiProperty({
    description:
      "Cost of this component on this route, in EUR. Stored as NUMERIC(12,2); at most two decimals. Never negative — a route cost is a charge, and a reduction is expressed elsewhere.",
    minimum: 0,
    maximum: MONEY_MAX_VALUE,
    example: 24.5,
  })
  // Reads the raw request value so the pipe's implicit conversion cannot turn a
  // string or boolean into a number behind the validator's back.
  @Transform(rawValueOf)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  amount!: number;

  @ApiPropertyOptional({
    description: "Free-text note, for example the tariff this amount came from.",
    maxLength: ROUTE_COST_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(ROUTE_COST_NOTES_MAX_LENGTH)
  notes?: string | null;
}
