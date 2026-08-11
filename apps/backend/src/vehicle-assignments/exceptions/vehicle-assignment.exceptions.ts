import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

/**
 * Domain exceptions for the VehicleAssignment module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * There is deliberately no "cannot delete" exception: assignments are never
 * physically deleted, so the module exposes no delete operation at all.
 */

export class VehicleAssignmentNotFoundException extends NotFoundException {
  constructor(assignmentId: string) {
    super(`Vehicle assignment "${assignmentId}" does not exist.`);
  }
}

/** The subject whose timeline is already occupied. */
export type AssignmentSubject = "vehicle" | "driver";

export class VehicleAssignmentOverlapException extends ConflictException {
  constructor(subject: AssignmentSubject, conflictingAssignmentId: string) {
    super(
      `The requested period overlaps an existing assignment for this ${subject} (assignment "${conflictingAssignmentId}").`,
    );
  }
}

export class InvalidAssignmentPeriodException extends BadRequestException {
  constructor(validFrom: string, validTo: string) {
    super(`validTo (${validTo}) must not be earlier than validFrom (${validFrom}).`);
  }
}

/**
 * Raised when a change would rewrite a period that has already elapsed.
 * History is corrected by creating a new assignment, never by editing an old one.
 */
export class HistoricalAssignmentException extends ConflictException {
  constructor(assignmentId: string) {
    super(
      `Assignment "${assignmentId}" has already ended and can no longer be re-dated.`,
    );
  }
}
