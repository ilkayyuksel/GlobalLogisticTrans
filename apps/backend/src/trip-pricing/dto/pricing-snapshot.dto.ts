import { ApiProperty } from "@nestjs/swagger";

import { TripPricingItemResponseDto } from "../../trip-pricing-items/dto/trip-pricing-item-response.dto";
import { TripPricingResponseDto } from "./trip-pricing-response.dto";

/**
 * One Trip's stored pricing: the snapshot and the lines that make it up.
 *
 * The two belong together — a total without its breakdown cannot be explained,
 * and a breakdown without its total cannot be checked — so a bulk read returns
 * them as one object rather than as two lists a caller has to rejoin.
 */
export class PricingSnapshotDto {
  @ApiProperty({ type: TripPricingResponseDto })
  pricing!: TripPricingResponseDto;

  @ApiProperty({
    type: [TripPricingItemResponseDto],
    description: "Every line of the snapshot, in calculation order.",
  })
  items!: TripPricingItemResponseDto[];
}
