import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import { trim, trimToNull } from "../../common/dto/transforms";
import {
  BASE_PRICE_DECIMAL_PLACES,
  BASE_PRICE_MAX,
  ROUTE_LOCATION_MAX_LENGTH,
  ROUTE_NAME_MAX_LENGTH,
  ROUTE_NOTES_MAX_LENGTH,
  toRawNumber,
} from "./create-route-pricing.dto";

/**
 * Partial update. Omitted fields are left untouched; an explicit null clears an
 * optional field. Prisma distinguishes the two natively.
 *
 * Every field except `notes` is NOT NULL in the database, so each uses
 * @ValidateIf rather than @IsOptional: @IsOptional also skips null, which would
 * let a null reach a NOT NULL column.
 *
 * `isActive` is absent on purpose — activation is a separate operation with its
 * own duplicate-route check.
 */
export class UpdateRoutePricingDto {
  @ApiPropertyOptional({
    description: "Cannot be cleared — the column is NOT NULL.",
    maxLength: ROUTE_NAME_MAX_LENGTH,
  })
  @ValidateIf((dto: UpdateRoutePricingDto) => dto.routeName !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_NAME_MAX_LENGTH)
  routeName?: string;

  @ApiPropertyOptional({
    description:
      "Changing departure or destination re-checks the active-route uniqueness rule.",
    maxLength: ROUTE_LOCATION_MAX_LENGTH,
  })
  @ValidateIf((dto: UpdateRoutePricingDto) => dto.departure !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_LOCATION_MAX_LENGTH)
  departure?: string;

  @ApiPropertyOptional({ maxLength: ROUTE_LOCATION_MAX_LENGTH })
  @ValidateIf((dto: UpdateRoutePricingDto) => dto.destination !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_LOCATION_MAX_LENGTH)
  destination?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: BASE_PRICE_MAX })
  @ValidateIf((dto: UpdateRoutePricingDto) => dto.basePrice !== undefined)
  @Transform(toRawNumber)
  @IsNumber({ maxDecimalPlaces: BASE_PRICE_DECIMAL_PLACES })
  @Min(0)
  @Max(BASE_PRICE_MAX)
  basePrice?: number;

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
