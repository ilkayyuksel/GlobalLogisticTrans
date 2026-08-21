import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import { toUtcDate } from "../common/dates";
import { toUtcTime } from "../common/time-of-day";
import { AppLoggerService } from "../logger/app-logger.service";
import { ImportedTripData } from "./import-trips.command";
import { BOOKING_NUMBER_HOLDING_STATUSES } from "./trip-status.rules";
import {
  FieldChange,
  SYSTEM_ACTOR,
  TripHistoryEvent,
  describeChange,
  detectFieldChanges,
} from "./trip-history";
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
  /**
   * The fields THIS document moved. Empty when it changed nothing, and empty
   * when it was refused - a refused document moves nothing by definition.
   */
  readonly changedFields: readonly string[];
}

/**
 * The stored document an instruction arrived on.
 *
 * Optional at every call site: a revision applied by a caller that has no
 * document is still a revision. When it is present, every history row this
 * operation writes points at it, which is what ties a change set to the PDF
 * that caused it.
 */
export interface DocumentReference {
  readonly pdfDocumentId: string;
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
    document?: DocumentReference,
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

        /*
         * Every outcome below is RECORDED, including the two that write nothing
         * to the Trip. A cancellation that arrived and did nothing is still
         * something that arrived, and the audit trail is where an operator
         * finds out why the status did not move.
         */
        if (trip.status === TripStatus.CANCELLED) {
          await this.record(repository, trip.id, document, {
            eventType: TripHistoryEvent.CancelRedundant,
            description: "Cancellation received for an already cancelled Trip.",
          });

          return "ALREADY_CANCELLED";
        }

        if (trip.status !== TripStatus.OPEN) {
          await this.record(repository, trip.id, document, {
            eventType: TripHistoryEvent.CancelRefused,
            description:
              "Cancellation received for a CLOSED Trip. Finished work is not undone.",
          });

          return "REFUSED_CLOSED";
        }

