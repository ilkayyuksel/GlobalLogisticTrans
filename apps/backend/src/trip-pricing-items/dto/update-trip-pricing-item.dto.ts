import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";

import { trimToNull } from "../../common/dto/transforms";
import { ITEM_NOTES_MAX_LENGTH } from "./create-trip-pricing-item.dto";

/**
 * Partial update of a pricing line's NOTE. Nothing else.
 *
 * Historical pricing must remain immutable, and every other column is part of
 * the calculated result or of its provenance:
 *
 *   - `amount`, `quantity`, `unitPrice` and `currency` are what the Pricing
 *     Engine calculated. Editing one would break the parent's requirement that
 *     `total_price` equal the sum of its items, silently and invisibly.
 *   - `pricingComponentId` classifies the line, and `customPropertyId` explains
 *     why it exists. Re-pointing either would rewrite history.
 *   - `description` labels the line the Engine produced.
 *   - `calculationOrder` is the sequence the calculation actually followed.
 *   - `tripPricingId` is the identity of the line's owner and never moves.
 *
 * Replacing a breakdown is a reprocessing operation: it deletes the whole item
 * set with its parent and recalculates. It belongs to the Pricing Engine and is
 * not part of this module.
 *
 * The global ValidationPipe runs with forbidNonWhitelisted, so sending any of
 * the above is rejected with 400 rather than ignored.
 */
export class UpdateTripPricingItemDto {
  @ApiPropertyOptional({
    description:
      "Explanation of this line, the only field an administrator may correct after the fact. Send null to clear.",
    maxLength: ITEM_NOTES_MAX_LENGTH,
    nullable: true,
  })
  @Transform(trimToNull)
  @IsOptional()
  @IsString()
  @MaxLength(ITEM_NOTES_MAX_LENGTH)
  notes?: string | null;
}
