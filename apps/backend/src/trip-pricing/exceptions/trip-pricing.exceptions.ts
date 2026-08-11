import { ConflictException, NotFoundException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

/**
 * Domain exceptions for the TripPricing module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * No message carries a monetary value: an error is written to the log, and
 * pricing is commercial information.
 */

export class TripPricingNotFoundException extends NotFoundException {
  constructor(tripPricingId: string) {
    super(`Trip pricing "${tripPricingId}" does not exist.`);
  }
}

export class DuplicateTripPricingException extends ConflictException {
  constructor(tripId: string) {
    super(
      `Trip "${tripId}" already has a pricing snapshot. A Trip has at most one.`,
    );
  }
}

/**
 * A pricing snapshot may only exist for a CLOSED Trip.
 *
 * The rule is a cross-table conditional existence that PostgreSQL cannot
 * express, so it is enforced here and listed as such in database_schema.md §11.
 */
export class TripNotClosedException extends ConflictException {
  constructor(tripId: string, status: TripStatus, requiredStatus: TripStatus) {
    super(
      `Trip "${tripId}" is ${status}. A pricing snapshot may only exist for a ${requiredStatus} Trip.`,
    );
  }
}
