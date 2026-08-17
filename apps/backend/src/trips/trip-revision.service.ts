import { Injectable } from "@nestjs/common";
import { Trip, TripStatus } from "@prisma/client";

import { toUtcDate } from "../common/dates";
import { toUtcTime } from "../common/time-of-day";
import { AppLoggerService } from "../logger/app-logger.service";
import { ImportedTripData } from "./import-trips.command";
import { BOOKING_NUMBER_HOLDING_STATUSES } from "./trip-status.rules";
import { TripRepository } from "./trip.repository";

/**
 * What a LATER transport order does to a Trip that already exists.
 *
 * ── WHY THIS IS ITS OWN SERVICE ─────────────────────────────────────────────
 * Importing creates Trips; this revises them. The two are different operations
 * with different rules, and the cancel rules in particular have to be reachable
 * from two callers — a `CANCEL:` email and a cancelled PDF uploaded by hand —
 * without either of them holding a second copy. So the rules live here once,
 * and both boundaries call the same method.
 *
 * It never creates a Trip. A cancellation or a revision that matches nothing is
 * reported as matching nothing; inventing the Trip it refers to would turn a
 * correction into new work nobody planned.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── HOW AN EXISTING TRIP IS FOUND ───────────────────────────────────────────
 * By EXACT booking number, among the statuses that hold one. Nothing else:
 * not the destination, not the container, not the date, and not a similarity
 * of any kind. Two real orders in the fixture set share a city, a date and a
 * container type and differ only in their booking number — they are two
 * transports, and any looser rule would silently merge them.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** What a cancellation did. Every value means "handled"; none is an error. */
export type CancellationOutcome =
  /** An OPEN Trip was moved to CANCELLED. */
  | "CANCELLED"
  /** The Trip was already CANCELLED. Nothing to do, and nothing was written. */
  | "ALREADY_CANCELLED"
  /** The Trip is CLOSED. Finished work is never rewritten. */
  | "REFUSED_CLOSED"
  /** No Trip holds this booking number. No Trip is created. */
  | "NO_MATCHING_TRIP";

/** What a revision did. `NO_MATCHING_TRIP` and the refusals are failures. */
export type RevisionOutcome =
  | "UPDATED"
  | "REFUSED_CLOSED"
  | "REFUSED_CANCELLED"
  | "NO_MATCHING_TRIP";

export interface RevisionResult {
  readonly outcome: RevisionOutcome;
  readonly trip: Trip | null;
}

