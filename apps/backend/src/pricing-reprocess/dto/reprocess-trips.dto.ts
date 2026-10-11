import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

import { PricingSnapshotDto } from "../../trip-pricing/dto/pricing-snapshot.dto";

/** One Trip is still a bulk of one; the single endpoint remains for a detail page. */
export const MINIMUM_TRIPS_PER_REPROCESS = 1;

/** The Trips an operator selected for "Prijs herberekenen". */
export class ReprocessTripsDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    minItems: MINIMUM_TRIPS_PER_REPROCESS,
    description:
      "The selected Trips, all distinct. Each CLOSED one is matched and priced again in full; every other one is skipped and reported, never touched.",
    example: [
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    ],
  })
  @IsArray()
  @ArrayMinSize(MINIMUM_TRIPS_PER_REPROCESS)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tripIds!: string[];
}

/** What became of one selected Trip. */
export const TripReprocessOutcome = {
  /** Matched and priced again; `snapshot` is what was stored. */
  REPROCESSED: "REPROCESSED",
  /** Not priced: not CLOSED, or no such Trip. Nothing was written. */
  SKIPPED: "SKIPPED",
  /** Could not be priced; its previous snapshot is untouched. */
  FAILED: "FAILED",
} as const;

export type TripReprocessOutcome =
  (typeof TripReprocessOutcome)[keyof typeof TripReprocessOutcome];

export class TripReprocessResultDto {
  @ApiProperty({ format: "uuid" })
  tripId!: string;

  @ApiProperty({ enum: TripReprocessOutcome, enumName: "TripReprocessOutcome" })
  outcome!: TripReprocessOutcome;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      "Why it was not reprocessed: NOT_CLOSED or NOT_FOUND when skipped, the Pricing Engine's own error code when it failed. Null when reprocessed.",
    example: "NOT_CLOSED",
  })
  reasonCode!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "The reason in words, for the operator. Null when reprocessed.",
  })
  message!: string | null;

  @ApiPropertyOptional({
    type: PricingSnapshotDto,
    nullable: true,
    description:
      "The snapshot just stored — header, lines and matched route — read back from storage, as GET /trip-pricing/snapshots answers it. Null unless reprocessed.",
  })
  snapshot!: PricingSnapshotDto | null;
}

export class BulkReprocessResultDto {
  @ApiProperty({ example: 3 })
  reprocessedCount!: number;

  @ApiProperty({ example: 1 })
  skippedCount!: number;

  @ApiProperty({ example: 0 })
  failedCount!: number;

  @ApiProperty({
    type: [TripReprocessResultDto],
    description: "One result per requested Trip, in the order they were asked for.",
  })
  results!: TripReprocessResultDto[];
}
