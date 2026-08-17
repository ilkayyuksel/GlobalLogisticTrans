import { ImportSource } from "@prisma/client";
import type { ParseResult, ParsedTrip } from "@tms/parser";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { TripRevisionService } from "../trips/trip-revision.service";
import { TripService } from "../trips/trip.service";
import {
  InvalidCombinationException,
  NoTripsFoundException,
  UnreadablePdfException,
} from "./exceptions/pdf-import.exceptions";
import { PdfTripImporter } from "./pdf-trip-importer.service";

/**
 * The parser is mocked throughout. Its own suite already proves it reads real
 * PDFs correctly; what matters here is what the importer does with the facts,
 * which stays provable without a PDF and without the shipped terminal mapping
 * being populated.
 */
const parse = jest.fn<Promise<ParseResult>, [Uint8Array]>();

jest.mock("@tms/parser", () => ({
  parse: (source: Uint8Array) => parse(source),
}));

function buildParsedTrip(overrides: Partial<ParsedTrip> = {}): ParsedTrip {
  return {
    bookingNumber: "ANRDUB2602247",
    containerType: "45PH",
    containerNumber: null,
    terminal: "Test Quay 1",
    destinationCity: "Dourges",
    destinationCountry: "France",
    date: "2025-05-22",
    startTime: "10:00",
    endTime: "16:00",
    direction: "COLLECTION",
    groupKey: null,
    raw: {
      rawAddress: "F-62119 Dourges",
      rawTerminal: "Test Quay 1",
      rawDate: "22/05/2025",
      rawBooking: "ANRDUB2602247",
      matchedLabels: ["Terminal:", "Booking no:"],
      sections: { page: 1, addressSection: "LOADING 1", detected: ["LOADING"] },
    },
    ...overrides,
  };
}

function buildSuccess(trips: ParsedTrip[]): ParseResult {
  return {
    ok: true,
    layout: trips.length > 1 ? "COMBINATION_TWO_PAGE" : "SINGLE_ONE_PAGE",
    // An ordinary order. The cancelled path has its own tests.
    documentStatus: "PLANNED",
    parserVersion: "1.0.0",
    trips,
    metadata: { pageCount: 1, fragmentCount: 120, detectedSections: [] },
  };
}

function buildCombination(): ParsedTrip[] {
  const groupKey = "combination:ANRBEL2603249+DUBANR2598395";

  return [
    buildParsedTrip({
      bookingNumber: "DUBANR2598395",
      direction: "DELIVERY",
      terminal: "Test Quay 1",
      groupKey,
    }),
    buildParsedTrip({
      bookingNumber: "ANRBEL2603249",
      direction: "COLLECTION",
      terminal: "Test Quay 2",
      groupKey,
    }),
  ];
}

