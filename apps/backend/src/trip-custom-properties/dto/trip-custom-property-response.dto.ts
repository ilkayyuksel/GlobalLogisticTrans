import { ApiProperty } from "@nestjs/swagger";

import {
  CustomPropertyResponseDto,
  toCustomPropertyResponse,
} from "../../custom-properties/dto/custom-property-response.dto";
import { TripCustomPropertyWithProperty } from "../trip-custom-property.repository";

/**
 * Public shape of one Custom Property assignment.
 *
 * The property is nested in full rather than flattened, and it reuses
 * CustomPropertyResponseDto: a Custom Property then has one shape everywhere in
 * the API, and a field added to it — a Trip-specific price override, for
 * instance — appears here without a second mapper to keep in step.
 *
 * `assignedAt` is the row's creation timestamp. The model calls it the "Added
 * Timestamp" and deliberately stores it only once.
 */
export class TripCustomPropertyResponseDto {
  @ApiProperty({ format: "uuid", description: "Identity of the assignment." })
  id!: string;

  @ApiProperty({ format: "uuid" })
  tripId!: string;

  @ApiProperty({ format: "uuid" })
  customPropertyId!: string;

  @ApiProperty({
    type: CustomPropertyResponseDto,
    description:
      "The property as it is configured now. The Pricing Engine reads the price from here at calculation time; once calculated the amount is frozen in the pricing item and no longer depends on this configuration.",
  })
  customProperty!: CustomPropertyResponseDto;

  @ApiProperty({
    format: "date-time",
    description: "When the property was added to the Trip.",
  })
  assignedAt!: Date;
}

/**
 * Every property a Trip carries.
 *
 * Deliberately not paginated: a Trip's properties are a small, bounded set that
 * is always read as a whole — the planning view shows all of them, and the
 * Pricing Engine needs all of them to produce a correct breakdown.
 */
export class TripCustomPropertiesDto {
  @ApiProperty({
    type: [TripCustomPropertyResponseDto],
    description: "Assignments in the properties' configured display order.",
  })
  items!: TripCustomPropertyResponseDto[];
}

export function toTripCustomPropertyResponse(
  assignment: TripCustomPropertyWithProperty,
): TripCustomPropertyResponseDto {
  return {
    id: assignment.id,
    tripId: assignment.tripId,
    customPropertyId: assignment.customPropertyId,
    customProperty: toCustomPropertyResponse(assignment.customProperty),
    assignedAt: assignment.createdAt,
  };
}
