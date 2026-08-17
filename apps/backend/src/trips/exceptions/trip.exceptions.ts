import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { TripStatus } from "@prisma/client";

/**
 * Domain exceptions for the Trip module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * There is deliberately no "cannot delete" exception: Trips are never
 * physically deleted, so the module exposes no delete operation at all — only
 * the DELETED status, which is reversible.
 */

export class TripNotFoundException extends NotFoundException {
  constructor(tripId: string) {
    super(`Trip "${tripId}" does not exist.`);
  }
}

/**
 * A referenced PdfDocument does not exist.
 *
 * Every Trip originates from exactly one PDF, so a Trip cannot be created
 * without one. Modelled as 404 for consistency with how Vehicle and Driver
 * references are reported by the VehicleAssignment module.
 */
export class UnknownPdfDocumentException extends NotFoundException {
  constructor(pdfDocumentId: string) {
    super(`PDF document "${pdfDocumentId}" does not exist.`);
  }
}

export class DuplicateBookingNumberException extends ConflictException {
  constructor(bookingNumber: string, conflictingTripId: string) {
    super(
      `Booking number "${bookingNumber}" is already used by Trip "${conflictingTripId}".`,
    );
  }
}

/**
 * A Trip named in a grouping request already belongs to a group.
 *
 * Moving it is deliberately NOT a side effect of grouping: a Trip that silently
 * left its Combination would take the meaning of that Combination with it. The
 * operator unlinks it first, which is one explicit action with a visible
 * result, and only then can it join another group.
 */
export class TripAlreadyGroupedException extends ConflictException {
  constructor(tripId: string, tripGroupId: string) {
    super(
      `Trip "${tripId}" already belongs to group "${tripGroupId}". Remove it from that group before adding it to another.`,
    );
  }
}

/** Grouping is a relationship, and one Trip is not a relationship. */
export class TooFewTripsToGroupException extends BadRequestException {
  constructor(minimumTrips: number) {
    super(`A group needs at least ${minimumTrips} Trips.`);
  }
}

export class TripNotInGroupException extends ConflictException {
  constructor(tripId: string) {
    super(`Trip "${tripId}" does not belong to a group.`);
  }
}

export class InvalidTripStatusTransitionException extends ConflictException {
  constructor(
    from: TripStatus,
    to: TripStatus,
    allowed: readonly TripStatus[],
  ) {
    const options =
      allowed.length > 0 ? allowed.join(", ") : "no further transitions";

    super(
      `A Trip cannot move from ${from} to ${to}. Allowed from ${from}: ${options}.`,
    );
  }
}

export class TripNotDeletableException extends ConflictException {
  constructor(tripId: string, status: TripStatus, deletableFrom: TripStatus) {
    super(
      `Trip "${tripId}" is ${status} and can only be deleted while ${deletableFrom}.`,
    );
  }
}

export class TripNotDeletedException extends ConflictException {
  constructor(tripId: string, status: TripStatus) {
    super(`Trip "${tripId}" is ${status}, so there is nothing to restore.`);
  }
}

/** A Trip cannot be assigned to an inactive Vehicle or an inactive Driver. */
export type AssignmentSubject = "vehicle" | "driver";

export class InactiveAssignmentException extends ConflictException {
  constructor(subject: AssignmentSubject, subjectId: string) {
    super(
      `The ${subject} "${subjectId}" is inactive and cannot be assigned to a Trip.`,
    );
  }
}

export class VehicleAlreadyBookedException extends ConflictException {
  constructor(vehicleId: string, conflictingTripId: string) {
    super(
      `Vehicle "${vehicleId}" is already booked by Trip "${conflictingTripId}" during that interval.`,
    );
  }
}