const CONTENT = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe("PdfTripImporter", () => {
  let tripService: { importTrips: jest.Mock };
  let tripRevision: {
    cancelByBookingNumber: jest.Mock;
    applyDocumentRevision: jest.Mock;
  };
  let pdfDocumentService: { store: jest.Mock; discard: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let importer: PdfTripImporter;

  beforeEach(() => {
    parse.mockReset();
    parse.mockResolvedValue(buildSuccess([buildParsedTrip()]));

    tripService = {
      importTrips: jest.fn().mockResolvedValue([{ id: "trip" }]),
    };
    pdfDocumentService = {
      store: jest.fn().mockResolvedValue({
        document: { fileHash: "abc123", storagePath: "abc123.pdf" },
        absolutePath: "/storage/pdf/abc123.pdf",
        bytesAlreadyOwned: false,
      }),
      discard: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    tripRevision = {
      cancelByBookingNumber: jest.fn().mockResolvedValue("CANCELLED"),
      applyDocumentRevision: jest.fn(),
    };

    importer = new PdfTripImporter(
      tripService as unknown as TripService,
      tripRevision as unknown as TripRevisionService,
      pdfDocumentService as unknown as PdfDocumentService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("the terminal the document names", () => {
    /**
     * The PDF's terminal IS the Trip's terminal. It is also the key that
     * RoutePricing and RouteCost are configured under, so translating it here
     * would break the exact match pricing depends on.
     */
    it("stores the printed terminal exactly as extracted", async () => {
      parse.mockResolvedValue(
        buildSuccess([buildParsedTrip({ terminal: "PSA Quay 869" })]),
      );

      await importer.import(CONTENT, "order.pdf");

      expect(tripService.importTrips).toHaveBeenCalledWith(
        expect.objectContaining({
          trips: [expect.objectContaining({ terminal: "PSA Quay 869" })],
        }),
      );
    });

    it("does not canonicalise a terminal into another name", async () => {
      parse.mockResolvedValue(
        buildSuccess([buildParsedTrip({ terminal: "Quay 869" })]),
      );

      await importer.import(CONTENT, "order.pdf");

      const [command] = tripService.importTrips.mock.calls[0];

      expect(command.trips[0].terminal).toBe("Quay 869");
      expect(command.trips[0].terminal).not.toBe("PSA Antwerp");
    });

    /** An unfamiliar terminal is unconfigured, not invalid. */
    it("imports a terminal it has never seen before", async () => {
      parse.mockResolvedValue(
        buildSuccess([buildParsedTrip({ terminal: "Some New Quay 42" })]),
      );

      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).resolves.toBeDefined();
    });

    /** Pricing reports a missing route; the import does not refuse one. */
    it("stores null when the document names no terminal", async () => {
      parse.mockResolvedValue(
        buildSuccess([buildParsedTrip({ terminal: null })]),
      );

      await importer.import(CONTENT, "order.pdf");

      const [command] = tripService.importTrips.mock.calls[0];

      expect(command.trips[0].terminal).toBeNull();
    });
  });

  describe("what reaches the Trip domain", () => {
    it("imports a single Trip under the terminal the document printed", async () => {
      await importer.import(CONTENT, "order.pdf");

      expect(tripService.importTrips).toHaveBeenCalledWith(
        expect.objectContaining({
          asCombination: false,
          trips: [expect.objectContaining({ terminal: "Test Quay 1" })],
        }),
      );
    });

    it("passes the parser's values through unchanged", async () => {
      await importer.import(CONTENT, "order.pdf");

      const [command] = tripService.importTrips.mock.calls[0];

      expect(command.trips[0]).toMatchObject({
        bookingNumber: "ANRDUB2602247",
        containerType: "45PH",
        containerNumber: null,
        destinationCity: "Dourges",
        destinationCountry: "France",
        planningDate: "2025-05-22",
        startTime: "10:00",
        endTime: "16:00",
      });
    });

    it("keeps what the parser saw as diagnostics", async () => {
      await importer.import(CONTENT, "order.pdf");

      const [command] = tripService.importTrips.mock.calls[0];

      expect(command.trips[0].parserMetadata).toMatchObject({
        direction: "COLLECTION",
        documentTerminal: "Test Quay 1",
        raw: expect.objectContaining({ date: "22/05/2025" }),
      });
    });

    it("records the parser version on the document", async () => {
      await importer.import(CONTENT, "order.pdf");

      expect(pdfDocumentService.store).toHaveBeenCalledWith(
        CONTENT,
        "order.pdf",
        "1.0.0",
        undefined,
      );
    });

    /**
     * A caller that says nothing about where the PDF came from gets the
     * behaviour that existed before mailboxes did: a manual upload. The default
     * lives in PdfDocumentService, so the importer passes the absence through
     * rather than inventing a source of its own.
     */
    it("passes no provenance when the caller supplies none", async () => {
      await importer.import(CONTENT, "order.pdf");

      const [, , , provenance] = (pdfDocumentService.store as jest.Mock).mock
        .calls[0];

      expect(provenance).toBeUndefined();
    });

    it("passes provenance through to the document when given", async () => {
      await importer.import(CONTENT, "order.pdf", {
        provenance: {
          importSource: ImportSource.EMAIL,
          importedEmailId: "e1111111-1111-4111-8111-111111111111",
        },
      });

      expect(pdfDocumentService.store).toHaveBeenCalledWith(
        CONTENT,
        "order.pdf",
        "1.0.0",
        {
          importSource: ImportSource.EMAIL,
          importedEmailId: "e1111111-1111-4111-8111-111111111111",
        },
      );
    });
  });

  describe("combinations", () => {
    it("imports both grouped Trips as one Combination", async () => {
      parse.mockResolvedValue(buildSuccess(buildCombination()));

      const result = await importer.import(CONTENT, "order.pdf");

      expect(result.combination).toBe(true);
      expect(tripService.importTrips).toHaveBeenCalledWith(
        expect.objectContaining({ asCombination: true }),
      );
    });

    it("refuses a group that is not one COLLECTION and one DELIVERY", async () => {
      const [delivery] = buildCombination();

      parse.mockResolvedValue(
        buildSuccess([
          delivery,
          { ...delivery, bookingNumber: "DUBANR2598396" },
        ]),
      );

      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toBeInstanceOf(InvalidCombinationException);
    });

    it("refuses a group of more than two Trips", async () => {
      const groupKey = "combination:three";
      const trips = ["A1", "B2", "C3"].map((bookingNumber, index) =>
        buildParsedTrip({
          bookingNumber,
          groupKey,
          direction: index === 0 ? "DELIVERY" : "COLLECTION",
        }),
      );

      parse.mockResolvedValue(buildSuccess(trips));

      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toBeInstanceOf(InvalidCombinationException);
    });

    it("refuses a document where only some Trips are grouped", async () => {
      const [delivery] = buildCombination();

      parse.mockResolvedValue(
        buildSuccess([delivery, buildParsedTrip({ bookingNumber: "SOLO1" })]),
      );

      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toBeInstanceOf(InvalidCombinationException);
    });

    it("does not group two ungrouped Trips", async () => {
      parse.mockResolvedValue(
        buildSuccess([
          buildParsedTrip({ bookingNumber: "SOLO1" }),
          buildParsedTrip({ bookingNumber: "SOLO2" }),
        ]),
      );

      await importer.import(CONTENT, "order.pdf");

      expect(tripService.importTrips).toHaveBeenCalledWith(
        expect.objectContaining({ asCombination: false }),
      );
    });
  });

  describe("a parser that refuses the document", () => {
    it("turns a parse failure into a domain exception", async () => {
      parse.mockResolvedValue({
        ok: false,
        reason: "MISSING_REQUIRED_FIELD",
        message: "No booking number was found.",
        missingFields: ["bookingNumber"],
        detectedLabels: ["Terminal:"],
        metadata: { pageCount: 1, fragmentCount: 10, detectedSections: [] },
      });

      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toBeInstanceOf(UnreadablePdfException);
    });

    it("stores nothing when the document cannot be parsed", async () => {
      parse.mockResolvedValue({
        ok: false,
        reason: "INVALID_PDF",
        message: "The file could not be read as a PDF.",
        missingFields: [],
        detectedLabels: [],
        metadata: { pageCount: 0, fragmentCount: 0, detectedSections: [] },
      });

      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toThrow();

      expect(pdfDocumentService.store).not.toHaveBeenCalled();
      expect(tripService.importTrips).not.toHaveBeenCalled();
    });

    it("refuses a readable document that contains no Trip", async () => {
      parse.mockResolvedValue(buildSuccess([]));

      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toBeInstanceOf(NoTripsFoundException);
    });
  });

  describe("when the database write fails", () => {
    beforeEach(() => {
      tripService.importTrips.mockRejectedValue(new Error("insert failed"));
    });

    it("removes the file the failed import wrote", async () => {
      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toThrow("insert failed");

      expect(pdfDocumentService.discard).toHaveBeenCalledTimes(1);
    });

    it("reports why the import failed even when the cleanup also fails", async () => {
      pdfDocumentService.discard.mockRejectedValue(new Error("unlink failed"));

      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toThrow("insert failed");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  it("does not price the imported Trips", async () => {
    await importer.import(CONTENT, "order.pdf");

    // Pricing runs when a Trip is CLOSED, through the Trip domain's own event.
    // The importer has no pricing dependency at all, and must not acquire one.
    expect(Object.keys(importer)).not.toContain("pricingEngine");
  });

  it("logs the filename and counts, never the booking or destination", async () => {
    await importer.import(CONTENT, "order.pdf");

    const logged = JSON.stringify(logger.log.mock.calls);

    expect(logged).not.toContain("ANRDUB2602247");
    expect(logged).not.toContain("Dourges");
  });
});
