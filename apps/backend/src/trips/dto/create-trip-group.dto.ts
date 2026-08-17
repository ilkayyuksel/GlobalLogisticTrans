import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

/** Below this a group would describe nothing. */
export const MINIMUM_TRIPS_PER_GROUP = 2;

/**
 * The request to group Trips by hand.
 *
 * Only ids: a manual group carries no name, no type and no note, because the
 * `trip_group` table has no columns for any of that and inventing them would be
 * inventing a concept nothing reads.
 *
 * `@ArrayUnique` matters more than it looks: the same id twice would otherwise
 * pass the minimum-of-two check while describing a single Trip.
 */
export class CreateTripGroupDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    minItems: MINIMUM_TRIPS_PER_GROUP,
    description:
      "The Trips to put in one group. At least two, all distinct, none of them already grouped.",
    example: [
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    ],
  })
  @IsArray()
  @ArrayMinSize(MINIMUM_TRIPS_PER_GROUP)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tripIds!: string[];
}
