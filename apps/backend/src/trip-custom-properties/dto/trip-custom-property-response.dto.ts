import { ApiProperty } from "@nestjs/swagger";

import {
  CustomPropertyResponseDto,
  toCustomPropertyResponse,
} from "../../custom-properties/dto/custom-property-response.dto";
import {
  FLAT_CUSTOM_PROPERTY_NAME,
  requiresFlatProperty,
} from "../../trips/flat-container-rule";
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
 *
 * `isAutomatic` and `isRequired` are both READ-ONLY and answer different
 * questions. The first is where the assignment came from and never changes. The
 * second is whether the Trip may part with it right now, which depends on the
 * Trip's container type and therefore changes when the type does. A client
 * showing a remove button reads `isRequired`; nothing works it out for itself,
 * because the same rule then existed in two places.
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

  @ApiProperty({
    description:
      "True when a domain rule assigned this property rather than a person. Read-only: an assignment made through this API is always manual.",
  })
  isAutomatic!: boolean;

  @ApiProperty({
    description:
      "True when the Trip's container type requires this property, in which case removing it is refused. Read-only, and re-evaluated on every read: it follows the container type.",
  })
  isRequired!: boolean;
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
  /** The Trip's container type, which decides whether the property is required. */
  containerType: string | null,
): TripCustomPropertyResponseDto {
  return {
    id: assignment.id,
    tripId: assignment.tripId,
    customPropertyId: assignment.customPropertyId,
    customProperty: toCustomPropertyResponse(assignment.customProperty),
    assignedAt: assignment.createdAt,
    isAutomatic: assignment.isAutomatic,
    isRequired:
      assignment.customProperty.name === FLAT_CUSTOM_PROPERTY_NAME &&
      requiresFlatProperty(containerType),
  };
}
