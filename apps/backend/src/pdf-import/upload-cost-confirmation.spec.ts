import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfTripImporter } from "./pdf-trip-importer.service";
import { PdfUploadService } from "./pdf-upload.service";
import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";
import { UploadedPdfFile } from "./uploaded-pdf-file";

/**
 * Manual upload of a Cost Confirmation.
 *
 * ── WHAT WAS MISSING ────────────────────────────────────────────────────────
 * Upload only ever called the transport-order path. A Cost Confirmation
 * therefore reached a parser that requires a `Bookings nr/Trip nr:` line — a
 * line a confirmation does not print, and correctly so — and was refused with a
 * message about a document family the operator had not sent. Emailed
 * confirmations always worked, because the subject selected the right path.
 *
 * ── WHAT DECIDES THE PATH ───────────────────────────────────────────────────
 * The DOCUMENT, through the parser. A confirmation carries a
 * `COST CONFIRMATION NR` header; anything without one is reported as
 * `NOT_A_COST_CONFIRMATION` and goes to the transport-order path exactly as
 * before. No filename, booking number or customer name is consulted.
 *
 * ── AND WHAT HAPPENS AFTERWARDS ─────────────────────────────────────────────
 * Nothing new. The upload calls `PdfTripImporter.confirmCost`, which is the
 * same method the mailbox calls, so booking matching, the digit-only fallback,
 * the ambiguity refusal, the recording and the pricing update are the ones that
 * already existed. This file proves the ROUTING and that the existing rules are
 * reached — the rules themselves are proven in the cost-confirmation workflow
 * spec.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(120_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");

/** The real confirmation this phase exists for. */
const CONFIRMATION = join(
  "NEW-BUG",
  "COST_CONFIRMATION_NR_4156173__ANRDUB2794719__CNEU4597558.pdf",
);
/** A real transport order, to prove that path is untouched. */
const TRANSPORT_ORDER = join("NEW", "1page.pdf");

const CONFIRMATION_BOOKING = "ANRDUB2794719";
/** The ordered transport date and container this confirmation itself prints. */
const CONFIRMATION_DATE = "2026-08-31";
const CONFIRMATION_CONTAINER = "CNEU4597558";
const ORDER_BOOKING = "ANRDUB2602247";

function uploaded(fixture: string): UploadedPdfFile {
  const buffer = readFileSync(join(FIXTURES, fixture));

  return {
    originalname: fixture.split(/[\\/]/).pop() as string,
    mimetype: "application/pdf",
    size: buffer.length,
    buffer,
  };
}

