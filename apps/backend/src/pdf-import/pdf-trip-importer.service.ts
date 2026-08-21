import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ParseResult,
  ParseSuccess,
  ParsedTrip,
  parse,
  parseCostConfirmation,
} from "@tms/parser";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PdfDocumentProvenance,
  PdfDocumentService,
  PreparedPdfDocument,
} from "../pdf-documents/pdf-document.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import {
  ImportTripsCommand,
  ImportedTripData,
} from "../trips/import-trips.command";
import {
  CancellationOutcome,
  RevisionOutcome,
  TripRevisionService,
} from "../trips/trip-revision.service";
import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { DuplicateBookingNumberException } from "../trips/exceptions/trip.exceptions";
import { TripService } from "../trips/trip.service";
import {
  CostConfirmationRefusedException,
  InvalidCombinationException,
  NoTripsFoundException,
  RevisionRefusedException,
  UnreadablePdfException,
} from "./exceptions/pdf-import.exceptions";

/** A Combination is one leg out and one leg back — never more, never fewer. */
const TRIPS_PER_COMBINATION = 2;

/** One booking a cancelled document referred to, and what became of it. */
export interface CancelledBooking {
  readonly bookingNumber: string;
  readonly outcome: CancellationOutcome;
}

/**
 * What a revised document did to one booking.
 *
 * `UPDATED` revised a Trip that already existed. `CREATED_FROM_UPDATE` created
 * one, because no Trip held that booking number — the original order never
 * reached us, and refusing the revision would leave real transport unplanned.
 */
export type RevisionAction = "UPDATED" | "CREATED_FROM_UPDATE";

export interface RevisedBooking {
  readonly bookingNumber: string;
  readonly tripId: string | null;
  readonly action: RevisionAction;
  /**
   * The fields THIS document moved on that Trip. Empty when it moved none, and
   * empty for a Trip it created — there was no earlier state to move.
   */
  readonly changedFields: readonly string[];
}

/** A document that is now on disk AND in the database. */
interface StoredDocument {
  readonly id: string;
  /** Kept so the file can be compensated if the Trip work then fails. */
  readonly storedFile: PreparedPdfDocument;
}

/** One cost a confirmation recorded, and what became of it. */
export interface ConfirmedCost {
  readonly ccNumber: string;
  readonly bookingNumber: string;
  readonly tripId: string;
  /** Fixed-2 decimal string, exactly as the document stated it. */
  readonly amount: string;
  readonly currency: string;
  readonly outcome: "RECORDED" | "ALREADY_RECORDED";
}

export interface PdfImportResult {
  readonly trips: TripResponseDto[];
  /** True when these Trips were imported as one Combination. */
  readonly combination: boolean;
  /**
   * What a CANCELLED document did. Empty for an ordinary order.
   *
   * When it is not empty, `trips` is empty: a cancelled document cancels, and
   * never creates.
   */
  readonly cancellations: readonly CancelledBooking[];
  /** The Trips a revised document updated. Empty for every other outcome. */
  readonly revisions: readonly RevisedBooking[];
  /** What a cost confirmation recorded. Empty for every other outcome. */
  readonly costConfirmations: readonly ConfirmedCost[];
}

/** The optional halves of an import. */
export interface PdfImportOptions {
  /**
   * Where the PDF came from. Omitted means a manual upload, which is what every
   * caller before the mailbox existed was.
   */
  readonly provenance?: PdfDocumentProvenance;
  /**
   * The email subject, when there was one.
   *
   * Only ever a CROSS-CHECK. Eucon repeats the confirmation number and the
   * booking in the subject, and a subject that disagrees with the document is
   * worth knowing about — but the PDF is the document, and the subject is a
   * line somebody typed above it.
   */
  readonly subject?: string;
}

