import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

/** One Trip is still a bulk of one; a row may also be classified on its own. */
export const MINIMUM_TRIPS_PER_CLASSIFICATION = 1;

/**
 * The request to mark several Trips as LOSRIT.
 *
 * Only ids, and deliberately no boolean. The classification this endpoint
 * applies is what the endpoint IS; a body that could also say `false` would be
 * a second, competing way to change a value that `PATCH /trips/:id` already
 * owns — and it would make "unmark them all" reachable by accident from a
 * control that says "Losrit".
 *
 * `@ArrayUnique` for the same reason completion uses it: the same id twice is a
 * mistake worth reporting rather than silently absorbing.
 */
export class MarkTripsLooseDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    minItems: MINIMUM_TRIPS_PER_CLASSIFICATION,
    description:
      "The Trips to mark as LOSRIT. All distinct. A Trip that already is one is left alone rather than refused; a Trip that belongs to a TripGroup, or that is DELETED, refuses the whole request.",
    example: [
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    ],
  })
  @IsArray()
  @ArrayMinSize(MINIMUM_TRIPS_PER_CLASSIFICATION)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tripIds!: string[];
}
