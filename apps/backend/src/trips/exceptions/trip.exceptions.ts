import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
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

/**
 * A Trip already holds this identity.
 *
 * The identity is the booking number AND the container number, so the message
 * names both: "ANR123456 is taken" would be wrong and confusing now that the
 * same booking legitimately carries several containers, each its own Trip.
 *
 * An absent container number is spelled out rather than omitted — it is part of
 * the identity, not a missing value.
 */
export class DuplicateBookingNumberException extends ConflictException {
  constructor(
    bookingNumber: string,
    conflictingTripId: string,
    containerNumber: string | null = null,
  ) {
    super(
      `Booking number "${bookingNumber}" with container ${
        containerNumber === null ? "(none)" : `"${containerNumber}"`
      } is already used by Trip "${conflictingTripId}".`,
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

/**
 * The Custom Property a container type requires is not configured.
 *
 * Raised while writing a Trip whose container type must carry a property that
 * no active Custom Property provides. The Trip write is rolled back with it:
 * the rule is an invariant, and a 20FL Trip stored without its Flat property
 * would be silently under-charged for the rest of its life.
 *
 * 422 rather than 500, because nothing is broken — an administrator
 * deactivated or renamed a property, and the same request succeeds once it is
 * configured again. The property is named because naming what is missing is the
 * whole use of the message; its configured price never appears anywhere.
 */
export class MissingRequiredCustomPropertyException extends UnprocessableEntityException {
  constructor(
    readonly propertyName: string,
    readonly containerType: string,
  ) {
    super(
      `Container type "${containerType}" requires the Custom Property "${propertyName}", but no active property is configured under that name.`,
    );
  }
}

/**
 * A field the DOCUMENT owns cannot be edited by hand on an imported Trip.
 *
 * These fields are parser-controlled exactly where a parser exists. On a Trip
 * that came from a transport order the document is the authority: a later
 * UPDATE re-reads them from it, so a manual change would be silently
 * overwritten and the two sources would disagree in the meantime.
 *
 * A Trip created by hand has no document and therefore no other way to correct
 * one, so it accepts them. This exception is the refusal for the other case,
 * and it names both the field and the document so the reason is actionable.
 */
export class DocumentControlledFieldException extends ConflictException {
  constructor(tripId: string, pdfDocumentId: string, field: string) {
    super(
      `Trip "${tripId}" was imported from PDF document "${pdfDocumentId}", which is the authority for its ${field}. Only a Trip created by hand accepts a manually entered ${field}.`,
    );
  }
}

/**
 * A Trip in a TripGroup cannot be classified LOSRIT by the bulk action.
 *
 * NOTE ON WHERE THIS RULE LIVES. The data model does not forbid the
 * combination: `is_loose_trip` and `trip_group_id` are independent columns, and
 * a Trip that was already a LOSRIT before it joined a group keeps its
 * classification. This is a rule of the bulk OPERATION — a losrit is a loose
 * trip, and a leg of a Combination is by definition not loose — so it is
 * enforced where that operation is, not as a database invariant that would
 * retroactively invalidate existing rows.
 */
export class GroupedTripCannotBeLooseException extends ConflictException {
  constructor(tripId: string, tripGroupId: string) {
    super(
      `Trip "${tripId}" belongs to group "${tripGroupId}" and cannot be marked as a loose trip. Remove it from the group first.`,
    );
  }
}

/** A DELETED Trip is read-only until it is restored. */
export class DeletedTripCannotBeLooseException extends ConflictException {
  constructor(tripId: string) {
    super(
      `Trip "${tripId}" is DELETED and cannot be classified. Restore it first.`,
    );
  }
}