/**
 * Imports a transport order PDF.
 *
 * This is the only place the parser and the Trip domain meet, and it is
 * deliberately one concrete service rather than a framework: there is one
 * document format, from one sender, producing one kind of Trip. A pipeline of
 * pluggable stages would be an abstraction built for formats that do not exist.
 *
 * The order of operations is the design. Everything that can refuse the document
 * — parsing and Combination shape — happens BEFORE anything is written, so a
 * rejected import leaves no PdfDocument, no TripGroup and no Trip.
 * The write itself is a single transaction, so a failure inside it leaves none
 * either. The one thing a transaction cannot undo is the file on disk, and that
 * is compensated explicitly.
 *
 * It does not price. Imported Trips are OPEN, and pricing happens when a Trip is
 * closed, through the event the Trip domain already publishes.
 *
 * ── EVERY ACCEPTED DOCUMENT IS KEPT ─────────────────────────────────────────
 * NEW, UPDATE and CANCEL alike. A NEW document is reached through the Trip it
 * created; an UPDATE or a CANCEL through the history events it caused. The file
 * is stored once - storage is content-addressed - and one document may serve
 * several Trips, which is what a Combination needs.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PdfTripImporter {
  constructor(
    private readonly tripService: TripService,
    private readonly tripRevision: TripRevisionService,
    private readonly pdfDocumentService: PdfDocumentService,
    private readonly costConfirmations: CostConfirmationService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PdfTripImporter.name);
  }

  /**
   * Parses `content` and creates the Trips it describes.
   *
   * The same method serves a manual upload and a mailbox import: only where the
   * PDF came from differs, and that is data, not a different pipeline.
   */
  async import(
    content: Uint8Array,
    originalFilename: string,
    options: PdfImportOptions = {},
  ): Promise<PdfImportResult> {
    const parsed = await this.parseOrRefuse(content, originalFilename);

    /*
     * A document that stamps itself CANCELLED is not planned work, whichever
     * route it arrived by. Before this check a cancelled order became an
     * ordinary OPEN Trip, indistinguishable from live work — the document
     * carried the evidence and the import discarded it.
     *
     * It is handled here, at the one place every route passes through, and by
     * the same Trip-domain rules a `CANCEL:` email uses. Nothing about
     * cancelling is written twice.
     */
    if (parsed.documentStatus === "CANCELLED") {
      return this.cancelWhatTheDocumentNames(
        parsed,
        content,
        originalFilename,
        options,
      );
    }

    const trips = parsed.trips.map((trip) => this.toImportedTrip(trip));
    const combination = this.isCombination(parsed.trips);

    const prepared = await this.pdfDocumentService.store(
      content,
      originalFilename,
      parsed.parserVersion,
      options.provenance,
    );

    try {
      const command: ImportTripsCommand = {
        document: { kind: "new", data: prepared.document },
        asCombination: combination,
        trips,
      };

      const created = await this.tripService.importTrips(command);

      this.logger.log("Transport order import finished", {
        originalFilename,
        layout: parsed.layout,
        tripCount: created.length,
        combination,
      });

      return {
        trips: created,
        combination,
        cancellations: [],
        revisions: [],
        costConfirmations: [],
      };
    } catch (error: unknown) {
      /*
       * A booking number this system still holds is not a broken document - it
       * is an order we already know about, most often a cancelled one being
       * re-sent. The Trips are left exactly as they are, and the document is
       * KEPT and recorded against them, so the arrival is visible instead of
       * being thrown away with the error.
       */
      if (error instanceof DuplicateBookingNumberException) {
        await this.recordRefusedNewOrder(prepared, parsed, originalFilename);

        throw error;
      }

      // The transaction rolled the database back; the file is the only thing
      // left, so it goes too.
      await this.discardQuietly(prepared, originalFilename);

      throw error;
    }
  }

  /**
   * Keeps a NEW document that was refused because its booking number is taken.
   *
   * Committed outside the failed transaction, because that transaction is gone:
   * this is a second, small write recording that the document arrived. It
   * creates no Trip and changes none - the existing Trip keeps its status,
   * which for a cancelled order is exactly the point.
   */
  private async recordRefusedNewOrder(
    prepared: PreparedPdfDocument,
    parsed: ParseSuccess,
    originalFilename: string,
  ): Promise<void> {
    try {
      const stored = await this.pdfDocumentService.persist(prepared);

      await this.tripRevision.recordRefusedNewOrder(
        parsed.trips.map((trip) => trip.bookingNumber),
        { pdfDocumentId: stored.id },
      );

      this.logger.log("New order refused: its booking number is still held", {
        originalFilename,
        pdfDocumentId: stored.id,
        bookingNumbers: parsed.trips.map((trip) => trip.bookingNumber),
      });
    } catch (recordError: unknown) {
      // The caller is already reporting the duplicate; a failure to record the
      // arrival must not replace that with a different, less useful error.
      this.logger.error("Could not record a refused new order", {
        originalFilename,
        reason:
          recordError instanceof Error
            ? recordError.message
            : String(recordError),
      });
    }
  }

  /**
   * Creates the Trips a revision names but nobody holds.
   *
   * ── THE SAME PATH AN ORDER TAKES ────────────────────────────────────────
   * `TripService.importTrips` — the one place a Trip is created from a
   * document. The Trip that comes out is an ordinary imported Trip: OPEN, with
   * the parser-controlled values this document states and its source document
   * attached. Nothing marks it as manual or unknown, because it is neither.
   *
   * The operator-controlled fields are absent, exactly as they are for any
   * import: a document cannot know which truck, which driver, or how long
   * anybody waited.
   * ────────────────────────────────────────────────────────────────────────
   *
   * The document is the one already stored for this revision, so the Trip's
   * `pdfDocumentId` points at the UPDATE that created it. Its provenance stays
   * UPDATE — the action is what arrived, and rewriting it as NEW would claim a
   * document we never received.
   */
  private async createFromRevision(
    missing: readonly ParsedTrip[],
    parsed: ParseSuccess,
    document: StoredDocument,
  ): Promise<RevisedBooking[]> {
    /*
     * A Combination is only recreated as one when BOTH of its legs are
     * missing. With one leg already planned, grouping the new Trip would mean
     * rearranging work somebody is already doing, which no document asks for.
     */
    const asCombination =
      this.isCombination(parsed.trips) && missing.length === parsed.trips.length;

    const created = await this.tripService.importTrips({
      document: { kind: "stored", id: document.id },
      asCombination,
      trips: missing.map((trip) => this.toImportedTrip(trip)),
    });

    for (const trip of created) {
      await this.tripRevision.recordTripCreatedByUpdate(trip.id, {
        pdfDocumentId: document.id,
      });
    }

    return created.map((trip) => ({
      bookingNumber: trip.bookingNumber as string,
      tripId: trip.id,
      action: "CREATED_FROM_UPDATE" as const,
      // No earlier state existed, so no field was changed. Inventing a change
      // set here would report a revision that never happened.
      changedFields: [],
    }));
  }

  /**
   * Cancels what this document names, because an email asked for it.
   *
   * The instruction comes from the SUBJECT, so the document's own status is not
   * consulted: a `CANCEL:` email cancels whether or not the attached order is
   * stamped. The two are separate statements, and the sender's instruction is
   * the one that was addressed to us.
   *
   * Nothing is stored and nothing is created — see `cancelWhatTheDocumentNames`.
   */
  async cancel(
    content: Uint8Array,
    originalFilename: string,
    options: PdfImportOptions = {},
  ): Promise<PdfImportResult> {
    const parsed = await this.parseOrRefuse(content, originalFilename);

    return this.cancelWhatTheDocumentNames(
      parsed,
      content,
      originalFilename,
      options,
    );
  }

  /**
   * Applies a revised transport order to the Trips that already exist.
   *
   * A revision NEVER creates a Trip: a document revising something we do not
   * have is refused, not imported as new work. Nor does it store the PDF —
   * `PdfDocument` records the document a Trip was created from, and a revision
   * did not create one.
   *
   * A document stamped CANCELLED cancels even here. The stamp is what the
   * sender printed on the order itself, and honouring it is what stops a
   * cancelled order from being written back into planning through a differently
   * titled email.
   */
  async revise(
    content: Uint8Array,
    originalFilename: string,
    options: PdfImportOptions = {},
  ): Promise<PdfImportResult> {
    const parsed = await this.parseOrRefuse(content, originalFilename);

    if (parsed.documentStatus === "CANCELLED") {
      return this.cancelWhatTheDocumentNames(
        parsed,
        content,
        originalFilename,
        options,
      );
    }

    /*
     * The revision document is KEPT, whatever it then turns out to do.
     *
     * It is the evidence for the change set recorded beside it, and for the
     * refusals too: "an update arrived after the cancellation" is only
     * verifiable if the update itself is still there. The order is the same one
     * an import uses - store, then write, then compensate on failure - so the
     * file and the rows can never disagree.
     */
    const document = await this.storeDocument(
      content,
      originalFilename,
      parsed.parserVersion,
      options,
    );

    /*
     * Whether anything now points at this document.
     *
     * A refusal against a Trip we HAVE recorded an event, and that event's
     * evidence is this document. A revision matching NO Trip recorded nothing,
     * leaves the message unread and will be retried - so keeping its document
     * would add a row on every attempt, referenced by nothing.
     */
    let documentIsReferenced = false;

    try {
      const revisions: RevisedBooking[] = [];
      const missing: ParsedTrip[] = [];

      for (const trip of parsed.trips) {
        const result = await this.tripRevision.applyDocumentRevision(
          this.toImportedTrip(trip),
          { pdfDocumentId: document.id },
        );

        /*
         * A booking nobody holds is not a broken document — it is an order
         * whose original never reached us. Refusing it would leave real
         * transport unplanned, so the revision CREATES the Trip instead, from
         * the same document, further down.
         */
        if (result.outcome === "NO_MATCHING_TRIP") {
          missing.push(trip);

          continue;
        }

        if (result.outcome !== "UPDATED") {
          documentIsReferenced = true;

          throw new RevisionRefusedException(
            trip.bookingNumber,
            describeRevisionRefusal(result.outcome),
          );
        }

        revisions.push({
          bookingNumber: trip.bookingNumber,
          tripId: result.trip?.id ?? null,
          action: "UPDATED",
          changedFields: result.changedFields,
        });
      }

      if (missing.length > 0) {
        revisions.push(
          ...(await this.createFromRevision(missing, parsed, document)),
        );
        documentIsReferenced = true;
      }

      this.logger.log("Revised transport order applied", {
        originalFilename,
        layout: parsed.layout,
        pdfDocumentId: document.id,
        tripIds: revisions.map((entry) => entry.tripId),
        actions: revisions.map((entry) => entry.action),
        changedFields: revisions.map((entry) => entry.changedFields),
      });

      return {
        trips: [],
        combination: false,
        cancellations: [],
        revisions,
        costConfirmations: [],
      };
    } catch (error: unknown) {
      /*
       * A refusal against an existing Trip is not a failure of the document: it
       * was accepted, stored and recorded, and only then refused by that Trip's
       * own state. Its history row points at this document, so the document
       * stays - discarding it would leave that row explaining itself with
       * nothing.
       */
      if (!documentIsReferenced) {
        await this.forgetQuietly(document, originalFilename);
      }

      throw error;
    }
  }

  /**
   * Records the cost Eucon confirms for a Trip that already exists.
   *
   * ── IT NEVER CREATES A TRIP ─────────────────────────────────────────────
   * The document carries a complete copy of the transport order it refers to,
   * which is exactly why it is read by `parseCostConfirmation` rather than by
   * the transport parser: read as an order it would look like a second order
   * for a booking we already have.
   *
   * It changes nothing about the Trip either — not its status, its vehicle, its
   * driver, its planning or its waiting time. It adds a confirmed amount and
   * the document that states it.
   * ────────────────────────────────────────────────────────────────────────
   *
   * A booking nobody holds is refused, not invented: a confirmation of a Trip
   * we do not have is a business exception for a person to look at, and the
   * message stays unread so it is offered again.
   */
  async confirmCost(
    content: Uint8Array,
    originalFilename: string,
    options: PdfImportOptions = {},
  ): Promise<PdfImportResult> {
    const parsed = await parseCostConfirmation(content);

    if (!parsed.ok) {
      this.logger.warn("Cost confirmation could not be read", {
        originalFilename,
        reason: parsed.reason,
        missingFields: parsed.missingFields,
      });

      throw new UnreadablePdfException(originalFilename, parsed.message);
    }

    const confirmation = parsed.confirmation;

    this.assertSubjectAgrees(options.subject, confirmation, originalFilename);

    const trip = await this.tripService.findByBookingNumberOrNull(
      confirmation.bookingNumber,
    );

    /*
     * Refused BEFORE the document is stored. Unlike a revision, there is no
     * Trip to record the arrival against, so a stored document would reference
     * nothing — and the message is retried, which would store it again.
     */
    if (!trip) {
      throw new CostConfirmationRefusedException(
        confirmation.ccNumber,
        `No Trip holds booking number ${confirmation.bookingNumber}.`,
      );
    }

    const document = await this.storeDocument(
      content,
      originalFilename,
      parsed.parserVersion,
      options,
    );

    try {
      const recorded = await this.costConfirmations.record({
        tripId: trip.id,
        pdfDocumentId: document.id,
        ccNumber: confirmation.ccNumber,
        costCode: confirmation.costCode,
        amount: confirmation.amount,
        currency: confirmation.currency,
        receivedAt: new Date(),
      });

      /*
       * A Trip has ONE confirmed cost. A second, different one is refused and
       * recorded against the Trip — the arrival is a fact, and the document
       * stays as its evidence, exactly as a refused revision does. What must
       * not happen is a second row, an overwritten amount or a sum.
       */
      if (recorded.outcome === "CC_ALREADY_EXISTS") {
        await this.tripRevision.recordRefusedCostConfirmation(
          trip.id,
          { pdfDocumentId: document.id },
          confirmation.ccNumber,
          recorded.confirmation?.ccNumber ?? "unknown",
        );

        throw new CostConfirmationRefusedException(
          confirmation.ccNumber,
          `Trip ${trip.id} already has cost confirmation CC${recorded.confirmation?.ccNumber ?? "unknown"}.`,
        );
      }

      /*
       * The same document also becomes an event on the Trip, so it appears in
       * the document history beside the order, its updates and its
       * cancellation. One document, two records: the money and the arrival.
       */
      await this.tripRevision.recordCostConfirmation(
        trip.id,
        { pdfDocumentId: document.id },
        confirmation.ccNumber,
        `${confirmation.currency} ${confirmation.amount}`,
      );

      this.logger.log("Cost confirmation processed", {
        originalFilename,
        ccNumber: confirmation.ccNumber,
        bookingNumber: confirmation.bookingNumber,
        tripId: trip.id,
        amount: confirmation.amount,
        outcome: recorded.outcome,
      });

      return {
        trips: [],
        combination: false,
        cancellations: [],
        revisions: [],
        costConfirmations: [
          {
            ccNumber: confirmation.ccNumber,
            bookingNumber: confirmation.bookingNumber,
            tripId: trip.id,
            amount: confirmation.amount,
            currency: confirmation.currency,
            outcome: recorded.outcome,
          },
        ],
      };
    } catch (error: unknown) {
      /*
       * A refusal against a Trip we HAVE is recorded, and its document is the
       * evidence for that record — so it stays, like a refused revision's does.
       * Anything else failed before writing anything and is compensated away.
       */
      if (!(error instanceof CostConfirmationRefusedException)) {
        await this.forgetQuietly(document, originalFilename);
      }

      throw error;
    }
  }

  /**
   * The subject repeats the number and the booking; the document decides.
   *
   * A disagreement is refused rather than resolved. Two different bookings in
   * one message means one of them is wrong, and recording an amount against
   * either would be a guess about somebody else's money. The number is checked
   * the same way and for the same reason.
   */
  private assertSubjectAgrees(
    subject: string | undefined,
    confirmation: { ccNumber: string; bookingNumber: string },
    originalFilename: string,
  ): void {
    if (!subject) {
      return;
    }

    const upper = subject.toUpperCase();
    const statedNumber = /\bNR\s+(\d+)/.exec(upper)?.[1];
    const statedBooking = /\b([A-Z]{3}[A-Z0-9]{5,})\b/.exec(
      upper.replace(/COST CONFIRMATION/g, ""),
    )?.[1];

    const numberDisagrees =
      statedNumber !== undefined && statedNumber !== confirmation.ccNumber;
    const bookingDisagrees =
      statedBooking !== undefined &&
      statedBooking !== confirmation.bookingNumber;

    if (!numberDisagrees && !bookingDisagrees) {
      return;
    }

    this.logger.warn("Cost confirmation subject disagrees with its document", {
      originalFilename,
      subjectNumber: statedNumber ?? null,
      subjectBooking: statedBooking ?? null,
      documentNumber: confirmation.ccNumber,
      documentBooking: confirmation.bookingNumber,
    });

    throw new CostConfirmationRefusedException(
      confirmation.ccNumber,
      `The subject names ${statedNumber ?? "no number"} / ${statedBooking ?? "no booking"} while the document states ${confirmation.ccNumber} / ${confirmation.bookingNumber}.`,
    );
  }

  /**
   * Carries out the cancellation a CANCELLED document states.
   *
   * Deliberately writes nothing but the status: no PdfDocument, no TripGroup,
   * no Trip and no file. A cancellation is not a new document in the business
   * sense — it is an instruction about one that already exists — and storing it
   * would leave a PdfDocument owning no Trips.
   *
   * Every booking the document names is cancelled, which is what makes a
   * cancelled Combination cancel both of its legs.
   */
  private async cancelWhatTheDocumentNames(
    parsed: ParseSuccess,
    content: Uint8Array,
    originalFilename: string,
    options: PdfImportOptions,
  ): Promise<PdfImportResult> {
    /*
     * The cancellation document is kept like any other. It is the reason a Trip
     * left the planning, and a cancelled Trip whose cancellation cannot be
     * produced is a record with a hole in it.
     */
    const document = await this.storeDocument(
      content,
      originalFilename,
      parsed.parserVersion,
      options,
    );

    try {
      const cancellations: CancelledBooking[] = [];

      for (const trip of parsed.trips) {
        cancellations.push({
          bookingNumber: trip.bookingNumber,
          outcome: await this.tripRevision.cancelByBookingNumber(
            trip.bookingNumber,
            { pdfDocumentId: document.id },
          ),
        });
      }

      this.logger.log("Cancelled transport order processed", {
        originalFilename,
        layout: parsed.layout,
        pdfDocumentId: document.id,
        outcomes: cancellations.map((entry) => entry.outcome),
      });

      return {
        trips: [],
        combination: false,
        cancellations,
        revisions: [],
        costConfirmations: [],
      };
    } catch (error: unknown) {
      await this.forgetQuietly(document, originalFilename);

      throw error;
    }
  }

  /**
   * Writes the file and commits the row describing it.
   *
   * Committed on its own, before the Trip work, because the history rows that
   * follow reference it - and because a document that arrived is a fact whether
   * or not the instruction it carried could be carried out. The file is
   * compensated by the caller when the Trip work genuinely fails.
   */
  private async storeDocument(
    content: Uint8Array,
    originalFilename: string,
    parserVersion: string,
    options: PdfImportOptions,
  ): Promise<StoredDocument> {
    const prepared = await this.pdfDocumentService.store(
      content,
      originalFilename,
      parserVersion,
      options.provenance,
    );

    try {
      const created = await this.pdfDocumentService.persist(prepared);

      return { id: created.id, storedFile: prepared };
    } catch (error: unknown) {
      await this.discardQuietly(prepared, originalFilename);

      throw error;
    }
  }

  /**
   * Removes a file whose import failed, without replacing the real diagnosis.
   *
   * If cleanup itself fails the caller must still learn why the IMPORT failed,
   * not why a cleanup did: one unreferenced file is a far smaller problem than
   * a lost explanation.
   */
  private async discardQuietly(
    prepared: PreparedPdfDocument,
    originalFilename: string,
  ): Promise<void> {
    try {
      await this.pdfDocumentService.discard(prepared);
    } catch (cleanupError: unknown) {
      this.logger.error("Could not remove the file of a failed import", {
        originalFilename,
        reason:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
  }

  /** The same, for a document whose row was already committed. */
  private async forgetQuietly(
    document: StoredDocument,
    originalFilename: string,
  ): Promise<void> {
    try {
      await this.pdfDocumentService.forget(document.id, document.storedFile);
    } catch (cleanupError: unknown) {
      this.logger.error("Could not remove the record of a failed import", {
        originalFilename,
        pdfDocumentId: document.id,
        reason:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }
  }

  private async parseOrRefuse(content: Uint8Array, originalFilename: string) {
    const result: ParseResult = await parse(content);

    if (!result.ok) {
      this.logger.warn("Transport order could not be parsed", {
        originalFilename,
        reason: result.reason,
        missingFields: result.missingFields,
        pageCount: result.metadata.pageCount,
      });

      throw new UnreadablePdfException(originalFilename, result.message);
    }

    if (result.trips.length === 0) {
      throw new NoTripsFoundException(originalFilename);
    }

    return result;
  }

  /**
   * Translates one ParsedTrip into what the Trip domain stores.
   *
   * A straight copy. The parser has already normalized what the document says,
   * and the terminal in particular is stored EXACTLY as extracted — `PSA Quay
   * 869` stays `PSA Quay 869`. It is the Trip's real terminal and the key that
   * RoutePricing and RouteCost are configured under, so translating it here
   * would break the very match pricing depends on.
   */
  private toImportedTrip(trip: ParsedTrip): ImportedTripData {
    return {
      bookingNumber: trip.bookingNumber,
      containerNumber: trip.containerNumber,
      containerType: trip.containerType,
      // May be null when the document names no terminal. That is stored as
      // null rather than refused: pricing reports a missing route in its own
      // terms, and an absent terminal is not an import failure.
      terminal: trip.terminal,
      destinationCity: trip.destinationCity,
      destinationCountry: trip.destinationCountry,
      planningDate: trip.date,
      startTime: trip.startTime,
      endTime: trip.endTime,
      // The document said which half of the transport this is. It stays in
      // parser_metadata as evidence too, but this is the copy business logic
      // is allowed to read.
      direction: trip.direction,
      parserMetadata: this.toParserMetadata(trip),
    };
  }

  /**
   * What the parser saw, kept for diagnostics.
   *
   * Stored so that a Trip whose city or terminal looks wrong can be traced back
   * to the text it came from without re-reading the PDF. No business decision
   * may read this — it is evidence, not input.
   */
  private toParserMetadata(trip: ParsedTrip): Prisma.InputJsonValue {
    return {
      direction: trip.direction,
      documentTerminal: trip.terminal,
      groupKey: trip.groupKey,
      raw: {
        address: trip.raw.rawAddress,
        terminal: trip.raw.rawTerminal,
        date: trip.raw.rawDate,
        booking: trip.raw.rawBooking,
        matchedLabels: trip.raw.matchedLabels,
        sections: {
          page: trip.raw.sections.page,
          addressSection: trip.raw.sections.addressSection,
          detected: trip.raw.sections.detected,
        },
      },
    };
  }

  /**
   * Whether these Trips form a Combination, refusing anything that claims to be
   * one but is not.
   *
   * The parser groups by `groupKey`; this checks the shape that grouping has to
   * have. Two Trips, one COLLECTION and one DELIVERY — a pair of collections
   * grouped together would not be a Combination, and storing it as one would
   * misrepresent the order to planning and to pricing.
   */
  private isCombination(trips: readonly ParsedTrip[]): boolean {
    const grouped = trips.filter((trip) => trip.groupKey !== null);

    if (grouped.length === 0) {
      return false;
    }

    const bookingNumbers = trips.map((trip) => trip.bookingNumber);

    if (grouped.length !== trips.length) {
      throw new InvalidCombinationException(
        bookingNumbers,
        "only some of its Trips are grouped.",
      );
    }

    if (new Set(grouped.map((trip) => trip.groupKey)).size > 1) {
      throw new InvalidCombinationException(
        bookingNumbers,
        "its Trips belong to different groups.",
      );
    }

    if (grouped.length !== TRIPS_PER_COMBINATION) {
      throw new InvalidCombinationException(
        bookingNumbers,
        `a Combination has exactly ${TRIPS_PER_COMBINATION} Trips, but ${grouped.length} were found.`,
      );
    }

    const directions = new Set(grouped.map((trip) => trip.direction));

    if (!directions.has("COLLECTION") || !directions.has("DELIVERY")) {
      throw new InvalidCombinationException(
        bookingNumbers,
        "a Combination pairs one COLLECTION with one DELIVERY.",
      );
    }

    return true;
  }
}

/**
 * Why a revision was refused, phrased for the operator who has to act on it.
 *
 * Each of these is a decision for a person: the system deliberately does not
 * resolve any of them on its own.
 */
function describeRevisionRefusal(
  outcome: Exclude<RevisionOutcome, "UPDATED">,
): string {
  if (outcome === "NO_MATCHING_TRIP") {
    return "no Trip holds that booking number, and a revision never creates one";
  }

  if (outcome === "REFUSED_CLOSED") {
    return "the Trip is CLOSED, and finished work is not rewritten automatically";
  }

  return "the Trip was cancelled, and a revision does not reopen cancelled work";
}