@Injectable()
export class TripRevisionService {
  constructor(
    private readonly repository: TripRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripRevisionService.name);
  }

  /**
   * Cancels the Trip holding `bookingNumber`.
   *
   * The four outcomes are all "handled". A cancellation is an instruction from
   * the party that placed the order, and it cannot fail because our records are
   * in a state it did not expect:
   *
   *   OPEN       → CANCELLED. The one case that writes.
   *   CANCELLED  → nothing. Re-sending a cancellation must be harmless, and it
   *                is the same message arriving twice more often than not.
   *   CLOSED     → nothing. The transport was carried out and priced; a later
   *                cancellation does not un-drive a truck, and rewriting a
   *                closed Trip would falsify what was invoiced. It is reported,
   *                not applied.
   *   no Trip    → nothing. Never created.
   *
   * The read and the write share one transaction, so a Trip that closes between
   * them cannot be cancelled on the strength of a stale read.
   */
  async cancelByBookingNumber(
    bookingNumber: string,
  ): Promise<CancellationOutcome> {
    const outcome = await this.repository.runInTransaction(
      async (repository): Promise<CancellationOutcome> => {
        const trip = await repository.findByBookingNumber({
          bookingNumber,
          statuses: BOOKING_NUMBER_HOLDING_STATUSES,
        });

        if (!trip) {
          return "NO_MATCHING_TRIP";
        }

        if (trip.status === TripStatus.CANCELLED) {
          return "ALREADY_CANCELLED";
        }

        if (trip.status !== TripStatus.OPEN) {
          return "REFUSED_CLOSED";
        }

        await repository.setStatus(trip.id, TripStatus.CANCELLED);

        return "CANCELLED";
      },
    );

    this.logger.log("Cancellation applied to a transport order", {
      bookingNumber,
      outcome,
    });

    return outcome;
  }

  /**
   * Applies a revised transport order to the Trip that already exists.
   *
   *   OPEN       → the document's own fields are written.
   *   CLOSED     → refused. Finished, priced work is not rewritten by a later
   *                document; it is a business exception for a person to handle.
   *   CANCELLED  → refused. A revision does not resurrect cancelled work.
   *   no Trip    → refused. A revision of nothing is not a new order.
   *
   * Nothing is priced here, and no pricing is invalidated: the Trip stays OPEN,
   * and an OPEN Trip has no pricing to invalidate. Pricing happens when a Trip
   * is closed, exactly as before.
   */
  async applyDocumentRevision(
    document: ImportedTripData,
  ): Promise<RevisionResult> {
    const result = await this.repository.runInTransaction(
      async (repository): Promise<RevisionResult> => {
        const trip = await repository.findByBookingNumber({
          bookingNumber: document.bookingNumber,
          statuses: BOOKING_NUMBER_HOLDING_STATUSES,
        });

        if (!trip) {
          return { outcome: "NO_MATCHING_TRIP", trip: null };
        }

        if (trip.status === TripStatus.CANCELLED) {
          return { outcome: "REFUSED_CANCELLED", trip };
        }

        if (trip.status !== TripStatus.OPEN) {
          return { outcome: "REFUSED_CLOSED", trip };
        }

        const updated = await repository.update(
          trip.id,
          this.toRevisedFields(trip, document),
        );

        return { outcome: "UPDATED", trip: updated };
      },
    );

    this.logger.log("Revision applied to a transport order", {
      bookingNumber: document.bookingNumber,
      outcome: result.outcome,
      tripId: result.trip?.id ?? null,
    });

    return result;
  }

  /**
   * The fields a document is allowed to rewrite.
   *
   * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────
   * Everything the operator owns: vehicleId, driverId, waitingTimeMinutes,
   * distanceKm, executionDatetime, internalNotes, custom properties and group
   * membership. None appears below, which is what guarantees that a new PDF
   * cannot quietly undo an afternoon of planning. The rule is expressed by
   * listing what MAY change rather than by listing what may not, so a column
   * added later is preserved by default instead of being overwritten by
   * oversight.
   * ──────────────────────────────────────────────────────────────────────────
   */
  private toRevisedFields(existing: Trip, document: ImportedTripData) {
    const documentDate = toUtcDate(document.planningDate);

    return {
      containerNumber: document.containerNumber,
      containerType: document.containerType,
      terminal: document.terminal,
      destinationCity: document.destinationCity,
      destinationCountry: document.destinationCountry,
      // What the document says, always. This is the document's own date.
      originalPlanningDate: documentDate,
      // What the operator plans, only while they have not moved it themselves.
      planningDate: this.hasOperatorMovedTheTrip(existing)
        ? existing.planningDate
        : documentDate,
      startTime: document.startTime ? toUtcTime(document.startTime) : null,
      endTime: document.endTime ? toUtcTime(document.endTime) : null,
      direction: document.direction,
      parserMetadata: document.parserMetadata,
    };
  }

  /**
   * Whether the planned date has been moved by hand since the import.
   *
   * An import writes the document's date into BOTH columns, so while they still
   * agree nobody has touched the planning and the new document's date may
   * simply replace it. Once they differ, the planned date is a decision
   * somebody made — a truck was re-planned to another day — and a revised
   * document must not silently undo it.
   *
   * A Trip created by hand has neither date, and is treated as unmoved.
   */
  private hasOperatorMovedTheTrip(trip: Trip): boolean {
    if (trip.planningDate === null || trip.originalPlanningDate === null) {
      return false;
    }

    return trip.planningDate.getTime() !== trip.originalPlanningDate.getTime();
  }
}