describe("uploading a Cost Confirmation by hand", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;
  let service: PdfUploadService;
  let importSpy: jest.SpyInstance;
  let confirmSpy: jest.SpyInstance;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-upload-cc-"));
    harness = buildHarness(storageDirectory);

    // The REAL importer, watched rather than replaced: which path a file takes
    // is the whole question here, and a double could not answer it.
    importSpy = jest.spyOn(harness.importer, "import");
    confirmSpy = jest.spyOn(harness.importer, "confirmCost");

    service = new PdfUploadService(
      harness.importer as unknown as PdfTripImporter,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(storageDirectory, { recursive: true, force: true });
  });

  /**
   * The Trip the confirmation names, carrying what matching requires: the
   * booking, the ORDERED date the confirmation prints, and the container it
   * names. This confirmation names a usable container, so its original source
   * is never consulted.
   */
  function seedTrip(bookingNumber: string) {
    const trip = {
      id: `trip-${harness.trips.length + 1}`,
      bookingNumber,
      status: TripStatus.OPEN,
      containerNumber: CONFIRMATION_CONTAINER,
      containerType: "45PH",
      terminal: "PSA Quay 869",
      destinationCity: "Dendermonde",
      destinationCountry: "Belgium",
      planningDate: new Date(`${CONFIRMATION_DATE}T00:00:00.000Z`),
      originalPlanningDate: new Date(`${CONFIRMATION_DATE}T00:00:00.000Z`),
      waitingTimeMinutes: 150,
      tripGroupId: null,
      pdfDocumentId: null,
    };

    harness.trips.push(trip);

    return trip;
  }

  describe("the document decides the path", () => {
    it("routes the confirmation to confirmCost", async () => {
      seedTrip(CONFIRMATION_BOOKING);

      await service.importUploadedFiles([uploaded(CONFIRMATION)]);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
    });

    /** The heart of the fix: it must never reach the transport-order path. */
    it("never calls the transport-order import for it", async () => {
      seedTrip(CONFIRMATION_BOOKING);

      await service.importUploadedFiles([uploaded(CONFIRMATION)]);

      expect(importSpy).not.toHaveBeenCalled();
    });

    it("still routes a transport order to import", async () => {
      await service.importUploadedFiles([uploaded(TRANSPORT_ORDER)]);

      expect(importSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    /** Renaming a file must not change what it is. */
    it("routes on the document, not the filename", async () => {
      seedTrip(CONFIRMATION_BOOKING);

      const disguised = {
        ...uploaded(CONFIRMATION),
        originalname: "transportorder-9999.pdf",
      };

      await service.importUploadedFiles([disguised]);

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(importSpy).not.toHaveBeenCalled();
    });
  });

  describe("what the caller is told", () => {
    it("reports it as a Cost Confirmation", async () => {
      seedTrip(CONFIRMATION_BOOKING);

      const { results } = await service.importUploadedFiles([
        uploaded(CONFIRMATION),
      ]);

      expect(results[0]).toMatchObject({
        ok: true,
        kind: "COST_CONFIRMATION",
      });
    });

    it("returns the confirmation's own figures", async () => {
      const trip = seedTrip(CONFIRMATION_BOOKING);

      const { results } = await service.importUploadedFiles([
        uploaded(CONFIRMATION),
      ]);

      expect(results[0].costConfirmations).toEqual([
        {
          ccNumber: "4156173",
          bookingNumber: CONFIRMATION_BOOKING,
          tripId: trip.id,
          amount: "68.75",
          currency: "EUR",
          outcome: "RECORDED",
        },
      ]);
    });

    /** A confirmation attaches money to a Trip; it does not create one. */
    it("creates no Trip", async () => {
      seedTrip(CONFIRMATION_BOOKING);

      const { results } = await service.importUploadedFiles([
        uploaded(CONFIRMATION),
      ]);

      expect(results[0].trips).toEqual([]);
      expect(results[0].combination).toBe(false);
      expect(harness.trips).toHaveLength(1);
    });

    it("marks a transport order as one", async () => {
      const { results } = await service.importUploadedFiles([
        uploaded(TRANSPORT_ORDER),
      ]);

      expect(results[0]).toMatchObject({ ok: true, kind: "TRANSPORT_ORDER" });
      expect(results[0].trips).toHaveLength(1);
    });
  });

  /**
   * ── THE EXISTING RULES ARE THE ONES THAT RUN ──────────────────────────────
   * None of these outcomes is implemented by the upload layer. They are the
   * importer's, and they are asserted here only to show that routing reaches
   * them rather than bypassing them.
   */
  describe("the existing Cost Confirmation rules apply", () => {
    it("records the cost against the Trip its booking names", async () => {
      const trip = seedTrip(CONFIRMATION_BOOKING);

      await service.importUploadedFiles([uploaded(CONFIRMATION)]);

      expect(harness.costConfirmations).toHaveLength(1);
      expect(harness.costConfirmations[0]).toMatchObject({ tripId: trip.id });
    });

    it("refuses when no Trip holds the booking", async () => {
      const { results } = await service.importUploadedFiles([
        uploaded(CONFIRMATION),
      ]);

      expect(results[0]).toMatchObject({
        ok: false,
        kind: "COST_CONFIRMATION",
      });
      expect(results[0].message).toMatch(/was not recorded/);
      expect(harness.costConfirmations).toEqual([]);
    });

    /** Two Trips on one booking: nobody chooses, and the upload says so. */
    it("refuses an ambiguous booking", async () => {
      seedTrip(CONFIRMATION_BOOKING);
      seedTrip(CONFIRMATION_BOOKING);

      const { results } = await service.importUploadedFiles([
        uploaded(CONFIRMATION),
      ]);

      expect(results[0].ok).toBe(false);
      expect(results[0].message).toMatch(/2 Trips/);
      expect(harness.costConfirmations).toEqual([]);
    });

    /** The same confirmation twice is recorded once. */
    it("is idempotent", async () => {
      seedTrip(CONFIRMATION_BOOKING);

      await service.importUploadedFiles([uploaded(CONFIRMATION)]);
      const { results } = await service.importUploadedFiles([
        uploaded(CONFIRMATION),
      ]);

      expect(results[0].ok).toBe(true);
      expect(results[0].costConfirmations?.[0].outcome).toBe(
        "ALREADY_RECORDED",
      );
      expect(harness.costConfirmations).toHaveLength(1);
    });

    /** Its document is kept, exactly as an emailed confirmation's is. */
    it("stores the document", async () => {
      seedTrip(CONFIRMATION_BOOKING);

      await service.importUploadedFiles([uploaded(CONFIRMATION)]);

      expect(harness.pdfDocuments).toHaveLength(1);
    });
  });

  /**
   * A batch is a batch of independent documents, and the two families mix
   * freely: one file's kind says nothing about the next one's.
   */
  describe("a batch of both kinds", () => {
    it("reports each file as what it was", async () => {
      seedTrip(CONFIRMATION_BOOKING);

      const { results } = await service.importUploadedFiles([
        uploaded(TRANSPORT_ORDER),
        uploaded(CONFIRMATION),
      ]);

      expect(results.map((result) => result.kind)).toEqual([
        "TRANSPORT_ORDER",
        "COST_CONFIRMATION",
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
    });

    it("lets a refused confirmation leave a good order alone", async () => {
      const { results } = await service.importUploadedFiles([
        uploaded(TRANSPORT_ORDER),
        // No Trip seeded for it, so the confirmation is refused.
        uploaded(CONFIRMATION),
      ]);

      expect(results[0]).toMatchObject({ ok: true, kind: "TRANSPORT_ORDER" });
      expect(results[1]).toMatchObject({ ok: false, kind: "COST_CONFIRMATION" });
      expect(
        harness.trips.map((trip) => trip.bookingNumber),
      ).toEqual([ORDER_BOOKING]);
    });
  });
});
