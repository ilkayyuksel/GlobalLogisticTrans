import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ParseResult, ParsedTrip, parse } from "@tms/parser";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import {
  ImportTripsCommand,
  ImportedTripData,
} from "../trips/import-trips.command";
import { TripService } from "../trips/trip.service";
import {
  InvalidCombinationException,
  NoTripsFoundException,
  UnknownTerminalException,
  UnreadablePdfException,
} from "./exceptions/pdf-import.exceptions";
import { TerminalMapping, resolveTerminalName } from "./terminal-mapping";

/** A Combination is one leg out and one leg back — never more, never fewer. */
const TRIPS_PER_COMBINATION = 2;

export interface PdfImportResult {
  readonly trips: TripResponseDto[];
  /** True when these Trips were imported as one Combination. */
  readonly combination: boolean;
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
 * — parsing, terminal resolution, Combination shape — happens BEFORE anything is
 * written, so a rejected import leaves no PdfDocument, no TripGroup and no Trip.
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
    private readonly pdfDocumentService: PdfDocumentService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PdfTripImporter.name);
  }

  /**
   * Parses `content` and creates the Trips it describes.
   *
   * `terminalMapping` is injectable so a test can prove the mapped path without
   * the shipped table being populated. Production callers pass nothing and get
   * the real table, which is empty until the terminal pairs are supplied.
   */
  async import(
    content: Uint8Array,
    originalFilename: string,
    terminalMapping?: TerminalMapping,
  ): Promise<PdfImportResult> {
    const parsed = await this.parseOrRefuse(content, originalFilename);

    // Resolved before the first write: an unmapped terminal must not leave a
    // stored file or a half-written document behind.
    const trips = parsed.trips.map((trip) =>
      this.toImportedTrip(trip, terminalMapping),
    );
    const combination = this.isCombination(parsed.trips);

    const prepared = await this.pdfDocumentService.store(
      content,
      originalFilename,
      parsed.parserVersion,
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

      return { trips: created, combination };
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
   * The parser reports what the document says; this decides what that means
   * here. Only the terminal needs deciding, and an unknown one stops the import
   * rather than being guessed, stored raw, or silently matched to something
   * similar.
   */
  private toImportedTrip(
    trip: ParsedTrip,
    terminalMapping?: TerminalMapping,
  ): ImportedTripData {
    const terminal = this.resolveTerminal(trip, terminalMapping);

    return {
      bookingNumber: trip.bookingNumber,
      containerNumber: trip.containerNumber,
      containerType: trip.containerType,
      terminal,
      destinationCity: trip.destinationCity,
      destinationCountry: trip.destinationCountry,
      planningDate: trip.date,
      startTime: trip.startTime,
      endTime: trip.endTime,
      parserMetadata: this.toParserMetadata(trip),
    };
  }

  private resolveTerminal(
    trip: ParsedTrip,
    terminalMapping?: TerminalMapping,
  ): string {
    const documentTerminal = trip.terminal;

    if (documentTerminal === null) {
      throw new UnknownTerminalException(null, trip.bookingNumber);
    }

    const terminal = terminalMapping
      ? resolveTerminalName(documentTerminal, terminalMapping)
      : resolveTerminalName(documentTerminal);

    if (terminal === null) {
      throw new UnknownTerminalException(documentTerminal, trip.bookingNumber);
    }

    return terminal;
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
