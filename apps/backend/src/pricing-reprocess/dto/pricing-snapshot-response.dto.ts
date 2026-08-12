import { ApiProperty } from "@nestjs/swagger";

import { TripPricingItemResponseDto } from "../../trip-pricing-items/dto/trip-pricing-item-response.dto";
import { TripPricingResponseDto } from "../../trip-pricing/dto/trip-pricing-response.dto";

/**
 * A pricing snapshot together with the breakdown that explains it.
 *
 * Composed from the two existing response DTOs rather than redefining their
 * fields: a snapshot and a pricing line each have exactly one public shape in
 * this API, and a field added to either appears here without a second mapper to
 * keep in step. The composition exists only because neither DTO alone carries
 * both halves, and a reprocess result is meaningless without both — a total
 * whose lines are fetched separately could be read while the two disagree.
 *
 * Every monetary value keeps the fixed-two-decimal string serialisation the
 * underlying DTOs already apply.
 */
export class PricingSnapshotResponseDto {
  @ApiProperty({
    type: TripPricingResponseDto,
    description: "The stored snapshot: total, versions, status and timestamps.",
  })
  pricing!: TripPricingResponseDto;

  @ApiProperty({
    type: [TripPricingItemResponseDto],
    description: "Every line of the snapshot, in calculation order.",
  })
  items!: TripPricingItemResponseDto[];
}
