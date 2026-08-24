import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the TripCustomProperty module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * No message carries a price or a property name: these are written to the log,
 * and a configured property price is commercial information. Only identifiers
 * appear.
 */

export class TripCustomPropertyNotFoundException extends NotFoundException {
  constructor(assignmentId: string) {
    super(`Custom property assignment "${assignmentId}" does not exist.`);
  }
}

/**
 * database_model.md §4.21: the same CustomProperty must not be assigned twice
 * to the same Trip. The unique index on the pair is the real guard.
 */
export class DuplicateTripCustomPropertyException extends ConflictException {
  constructor(tripId: string, customPropertyId: string) {
    super(
      `Custom property "${customPropertyId}" is already assigned to Trip "${tripId}".`,
    );
  }
}

/**
 * database_schema.md §7.1: an inactive property may not be selected for a new
 * Trip, while Trips that already carry it keep it.
 */
export class InactiveCustomPropertyException extends ConflictException {
  constructor(customPropertyId: string) {
    super(
      `Custom property "${customPropertyId}" is inactive and cannot be assigned to a Trip.`,
    );
  }
}

/**
 * The container type requires this property, so it may not be unassigned.
 *
 * A 20FL and a 20ST always carry Flat. The rule assigns it, and while the type
 * still requires it the assignment cannot be taken away — not by the automatic
 * path, which would put it straight back, and not by hand either. Removing it
 * would leave the Trip under-charged with nothing on it to show why.
 *
 * It applies whatever the assignment's source is. An operator who assigned Flat
 * themselves before the type demanded it is in the same position as the rule:
 * the invariant is about what the Trip CARRIES, not about who put it there.
 *
 * Change the container type and the automatic assignment goes by itself.
 *
 * The container type is named because it is the reason and the way out. No
 * price appears, here or anywhere in this module.
 */
export class RequiredCustomPropertyException extends ConflictException {
  constructor(
    readonly tripId: string,
    readonly containerType: string,
  ) {
    super(
      `Trip "${tripId}" has container type "${containerType}", which requires this Custom Property. It cannot be removed while the container type requires it.`,
    );
  }
}