        await repository.setStatus(trip.id, TripStatus.CANCELLED);
        await this.record(repository, trip.id, document, {
          eventType: TripHistoryEvent.Cancelled,
          previousValue: { status: TripStatus.OPEN },
          newValue: { status: TripStatus.CANCELLED },
          description: "Cancelled by a transport document.",
        });

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
    source?: DocumentReference,
  ): Promise<RevisionResult> {
    const result = await this.repository.runInTransaction(
      async (repository): Promise<RevisionResult> => {
        const trip = await repository.findByBookingNumber({
          bookingNumber: document.bookingNumber,
          statuses: BOOKING_NUMBER_HOLDING_STATUSES,
        });

        if (!trip) {
          return { outcome: "NO_MATCHING_TRIP", trip: null, changedFields: [] };
        }

        /*
         * A revision that cannot be applied is still recorded against the Trip
         * it named. That is what makes "an update arrived after the
         * cancellation" a visible fact rather than a silent refusal, and it is
         * why the document is kept: the record and the evidence stay together.
         */
        if (trip.status === TripStatus.CANCELLED) {
          await this.record(repository, trip.id, source, {
            eventType: TripHistoryEvent.UpdateRefused,
            description:
              "Update received after cancellation. The Trip stays CANCELLED and no field was changed.",
          });

          return { outcome: "REFUSED_CANCELLED", trip, changedFields: [] };
        }

        if (trip.status !== TripStatus.OPEN) {
          await this.record(repository, trip.id, source, {
            eventType: TripHistoryEvent.UpdateRefused,
            description:
              "Update received for a CLOSED Trip. Finished work is not rewritten.",
          });

          return { outcome: "REFUSED_CLOSED", trip, changedFields: [] };
        }

        /*
         * Compared BEFORE the write, against the Trip as it stands right now -
         * never against the original NEW document. The read and the write share
         * this transaction, so nothing can move between them.
         */
        const changes = detectFieldChanges(trip, document);

        const updated = await repository.update(
          trip.id,
          this.toRevisedFields(trip, document),
        );

        await this.recordUpdate(repository, trip.id, source, changes);

        return {
          outcome: "UPDATED",
          trip: updated,
          changedFields: changes.map((change) => change.field),
        };
      },
    );

    this.logger.log("Revision applied to a transport order", {
      bookingNumber: document.bookingNumber,
      outcome: result.outcome,
      tripId: result.trip?.id ?? null,
      changedFields: result.changedFields,
    });

    return result;
  }

  /**
   * Records that a NEW document arrived for booking numbers already in use.
   *
   * Writes nothing but history: the Trips keep their status, which for a
   * cancelled order is the whole point - a re-sent NEW must not bring it back.
   * Bookings that match nothing are skipped, because there is no Trip to
   * record the arrival against.
   */
  async recordRefusedNewOrder(
    bookingNumbers: readonly string[],
    source: DocumentReference,
  ): Promise<void> {
    await this.repository.runInTransaction(async (repository) => {
      for (const bookingNumber of bookingNumbers) {
        const trip = await repository.findByBookingNumber({
          bookingNumber,
          statuses: BOOKING_NUMBER_HOLDING_STATUSES,
        });

        if (!trip) {
          continue;
        }

        await this.record(repository, trip.id, source, {
          eventType: TripHistoryEvent.NewRefusedDuplicate,
          description: `New order received for a booking number this Trip still holds. The Trip stays ${trip.status}.`,
        });
      }
    });

    this.logger.log("Refused new order recorded", { bookingNumbers });
  }

  /**
   * Records that a cost was confirmed for this Trip.
   *
   * History only: the confirmation itself is its own record with its own
   * amount, and this row exists so the document appears in the Trip's document
   * list beside the order, its updates and its cancellation. Nothing about the
   * Trip is written — not its status, not its waiting time, not its planning.
   */
  async recordCostConfirmation(
    tripId: string,
    source: DocumentReference,
    ccNumber: string,
    amount: string,
  ): Promise<void> {
    await this.repository.runInTransaction((repository) =>
      this.record(repository, tripId, source, {
        eventType: TripHistoryEvent.CostConfirmed,
        newValue: { ccNumber, amount },
        description: `Cost confirmation CC${ccNumber} received for ${amount}.`,
      }),
    );

    this.logger.log("Cost confirmation recorded in the Trip history", {
      tripId,
      ccNumber,
    });
  }

  /**
   * Records that an UPDATE document created this Trip.
   *
   * ── WHY THIS IS NOT AN UPDATE EVENT ───────────────────────────────────────
   * There was no Trip to compare against, so there is no change set. Writing
   * one would mean inventing field changes out of nothing — `containerNumber:
   * null → XYZ123` — which reads as "somebody changed this" when nobody did.
   *
   * It is also why the interface must not call such a Trip "Bijgewerkt": the
   * marker means an existing Trip was revised, and this one was created.
   * ──────────────────────────────────────────────────────────────────────────
   */
  async recordTripCreatedByUpdate(
    tripId: string,
    source: DocumentReference,
  ): Promise<void> {
    await this.repository.runInTransaction((repository) =>
      this.record(repository, tripId, source, {
        eventType: TripHistoryEvent.UpdateCreatedTrip,
        description:
          "An UPDATE document created this Trip: no Trip held its booking number.",
      }),
    );

    this.logger.log("Trip created from an update document", { tripId });
  }

  /**
   * Records a second cost confirmation that was refused.
   *
   * The Trip already has its confirmed cost, and that one stays authoritative.
   * The arrival is still a fact, so it is recorded with the document that
   * carried it — an amount somebody sent us and we did not apply is exactly the
   * kind of thing an operator needs to be able to find.
   */
  async recordRefusedCostConfirmation(
    tripId: string,
    source: DocumentReference,
    refusedCcNumber: string,
    existingCcNumber: string,
  ): Promise<void> {
    await this.repository.runInTransaction((repository) =>
      this.record(repository, tripId, source, {
        eventType: TripHistoryEvent.CostConfirmationRefused,
        description: `Cost confirmation CC${refusedCcNumber} was refused: this Trip already has CC${existingCcNumber}.`,
      }),
    );

    this.logger.log("Refused cost confirmation recorded", {
      tripId,
      refusedCcNumber,
      existingCcNumber,
    });
  }

  /**
   * Records what one UPDATE document did: one row per field it moved.
   *
   * A document that moved nothing still gets a row. It arrived, it was
   * accepted, and "this update changed nothing" is an answer an operator needs
   * - an update that left no trace would look like one that never came.
   */
  private async recordUpdate(
    repository: TripRepository,
    tripId: string,
    source: DocumentReference | undefined,
    changes: readonly FieldChange[],
  ): Promise<void> {
    if (changes.length === 0) {
      await this.record(repository, tripId, source, {
        eventType: TripHistoryEvent.UpdateApplied,
        description: "Update applied; no parser-controlled field changed.",
      });

      return;
    }

    await repository.recordHistory(
      changes.map((change) => ({
        tripId,
        eventType: TripHistoryEvent.UpdateApplied,
        performedBy: SYSTEM_ACTOR,
        pdfDocumentId: source?.pdfDocumentId ?? null,
        previousValue: { [change.field]: change.previousValue },
        newValue: { [change.field]: change.newValue },
        description: describeChange(change),
      })),
    );
  }

  /** One event row, for the outcomes that describe themselves in a sentence. */
  private record(
    repository: TripRepository,
    tripId: string,
    source: DocumentReference | undefined,
    event: {
      eventType: string;
      previousValue?: Prisma.InputJsonObject;
      newValue?: Prisma.InputJsonObject;
      description: string;
    },
  ): Promise<void> {
    return repository.recordHistory([
      {
        tripId,
        eventType: event.eventType,
        performedBy: SYSTEM_ACTOR,
        pdfDocumentId: source?.pdfDocumentId ?? null,
        previousValue: event.previousValue,
        newValue: event.newValue,
        description: event.description,
      },
    ]);
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
