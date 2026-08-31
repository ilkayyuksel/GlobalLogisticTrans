import { Injectable } from "@nestjs/common";
import { Prisma, Trip, TripStatus } from "@prisma/client";

import { toUtcDate } from "../common/dates";
import { toUtcTime } from "../common/time-of-day";
import { AppLoggerService } from "../logger/app-logger.service";
import { ImportedTripData } from "./import-trips.command";
import {
  resolveTripForDocument,
  toContainerIdentity,
  type MatchMethod,
} from "./document-trip-matching";
import { BOOKING_NUMBER_HOLDING_STATUSES } from "./trip-status.rules";
import {
  FieldChange,
  SYSTEM_ACTOR,
  TripHistoryEvent,
  describeChange,
  detectFieldChanges,
  revisedContainerNumber,
} from "./trip-history";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripIdentity, TripRepository } from "./trip.repository";

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
 * By its IDENTITY: the booking number AND the container number the document
 * states, among the statuses that hold one. Nothing else — not the destination,
 * not the date, not a similarity of any kind. Two real orders in the fixture set
 * share a city, a date and a container type and differ only in their booking
 * number; any looser rule would silently merge them.
 *
 * An ABSENT container number is part of the identity, matched with `IS NULL`
 * rather than compared. Most orders are collections that name no container, and
 * a rule that could not match them would create a second Trip for every CANCEL
 * and every UPDATE of one.
 *
 * A document naming a DIFFERENT container is therefore a different Trip, and
 * matches nothing here. That is deliberate: rewriting the container number of
 * the Trip it did not name would move that Trip's identity out from under it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── THE LATEST DOCUMENT DECIDES ─────────────────────────────────────────────
 * Documents do not arrive in business order. A cancellation is no longer the end
 * of a Trip's life: a later NEW or UPDATE for the same identity REOPENS it and
 * becomes its effective document. Only CLOSED is terminal — finished, priced
 * work is never rewritten by a document that arrives afterwards.
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
  | "AMBIGUOUS_BOOKING_MATCH"
  /**
   * The document printed no container, and the booking it names carries more
   * than one Trip. Nothing is chosen: a cancellation applied to the wrong half
   * of a booking cancels a transport nobody called off.
   */
  | "AMBIGUOUS_BOOKING_MATCH"
  /** No Trip holds this booking number. No Trip is created. */
  | "NO_MATCHING_TRIP";

/** What a revision did. `NO_MATCHING_TRIP` and the refusals are failures. */
export type RevisionOutcome =
  | "UPDATED"
  /** A CANCELLED Trip was reopened by this document and its fields applied. */
  | "REOPENED"
  /**
   * CLOSED is the only terminal state left. There is deliberately no
   * "refused because cancelled": a cancellation is superseded by a later
   * document rather than protected from it.
   */
  | "REFUSED_CLOSED"
  /**
   * The document printed no container and its booking carries several Trips.
   * Distinct from NO_MATCHING_TRIP on purpose: that one CREATES the Trip the
   * document describes, and doing so here would add a third Trip to an already
   * ambiguous booking.
   */
  | "AMBIGUOUS_BOOKING_MATCH"
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

/**
 * The Trip a parsed document is about.
 *
 * Both halves come from the document itself and NEITHER IS NORMALISED: the
 * booking number and the container number are stored exactly as printed, and
 * they are compared exactly as stored. `EUCU 453232/2` keeps its space and its
 * slash.
 *
 * The one thing that is normalised is ABSENCE: a container that is blank or
 * only whitespace says exactly what a missing one says, and treating `""`,
 * `" "` and null as three identities would make matching depend on invisible
 * characters.
 *
 * ── AND THE DATE ────────────────────────────────────────────────────────────
 * `document.planningDate` is the transport date the document itself prints, on
 * the `Date/time:` line of its LOADING or DELIVERY section. It is the value a
 * Trip stores as `original_planning_date`, so comparing the two compares like
 * with like. No email date, no import timestamp and no voyage date reaches
 * this: the parser reads that one labelled line and nothing else.
 */
export function identityOf(document: ImportedTripData): TripIdentity {
  return {
    bookingNumber: document.bookingNumber,
    containerNumber: toContainerIdentity(document.containerNumber),
    originalPlanningDate: toUtcDate(document.planningDate),
  };
}

