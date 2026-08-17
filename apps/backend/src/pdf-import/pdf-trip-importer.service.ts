import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ParseResult, ParseSuccess, ParsedTrip, parse } from "@tms/parser";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PdfDocumentProvenance,
  PdfDocumentService,
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
import { TripService } from "../trips/trip.service";
import {
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

/** One booking a revised document updated. */
export interface RevisedBooking {
  readonly bookingNumber: string;
  readonly tripId: string | null;
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
}

/** The optional halves of an import. */
export interface PdfImportOptions {
  /**
   * Where the PDF came from. Omitted means a manual upload, which is what every
   * caller before the mailbox existed was.
   */
  readonly provenance?: PdfDocumentProvenance;
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
 */
@Injectable()
export class PdfTripImporter {
  constructor(
    private readonly tripService: TripService,
    private readonly tripRevision: TripRevisionService,
    private readonly pdfDocumentService: PdfDocumentService,
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
      return this.cancelWhatTheDocumentNames(parsed, originalFilename);
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
        pdfDocument: prepared.document,
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

      return { trips: created, combination, cancellations: [], revisions: [] };
    } catch (error: unknown) {
      // The transaction rolled the database back; the file is the only thing
      // left, so it goes too. Cleanup is guarded rather than awaited plainly:
      // if removing the file also fails, the caller must still learn why the
      // IMPORT failed, not why a cleanup did. One unreferenced file is a far
      // smaller problem than a lost diagnosis.
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

      throw error;
    }
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
  ): Promise<PdfImportResult> {
    const parsed = await this.parseOrRefuse(content, originalFilename);

    return this.cancelWhatTheDocumentNames(parsed, originalFilename);
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
  ): Promise<PdfImportResult> {
    const parsed = await this.parseOrRefuse(content, originalFilename);

    if (parsed.documentStatus === "CANCELLED") {
      return this.cancelWhatTheDocumentNames(parsed, originalFilename);
    }

    const revisions: RevisedBooking[] = [];

    for (const trip of parsed.trips) {
      const result = await this.tripRevision.applyDocumentRevision(
        this.toImportedTrip(trip),
      );

      if (result.outcome !== "UPDATED") {
        throw new RevisionRefusedException(
          trip.bookingNumber,
          describeRevisionRefusal(result.outcome),
        );
      }

      revisions.push({
        bookingNumber: trip.bookingNumber,
        tripId: result.trip?.id ?? null,
      });
    }

    this.logger.log("Revised transport order applied", {
      originalFilename,
      layout: parsed.layout,
      tripIds: revisions.map((entry) => entry.tripId),
    });

    return { trips: [], combination: false, cancellations: [], revisions };
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
    originalFilename: string,
  ): Promise<PdfImportResult> {
    const cancellations: CancelledBooking[] = [];

    for (const trip of parsed.trips) {
      cancellations.push({
        bookingNumber: trip.bookingNumber,
        outcome: await this.tripRevision.cancelByBookingNumber(
          trip.bookingNumber,
        ),
      });
    }

    this.logger.log("Cancelled transport order processed", {
      originalFilename,
      layout: parsed.layout,
      outcomes: cancellations.map((entry) => entry.outcome),
    });

    return { trips: [], combination: false, cancellations, revisions: [] };
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
