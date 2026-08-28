import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
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

/**
 * An override was requested for a component that does not admit one.
 *
 * Every refused component is DERIVED from something the operator can already
 * change, so a stored override on it would be a second, competing answer the
 * pricing model would then have to explain away. The message names the
 * component but never an amount.
 */
export class PricingComponentNotOverridableException extends BadRequestException {
  constructor(componentCode: string) {
    super(
      `Pricing component "${componentCode}" cannot be overridden. Only BASE_PRICE, TOLL and TUNNEL accept a manual amount.`,
    );
  }
}

/**
 * A correction was withdrawn that was not there.
 *
 * Distinguished from success deliberately: a reset that silently did nothing
 * would let a screen report a value returned to its calculated figure when the
 * figure never moved.
 */
export class TripPricingOverrideNotFoundException extends NotFoundException {
  constructor(tripId: string, componentCode: string) {
    super(
      `Trip "${tripId}" has no manual override for pricing component "${componentCode}".`,
    );
  }
}
