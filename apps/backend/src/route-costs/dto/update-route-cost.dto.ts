import { ApiPropertyOptional } from "@nestjs/swagger";
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
  ValidateIf,
} from "class-validator";

import { MONEY_DECIMAL_PLACES, MONEY_MAX_VALUE } from "../../common/dto/money";
import { rawValueOf, trim, trimToNull } from "../../common/dto/transforms";
import {
  ROUTE_COST_LOCATION_MAX_LENGTH,
  ROUTE_COST_NOTES_MAX_LENGTH,
} from "./create-route-cost.dto";

/**
 * Partial update. Omitted fields are left untouched; an explicit null clears
 * notes. Prisma distinguishes the two natively.
 *
 * Every field except `notes` is NOT NULL in the database, so each uses
 * @ValidateIf rather than @IsOptional: @IsOptional also skips null, which would
 * let a null reach a NOT NULL column.
 *
 * `isActive` is absent on purpose — activation is a separate operation with its
 * own uniqueness check.
 */
export class UpdateRouteCostDto {
  @ApiPropertyOptional({
    description:
      "Changing departure, destination or the component re-checks the active-uniqueness rule.",
    maxLength: ROUTE_COST_LOCATION_MAX_LENGTH,
  })
  @ValidateIf((dto: UpdateRouteCostDto) => dto.departure !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_COST_LOCATION_MAX_LENGTH)
  departure?: string;

  @ApiPropertyOptional({ maxLength: ROUTE_COST_LOCATION_MAX_LENGTH })
  @ValidateIf((dto: UpdateRouteCostDto) => dto.destination !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(ROUTE_COST_LOCATION_MAX_LENGTH)
  destination?: string;

  @ApiPropertyOptional({
    description:
      "Moving the record to another component. The new component must exist and must be route-priced.",
    format: "uuid",
  })
  @ValidateIf((dto: UpdateRouteCostDto) => dto.pricingComponentId !== undefined)
  @IsUUID()
  pricingComponentId?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MONEY_MAX_VALUE })
  @ValidateIf((dto: UpdateRouteCostDto) => dto.amount !== undefined)
  @Transform(rawValueOf)
  @IsNumber({ maxDecimalPlaces: MONEY_DECIMAL_PLACES })
  @Min(0)
  @Max(MONEY_MAX_VALUE)
  amount?: number;

  @ApiPropertyOptional({
    maxLength: ROUTE_COST_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(ROUTE_COST_NOTES_MAX_LENGTH)
  notes?: string | null;
}
