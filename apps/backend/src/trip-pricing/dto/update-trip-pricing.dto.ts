import { ApiPropertyOptional } from "@nestjs/swagger";
import { PricingCalculationStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

import { trimToNull } from "../../common/dto/transforms";
import { PRICING_NOTES_MAX_LENGTH } from "./create-trip-pricing.dto";

/**
 * Partial update of a snapshot's CALCULATION METADATA.
 *
 * Only the two fields that can legitimately change without a recalculation are
 * exposed: the status of the calculation, and the note explaining it.
 *
 * Everything else is deliberately excluded, and the global ValidationPipe runs
 * with forbidNonWhitelisted so sending it is rejected with 400 rather than
 * ignored:
 *
 *   - `totalPrice` and `currency` are the calculated result. Changing an amount
 *     without re-running the engine would produce a total no calculation ever
 *     produced, and the schema requires it to equal the sum of its items.
 *   - `calculatedAt`, `pricingEngineVersion` and `pricingRuleVersion` describe
 *     which run produced the amount. Editing them while the amount stands still
 *     would make the snapshot claim an origin it does not have, and historical
 *     pricing must remain explainable.
 *   - `tripId` is the identity of the snapshot's owner and never moves.
 *
 * Replacing the amounts is a reprocessing operation. It belongs to the Pricing
 * Engine and is not part of this module.
 */
export class UpdateTripPricingDto {
  @ApiPropertyOptional({
    enum: PricingCalculationStatus,
    description:
      "Corrects the recorded outcome, for example marking a result as MANUAL_OVERRIDE. Never triggers a recalculation.",
  })
  @IsOptional()
  @IsEnum(PricingCalculationStatus)
  calculationStatus?: PricingCalculationStatus;

  @ApiPropertyOptional({
    description: "Explanation of the calculation. Send null to clear.",
    maxLength: PRICING_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(PRICING_NOTES_MAX_LENGTH)
  notes?: string | null;
}
