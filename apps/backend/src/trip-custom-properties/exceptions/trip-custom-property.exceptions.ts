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
