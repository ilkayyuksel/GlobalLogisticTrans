import type { ParseResult, ParsedTrip } from "@tms/parser";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { TripService } from "../trips/trip.service";
import {
  InvalidCombinationException,
  NoTripsFoundException,
  PdfImportErrorCode,
  UnknownTerminalException,
  UnreadablePdfException,
} from "./exceptions/pdf-import.exceptions";
import { PdfTripImporter } from "./pdf-trip-importer.service";
import { TerminalMapping } from "./terminal-mapping";

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

/**
 * A mapping that exists only in this file.
 *
 * The shipped table is empty and must stay empty until the real terminal pairs
 * are supplied, so the mapped path is proved with a table the test owns. These
 * pairs are test fixtures, not a proposal: nothing here should ever be copied
 * into the shipped mapping.
 */
const TEST_TERMINAL_MAPPING: TerminalMapping = {
  "Test Quay 1": "Test Terminal One",
  "Test Quay 2": "Test Terminal Two",
};

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

    importer = new PdfTripImporter(
      tripService as unknown as TripService,
      pdfDocumentService as unknown as PdfDocumentService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("the shipped terminal mapping", () => {
    /**
     * These two tests are the reason the mapping can stay empty. They must keep
     * passing after the real pairs are added, so neither names a terminal.
     */
    it("refuses the import when the printed terminal is not mapped", async () => {
      await expect(
        importer.import(CONTENT, "order.pdf"),
      ).rejects.toBeInstanceOf(UnknownTerminalException);
    });

    it("reports the raw terminal and the booking, so the mapping can be fixed", async () => {
      const failure = await importer
        .import(CONTENT, "order.pdf")
        .catch((error: UnknownTerminalException) => error);

      expect(failure).toBeInstanceOf(UnknownTerminalException);
      expect((failure as UnknownTerminalException).code).toBe(
        PdfImportErrorCode.UNKNOWN_TERMINAL,
      );
      expect((failure as UnknownTerminalException).documentTerminal).toBe(
        "Test Quay 1",
      );
      expect((failure as UnknownTerminalException).bookingNumber).toBe(
        "ANRDUB2602247",
      );
    });

    it("never falls back to the raw terminal text", async () => {
      await expect(importer.import(CONTENT, "order.pdf")).rejects.toThrow();

      expect(tripService.importTrips).not.toHaveBeenCalled();
    });

    it("refuses a document that names no terminal at all", async () => {
      parse.mockResolvedValue(
        buildSuccess([buildParsedTrip({ terminal: null })]),
      );

      await expect(
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
      ).rejects.toBeInstanceOf(UnknownTerminalException);
    });
  });

  describe("an unmapped terminal leaves nothing behind", () => {
    it("stores no file, because the terminal is resolved first", async () => {
      await expect(importer.import(CONTENT, "order.pdf")).rejects.toThrow();

      expect(pdfDocumentService.store).not.toHaveBeenCalled();
    });

    it("writes no document and no Trip", async () => {
      await expect(importer.import(CONTENT, "order.pdf")).rejects.toThrow();

      expect(tripService.importTrips).not.toHaveBeenCalled();
    });

    it("refuses the whole Combination when only one leg is unmapped", async () => {
      const [delivery, collection] = buildCombination();

      parse.mockResolvedValue(
        buildSuccess([delivery, { ...collection, terminal: "Unmapped Quay" }]),
      );

      await expect(
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
      ).rejects.toBeInstanceOf(UnknownTerminalException);

      expect(pdfDocumentService.store).not.toHaveBeenCalled();
      expect(tripService.importTrips).not.toHaveBeenCalled();
    });
  });

  describe("with a mapping supplied", () => {
    it("imports a single Trip under its mapped terminal name", async () => {
      await importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING);

      expect(tripService.importTrips).toHaveBeenCalledWith(
        expect.objectContaining({
          asCombination: false,
          trips: [expect.objectContaining({ terminal: "Test Terminal One" })],
        }),
      );
    });

    it("passes the parser's values through unchanged", async () => {
      await importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING);

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
      await importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING);

      const [command] = tripService.importTrips.mock.calls[0];

      expect(command.trips[0].parserMetadata).toMatchObject({
        direction: "COLLECTION",
        documentTerminal: "Test Quay 1",
        raw: expect.objectContaining({ date: "22/05/2025" }),
      });
    });

    it("records the parser version on the document", async () => {
      await importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING);

      expect(pdfDocumentService.store).toHaveBeenCalledWith(
        CONTENT,
        "order.pdf",
        "1.0.0",
      );
    });
  });

  describe("combinations", () => {
    it("imports both grouped Trips as one Combination", async () => {
      parse.mockResolvedValue(buildSuccess(buildCombination()));

      const result = await importer.import(
        CONTENT,
        "order.pdf",
        TEST_TERMINAL_MAPPING,
      );

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
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
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
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
      ).rejects.toBeInstanceOf(InvalidCombinationException);
    });

    it("refuses a document where only some Trips are grouped", async () => {
      const [delivery] = buildCombination();

      parse.mockResolvedValue(
        buildSuccess([delivery, buildParsedTrip({ bookingNumber: "SOLO1" })]),
      );

      await expect(
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
      ).rejects.toBeInstanceOf(InvalidCombinationException);
    });

    it("does not group two ungrouped Trips", async () => {
      parse.mockResolvedValue(
        buildSuccess([
          buildParsedTrip({ bookingNumber: "SOLO1" }),
          buildParsedTrip({ bookingNumber: "SOLO2" }),
        ]),
      );

      await importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING);

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
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
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
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
      ).rejects.toThrow();

      expect(pdfDocumentService.store).not.toHaveBeenCalled();
      expect(tripService.importTrips).not.toHaveBeenCalled();
    });

    it("refuses a readable document that contains no Trip", async () => {
      parse.mockResolvedValue(buildSuccess([]));

      await expect(
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
      ).rejects.toBeInstanceOf(NoTripsFoundException);
    });
  });

  describe("when the database write fails", () => {
    beforeEach(() => {
      tripService.importTrips.mockRejectedValue(new Error("insert failed"));
    });

    it("removes the file the failed import wrote", async () => {
      await expect(
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
      ).rejects.toThrow("insert failed");

      expect(pdfDocumentService.discard).toHaveBeenCalledTimes(1);
    });

    it("reports why the import failed even when the cleanup also fails", async () => {
      pdfDocumentService.discard.mockRejectedValue(new Error("unlink failed"));

      await expect(
        importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING),
      ).rejects.toThrow("insert failed");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  it("does not price the imported Trips", async () => {
    await importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING);

    // Pricing runs when a Trip is CLOSED, through the Trip domain's own event.
    // The importer has no pricing dependency at all, and must not acquire one.
    expect(Object.keys(importer)).not.toContain("pricingEngine");
  });

  it("logs the filename and counts, never the booking or destination", async () => {
    await importer.import(CONTENT, "order.pdf", TEST_TERMINAL_MAPPING);

    const logged = JSON.stringify(logger.log.mock.calls);

    expect(logged).not.toContain("ANRDUB2602247");
    expect(logged).not.toContain("Dourges");
  });
});
