import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

/** One Trip is still a bulk of one; the single endpoint remains for a row. */
export const MINIMUM_TRIPS_PER_COMPLETION = 1;

/**
 * The request to complete several Trips at once.
 *
 * Only ids. Completion takes no other input — the target status is what the
 * endpoint IS, and a body that could name another status would be a second,
 * competing way to change a status.
 *
 * `@ArrayUnique` because the same id twice would otherwise be closed twice in
 * one request, and the second attempt would look like a state change that never
 * happened.
 */
export class CompleteTripsDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    minItems: MINIMUM_TRIPS_PER_COMPLETION,
    description:
      "The Trips to mark CLOSED. All distinct. Every one is checked against the same transition rules the single-Trip endpoint applies, and the whole request is refused if any of them cannot be closed.",
    example: [
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    ],
  })
  @IsArray()
  @ArrayMinSize(MINIMUM_TRIPS_PER_COMPLETION)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tripIds!: string[];
}
