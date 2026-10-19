import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

/** One Trip is still a selection of one. */
export const MINIMUM_TRIPS_PER_UNPAYMENT = 1;

/**
 * The request to mark several Trips NOT PAID.
 *
 * Only ids, and deliberately no boolean: what the endpoint applies is what the
 * endpoint IS. Marking Trips paid stays with the single-Trip payment endpoint
 * and the invoice check's confirmed payment — a body that could also say
 * `true` would be a second, competing way to settle transports.
 */
export class MarkTripsUnpaidDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    minItems: MINIMUM_TRIPS_PER_UNPAYMENT,
    description:
      "The Trips to mark NOT PAID. All distinct. A Trip that already is unpaid is left alone; an unknown id refuses the whole request.",
    example: ["3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
  })
  @IsArray()
  @ArrayMinSize(MINIMUM_TRIPS_PER_UNPAYMENT)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  tripIds!: string[];
}