@Injectable()
export class TripRevisionService {
  constructor(
    private readonly repository: TripRepository,
    private readonly automaticFlat: AutomaticFlatPropertyService,
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
   *                A CANCEL never reopens anything, so nothing is written.
   *   CLOSED     → nothing. The transport was carried out and priced; a later
   *                cancellation does not un-drive a truck, and rewriting a
   *                closed Trip would falsify what was invoiced. It is reported,
   *                not applied.
   *   no Trip    → nothing. Never created.
   *
   * Matched by `resolveTripForDocument`, which is CONDITIONAL on what the
   * document prints. A cancellation naming a container is matched strictly on
   * it — cancelling booking A container 1 must never cancel booking A
   * container 2, a different transport nobody cancelled. A cancellation with
   * NO container, which is most of them, is matched on the booking alone,
   * because a COLLECTION order is written before anyone knows the container.
   *
   * A booking carrying several Trips and a document naming no container is
   * AMBIGUOUS_BOOKING_MATCH: a fifth outcome, and the only one that asks a
   * person. Nothing is chosen on its behalf.
   *
   * The read and the write share one transaction, so a Trip that closes between
   * them cannot be cancelled on the strength of a stale read.
   */
  async cancelByIdentity(
    identity: TripIdentity,
    document?: DocumentReference,
  ): Promise<CancellationOutcome> {
    let matchMethod: MatchMethod | null = null;

    const outcome = await this.repository.runInTransaction(
      async (repository): Promise<CancellationOutcome> => {
        /*
         * A cancellation that names a container we do not hold still cancels
         * the transport: the order may have been placed without one and given
         * a container by hand afterwards, so OUR record and the customer's
         * differ. Refusing would leave a real cancellation unapplied.
         */
        const match = await resolveTripForDocument(
          repository,
          identity,
          "FALL_BACK_TO_BOOKING_AND_DATE",
        );

        if (match.kind === "AMBIGUOUS_BOOKING_MATCH") {
          this.logger.warn("Cancellation names an ambiguous booking number", {
            bookingNumber: identity.bookingNumber,
            tripCount: match.tripCount,
          });

          return "AMBIGUOUS_BOOKING_MATCH";
        }

        if (match.kind === "NO_MATCHING_TRIP") {
          /*
           * Warned, not merely logged: a cancellation that found nothing is a
           * document that arrived and did nothing, which used to be invisible.
           * The email it came on is set aside rather than reported as
           * processed — see the importer.
           */
          this.logger.warn("Cancellation matched no Trip", {
            bookingNumber: identity.bookingNumber,
            hasContainerNumber: identity.containerNumber !== null,
          });

          return "NO_MATCHING_TRIP";
        }

        const trip = match.trip;
        matchMethod = match.method;

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
      bookingNumber: identity.bookingNumber,
      outcome,
      matchMethod,
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
    const result = await this.repository.runTripWriteTransaction(
      async ({
        trips: repository,
        customProperties,
      }): Promise<RevisionResult> => {
        /*
         * A revision naming a container nothing holds describes a transport we
         * do not have. It is refused here and the caller creates the Trip —
         * never applied to a different container's Trip on the same booking.
         */
        const match = await resolveTripForDocument(
          repository,
          identityOf(document),
          "REFUSE",
        );

        /*
         * Ambiguous is NOT "no matching Trip". The difference matters: no match
         * creates the Trip the document describes, and creating one here would
         * add a third Trip to a booking that already has two — making the
         * ambiguity permanently worse. So it refuses and a person decides.
         */
        if (match.kind === "AMBIGUOUS_BOOKING_MATCH") {
          this.logger.warn("Revision names an ambiguous booking number", {
            bookingNumber: document.bookingNumber,
            tripCount: match.tripCount,
          });

          return {
            outcome: "AMBIGUOUS_BOOKING_MATCH",
            trip: null,
            changedFields: [],
          };
        }

        if (match.kind === "NO_MATCHING_TRIP") {
          return { outcome: "NO_MATCHING_TRIP", trip: null, changedFields: [] };
        }

        const trip = match.trip;

        /*
         * A cancellation is not the end of this Trip's life. A revision that
         * arrives after one is the LATER statement about the same transport, so
         * it brings the Trip back and its fields are applied — the alternative
         * leaves real, re-planned work invisible because two documents crossed.
         *
         * Recorded as its own event beside the change set, so the audit trail
         * shows both that the Trip came back and what brought it back.
         */
        const reopened = trip.status === TripStatus.CANCELLED;

        if (reopened) {
          await repository.setStatus(trip.id, TripStatus.OPEN);
          await this.record(repository, trip.id, source, {
            eventType: TripHistoryEvent.Reopened,
            previousValue: { status: TripStatus.CANCELLED },
            newValue: { status: TripStatus.OPEN },
            description:
              "Reopened by an update that arrived after the cancellation.",
          });
        }

        /*
         * A revision that cannot be applied is still recorded against the Trip
         * it named. That is what makes "an update arrived after the Trip was
         * finished" a visible fact rather than a silent refusal, and it is why
         * the document is kept: the record and the evidence stay together.
         */
        if (!reopened && trip.status !== TripStatus.OPEN) {
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

        /*
         * The container type may just have changed, and the Flat property has
         * to follow it: a Trip revised from 20FL to 45PH no longer owes the
         * charge, one revised the other way does. Run unconditionally because
         * the rule reads the type it now HAS — it needs no memory of what it
         * was — and it is the one Custom Property a document may move.
         */
        await this.automaticFlat.synchronise(
          customProperties,
          updated.id,
          updated.containerType,
        );

        await this.recordUpdate(repository, trip.id, source, changes);

        return {
          outcome: reopened ? "REOPENED" : "UPDATED",
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
  /**
   * Applies a NEW order to the Trip that already holds its identity.
   *
   * ── WHY A REPEATED NEW IS NOT A DUPLICATE ANY MORE ────────────────────────
   * A NEW used to be refused whenever its booking number was taken. That was
   * right while the booking number WAS the identity; it is not right now. The
   * same booking legitimately carries several containers, and a NEW restating an
   * order we already hold is the sender's latest word on that transport — the
   * order as it now stands, not a second transport.
   *
   * So it becomes the Trip's effective document: the parser-controlled fields
   * are re-read from it, and a CANCELLED Trip comes back OPEN. Nothing an
   * operator owns is touched, and no field-level change set is written — a NEW
   * revises nothing, it restates, which is why `latestUpdate` is left alone.
   *
   * CLOSED is the exception and stays one. Finished, priced work is never
   * rewritten by a document that arrives afterwards; the arrival is recorded
   * and the Trip is left exactly as it is.
   * ──────────────────────────────────────────────────────────────────────────
   */
  async applyNewOrder(
    document: ImportedTripData,
    source?: DocumentReference,
  ): Promise<RevisionResult> {
    const result = await this.repository.runTripWriteTransaction(
      async ({
        trips: repository,
        customProperties,
      }): Promise<RevisionResult> => {
        const trip = await repository.findByIdentity({
          identity: identityOf(document),
          statuses: BOOKING_NUMBER_HOLDING_STATUSES,
        });

        if (!trip) {
          return { outcome: "NO_MATCHING_TRIP", trip: null, changedFields: [] };
        }

        if (trip.status === TripStatus.CLOSED) {
          await this.record(repository, trip.id, source, {
            eventType: TripHistoryEvent.NewRefusedDuplicate,
            description:
              "New order received for a CLOSED Trip. Finished work is not rewritten.",
          });

          return { outcome: "REFUSED_CLOSED", trip, changedFields: [] };
        }

        const reopened = trip.status === TripStatus.CANCELLED;

        if (reopened) {
          await repository.setStatus(trip.id, TripStatus.OPEN);
          await this.record(repository, trip.id, source, {
            eventType: TripHistoryEvent.Reopened,
            previousValue: { status: TripStatus.CANCELLED },
            newValue: { status: TripStatus.OPEN },
            description:
              "Reopened by a new order that arrived after the cancellation.",
          });
        }

        const updated = await repository.update(
          trip.id,
          this.toRevisedFields(trip, document),
        );

        // The container type may have moved with the rest; Flat follows it.
        await this.automaticFlat.synchronise(
          customProperties,
          updated.id,
          updated.containerType,
        );

        /*
         * One row, no change set. The fields were re-read rather than revised,
         * and inventing "containerType: 45PH → 45PH" entries would put an
         * update in the Trip's history that nobody sent.
         */
        await this.record(repository, trip.id, source, {
          eventType: TripHistoryEvent.NewReapplied,
          description:
            "New order received for a Trip that already holds this identity. Its transport data was re-read from this document.",
        });

        return {
          outcome: reopened ? "REOPENED" : "UPDATED",
          trip: updated,
          changedFields: [],
        };
      },
    );

    this.logger.log("New order applied to an existing Trip", {
      bookingNumber: document.bookingNumber,
      outcome: result.outcome,
      tripId: result.trip?.id ?? null,
    });

    return result;
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
   *
   * The AUTOMATIC Flat assignment is the single exception, and it is not one of
   * these fields: the document states a container type, and what that type
   * obliges is decided afterwards by the Trip domain. A property the operator
   * assigned by hand is still never touched.
   * ──────────────────────────────────────────────────────────────────────────
   */
  private toRevisedFields(existing: Trip, document: ImportedTripData) {
    const documentDate = toUtcDate(document.planningDate);

    return {
      /*
       * ── A DOCUMENT NEVER ERASES A CONTAINER ────────────────────────────────
       * A Loading is ordered before anyone knows which container will be picked
       * up, so the order prints none and the operator enters it later from the
       * driver. Every revision of that order still prints none — so writing the
       * document's value straight through would delete what the operator
       * entered, on every UPDATE, for exactly the Trips this matters most for.
       *
       * `database_model.md` and `planningRules.md` both state the rule
       * directly: parser updates must never erase a manually entered container
       * number.
       *
       * The same helper decides what the audit trail reports, so the history
       * cannot claim a change the write did not make.
       */
      containerNumber: revisedContainerNumber(existing, document),
      containerType: document.containerType,
      terminal: document.terminal,
      destinationCity: document.destinationCity,
      destinationCountry: document.destinationCountry,
      /*
       * `originalPlanningDate` is deliberately NOT written here.
       *
       * It is part of the Trip's identity, and identity is fixed when the Trip
       * is created. A revision can only ever reach this Trip by naming that
       * same date — that is what matching now requires — so writing it would
       * assign the value it already holds, and leaving it out makes it
       * structurally impossible for a document to move a Trip's identity.
       */
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
