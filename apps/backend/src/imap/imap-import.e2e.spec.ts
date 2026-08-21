import { ConfigService } from "@nestjs/config";
import { ImportSource, TripStatus } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { PdfTripImporter } from "../pdf-import/pdf-trip-importer.service";
import { TripRepository } from "../trips/trip.repository";
import { TripRevisionService } from "../trips/trip-revision.service";
import { TripService } from "../trips/trip.service";
import { VehicleService } from "../vehicles/vehicle.service";
import {
  ImapMailboxClient,
  ImapMailboxSession,
  MailboxMessage,
} from "./imap-mailbox.client";
import { ImapScanService } from "./imap-scan.service";
import { ImportedEmailService } from "./imported-email.service";
import { TripPlanningDataService } from "../trips/trip-planning-data.service";

/**
 * One real transport order, from a mocked mailbox to the rows that would be
 * written.
 *
 * Everything between is genuine: the real PDF bytes from `docs/06-pdf/NEW`, the
 * real parser, the real terminal resolution, the real importer, the real
 * transaction orchestration. Only the two edges are replaced — IMAP, because a
 * test must not need a mailbox, and the repositories, because a test must not
 * write to the seeded database.
 *
 * That leaves exactly the chain this phase built:
 *
 *   email → ImportedEmail → PDF bytes → PdfTripImporter → PdfDocument → Trips
 */

/**
 * Well above what a scan needs, and deliberately so.
 *
 * These are the only tests in the backend that load pdfjs and parse a real PDF.
 * That cold start costs seconds on its own, and when the full suite runs the
 * work competes with every other worker for CPU — enough to exceed Jest's
 * five-second default on a busy machine. The default would make this suite fail
 * intermittently for a reason that has nothing to do with the code under test.
 */
jest.setTimeout(60_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf/NEW");
const IMPORTED_EMAIL_ID = "e1111111-1111-4111-8111-111111111111";
const PDF_DOCUMENT_ID = "d2222222-2222-4222-8222-222222222222";
const TRIP_GROUP_ID = "97777777-7777-4777-8777-777777777777";
const TRUSTED_SENDER = "orders@carrier.test";

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

function mailboxMessage(
  overrides: Partial<MailboxMessage> = {},
): MailboxMessage {
  return {
    uid: 101,
    messageId: "<order-1212816@carrier.test>",
    senderEmail: TRUSTED_SENDER,
    subject: "NEW: Trucking Order 1212816",
    receivedAt: new Date("2026-08-13T06:00:00.000Z"),
    attachments: [
      {
        part: "2",
        filename: "1page.pdf",
        contentType: "application/pdf",
        sizeBytes: 58949,
      },
    ],
    ...overrides,
  };
}

describe("IMAP import, end to end with a real transport order", () => {
  let storageDirectory: string;
  let createdTrips: Record<string, unknown>[];
  let createdPdfDocuments: Record<string, unknown>[];
  /** Every audit-trail row the scan wrote, in the order it wrote them. */
  let recordedHistory: Record<string, unknown>[];
  /** Documents compensated away after a failure. */
  let deletedPdfDocuments: string[];
  let session: {
    findCandidates: jest.Mock;
    downloadAttachment: jest.Mock;
    markSeen: jest.Mock;
  };
  let importedEmailStatus: { id: string; status: string; processedAt: unknown };
  /** The action the scan recorded for the message it processed. */
  let startedImportType: string | null;
  /** The import type of every email the scan refused to carry out. */
  let ignoredImports: string[];
  let scanService: ImapScanService;

  /**
   * Builds the real service graph, with the repositories replaced by in-memory
   * doubles that record what would have been written.
   */
  function buildScanService() {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    const pdfDocumentRepository = {
      findByFileHash: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Record<string, unknown>) => {
        createdPdfDocuments.push(data);
        return Promise.resolve({ id: PDF_DOCUMENT_ID, ...data });
      }),
      deleteById: jest.fn((id: string) => {
        deletedPdfDocuments.push(id);
        return Promise.resolve();
      }),
    } as unknown as PdfDocumentRepository;

    const tripRepository = {
      /*
       * The real lookup, in memory: a booking number is held by a Trip that
       * already exists. Without it a CANCEL or an UPDATE would find nothing in
       * these tests and pass for the wrong reason.
       */
      findByBookingNumber: jest.fn(
        ({
          bookingNumber,
          statuses,
        }: {
          bookingNumber: string;
          statuses: readonly TripStatus[];
        }) =>
          Promise.resolve(
            createdTrips.find(
              (trip) =>
                trip.bookingNumber === bookingNumber &&
                statuses.includes(trip.status as TripStatus),
            ) ?? null,
          ),
      ),
      update: jest.fn((id: string, data: Record<string, unknown>) => {
        const trip = createdTrips.find((candidate) => candidate.id === id);
        Object.assign(trip as Record<string, unknown>, data);
        return Promise.resolve(trip);
      }),
      setStatus: jest.fn((id: string, status: TripStatus) => {
        const trip = createdTrips.find((candidate) => candidate.id === id);
        Object.assign(trip as Record<string, unknown>, { status });
        return Promise.resolve(trip);
      }),
      /** Append-only, like the real one: rows accumulate and never change. */
      recordHistory: jest.fn((entries: Record<string, unknown>[]) => {
        recordedHistory.push(...entries);
        return Promise.resolve();
      }),
      runInTransaction: jest.fn((work: (repository: unknown) => unknown) =>
        work(tripRepository),
      ),
      createTripGroup: jest.fn().mockResolvedValue({ id: TRIP_GROUP_ID }),
      create: jest.fn((data: Record<string, unknown>) => {
        // A row as the database would return it: every column the import does
        // not set comes back as an explicit null, not absent. The response
        // mapper distinguishes the two, and a double that returns undefined
        // would fail for a reason the product does not have.
        const row = {
          vehicleId: null,
          driverId: null,
          containerNumber: null,
          terminal: null,
          startTime: null,
          endTime: null,
          executionDatetime: null,
          waitingTimeMinutes: null,
          distanceKm: null,
          internalNotes: null,
          parserMetadata: null,
          tripGroupId: null,
          ...data,
          id: `trip-${createdTrips.length + 1}`,
          status: TripStatus.OPEN,
          createdAt: new Date("2026-08-13T06:00:00.000Z"),
          updatedAt: new Date("2026-08-13T06:00:00.000Z"),
        };

        createdTrips.push(row);

        return Promise.resolve(row);
      }),
      runImportTransaction: jest.fn(
        (work: (repositories: unknown) => Promise<unknown>) =>
          work({ trips: tripRepository, pdfDocuments: pdfDocumentRepository }),
      ),
    } as unknown as TripRepository;

    const configService = {
      get: jest.fn((key: string) => (key === "ENABLE_IMAP" ? true : undefined)),
      getOrThrow: jest.fn((key: string) => {
        if (key === "PDF_STORAGE_DIR") return storageDirectory;
        if (key === "IMAP_TRUSTED_SENDERS") return [TRUSTED_SENDER];
        return "NEW:";
      }),
    } as unknown as ConfigService;

    const tripService = new TripService(
      tripRepository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        resolveOne: () =>
          Promise.resolve({ vehicle: null, effectiveDriver: null }),
        resolveMany: (trips: readonly { id: string }[]) =>
          Promise.resolve(
            new Map(
              trips.map((trip) => [
                trip.id,
                { vehicle: null, effectiveDriver: null },
              ]),
            ),
          ),
      } as unknown as TripPlanningDataService,
      { publish: jest.fn() } as unknown as DomainEventBus,
      logger,
    );

    const pdfDocumentService = new PdfDocumentService(
      pdfDocumentRepository,
      configService,
      logger,
    );

    // The real importer over the real revision rules, so a CANCEL email in
    // these tests takes exactly the path a real one takes.
    const importer = new PdfTripImporter(
      tripService,
      new TripRevisionService(tripRepository, logger),
      pdfDocumentService,
      {
        record: jest.fn().mockResolvedValue({
          outcome: "RECORDED",
          confirmation: null,
        }),
        findForTrips: jest.fn().mockResolvedValue(new Map()),
      } as unknown as CostConfirmationService,
      logger,
    );

    const importedEmailService = {
      findByMessageId: jest.fn().mockResolvedValue(null),
      startProcessing: jest.fn((_message: unknown, importType: unknown) => {
        startedImportType = String(importType);
        return Promise.resolve({ id: IMPORTED_EMAIL_ID });
      }),
      recordIgnored: jest.fn((_message: unknown, importType: unknown) => {
        ignoredImports.push(String(importType));
        return Promise.resolve({ id: IMPORTED_EMAIL_ID });
      }),
      markProcessed: jest.fn((id: string) => {
        importedEmailStatus = {
          id,
          status: "PROCESSED",
          processedAt: new Date(),
        };
        return Promise.resolve({});
      }),
      markFailed: jest.fn((id: string) => {
        importedEmailStatus = { id, status: "FAILED", processedAt: null };
        return Promise.resolve({});
      }),
      markAlreadyImported: jest.fn((id: string) => {
        importedEmailStatus = {
          id,
          status: "IGNORED",
          processedAt: new Date(),
        };
        return Promise.resolve({});
      }),
    } as unknown as ImportedEmailService;

    const mailboxClient = {
      withMailbox: (work: (s: ImapMailboxSession) => Promise<unknown>) =>
        work(session as unknown as ImapMailboxSession),
    } as unknown as ImapMailboxClient;

    return new ImapScanService(
      mailboxClient,
      importedEmailService,
      importer,
      configService,
      logger,
    );
  }

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-imap-e2e-"));
    createdTrips = [];
    createdPdfDocuments = [];
    recordedHistory = [];
    deletedPdfDocuments = [];
    importedEmailStatus = { id: "", status: "", processedAt: null };
    startedImportType = null;
    ignoredImports = [];

    session = {
      findCandidates: jest.fn().mockResolvedValue([mailboxMessage()]),
      downloadAttachment: jest.fn((_message, attachment) =>
        Promise.resolve({
          filename: attachment.filename,
          content: readFixture(attachment.filename),
        }),
      ),
      markSeen: jest.fn().mockResolvedValue(undefined),
    };

    scanService = buildScanService();
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  describe("a single-trip order", () => {
    it("imports one Trip from the real PDF", async () => {
      const result = await scanService.scan();

      expect(result).toMatchObject({ scanned: 1, imported: 1, failed: 0 });
      expect(createdTrips).toHaveLength(1);
    });

    it("extracts the booking the document actually states", async () => {
      await scanService.scan();

      expect(createdTrips[0]).toMatchObject({
        bookingNumber: "ANRDUB2602247",
        containerType: "45PH",
        destinationCity: "Dourges",
        destinationCountry: "France",
      });
    });

    it("records the PdfDocument as EMAIL, linked to the ImportedEmail", async () => {
      await scanService.scan();

      expect(createdPdfDocuments).toHaveLength(1);
      expect(createdPdfDocuments[0]).toMatchObject({
        importSource: ImportSource.EMAIL,
        importedEmailId: IMPORTED_EMAIL_ID,
        originalFilename: "1page.pdf",
        mimeType: "application/pdf",
      });
    });

    it("links the Trip to that PdfDocument", async () => {
      await scanService.scan();

      expect(createdTrips[0]).toMatchObject({
        pdfDocumentId: PDF_DOCUMENT_ID,
      });
    });

    it("creates no group for a single trip", async () => {
      await scanService.scan();

      expect(createdTrips[0]).toMatchObject({ tripGroupId: null });
    });

    /** Pricing runs when a Trip is CLOSED. An import must not price. */
    it("leaves the Trip OPEN and unpriced", async () => {
      await scanService.scan();

      const [trip] = createdTrips;

      expect(trip.status).toBe(TripStatus.OPEN);
      expect(trip.vehicleId).toBeNull();
      expect(trip.driverId).toBeNull();
    });

    it("marks the email PROCESSED and the message read", async () => {
      await scanService.scan();

      expect(importedEmailStatus).toMatchObject({
        id: IMPORTED_EMAIL_ID,
        status: "PROCESSED",
      });
      expect(session.markSeen).toHaveBeenCalledTimes(1);
    });
  });

  describe("a combination order", () => {
    beforeEach(() => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({
          messageId: "<order-1212625@carrier.test>",
          subject: "NEW: Trucking Order 1212625",
          attachments: [
            {
              part: "2",
              filename: "combination.pdf",
              contentType: "application/pdf",
              sizeBytes: 63017,
            },
          ],
        }),
      ]);
    });

    it("creates two Trips from the one PDF", async () => {
      const result = await scanService.scan();

      expect(result).toMatchObject({ imported: 1 });
      expect(createdTrips).toHaveLength(2);
    });

    /**
     * The rule the real documents establish: each leg carries its own booking
     * number, and the TripGroup is what links them.
     */
    it("gives each leg its own booking number under one group", async () => {
      await scanService.scan();

      const [delivery, collection] = createdTrips;

      expect(delivery.bookingNumber).toBe("DUBANR2598395");
      expect(collection.bookingNumber).toBe("ANRBEL2603249");
      expect(delivery.tripGroupId).toBe(TRIP_GROUP_ID);
      expect(collection.tripGroupId).toBe(TRIP_GROUP_ID);
    });

    it("attributes both Trips to the same single PdfDocument", async () => {
      await scanService.scan();

      expect(createdPdfDocuments).toHaveLength(1);
      expect(createdTrips[0].pdfDocumentId).toBe(PDF_DOCUMENT_ID);
      expect(createdTrips[1].pdfDocumentId).toBe(PDF_DOCUMENT_ID);
    });
  });

  /**
   * What actually happens today.
   *
   * The shipped terminal mapping is empty, so a real transport order naming
   * `PSA Quay 869` cannot be resolved to a configured terminal and the import
   * refuses. This is the intended behaviour until the business supplies the
   * pairs: a refused import is visible and fixable, a guessed terminal would
   * price the Trip against the wrong route silently.
   */
  /**
   * The terminal the real documents print is stored as-is. It is the Trip's
   * terminal and the key RoutePricing and RouteCost are configured under, so
   * anything else would break the exact match pricing performs.
   */
  describe("the terminal from a real transport order", () => {
    it("stores 1page.pdf's terminal exactly as printed", async () => {
      await scanService.scan();

      expect(createdTrips[0]).toMatchObject({ terminal: "PSA Quay 869" });
    });

    it("stores each leg of a combination with its own printed terminal", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({
          messageId: "<order-1212625@carrier.test>",
          attachments: [
            {
              part: "2",
              filename: "combination.pdf",
              contentType: "application/pdf",
              sizeBytes: 63017,
            },
          ],
        }),
      ]);

      await scanService.scan();

      expect(createdTrips.map((trip) => trip.terminal)).toEqual([
        "Quay 869",
        "PSA Quay 869",
      ]);
    });

    it("does not rewrite a terminal into a different name", async () => {
      await scanService.scan();

      expect(createdTrips[0].terminal).not.toBe("PSA Antwerp");
    });
  });

  /**
   * ── THE THREE MESSAGE OUTCOMES, WITH REAL DOCUMENTS ─────────────────────────
   * A scan does one of three things with a message, and each leaves a different
   * trace. The distinction that matters most is the last one: a message whose
   * import failed must stay UNREAD, because an unread message is the only thing
   * that will offer the order again.
   * ────────────────────────────────────────────────────────────────────────────
   */
  describe("what a scan does with a message", () => {
    /** Attaches a specific real document to the message a scan will find. */
    function messageCarrying(
      relativePath: string,
      overrides: Partial<MailboxMessage> = {},
    ) {
      const filename = relativePath.split("/").pop() as string;
      const content = new Uint8Array(
        readFileSync(resolve(FIXTURES, "..", relativePath)),
      );

      session.findCandidates.mockResolvedValue([
        mailboxMessage({
          messageId: `<${filename}@carrier.test>`,
          attachments: [
            {
              part: "2",
              filename,
              contentType: "application/pdf",
              sizeBytes: content.byteLength,
            },
          ],
          ...overrides,
        }),
      ]);

      session.downloadAttachment.mockResolvedValue({ filename, content });
    }

    it("imports a NEW order, then marks it PROCESSED and read", async () => {
      messageCarrying("NEW/1page.pdf");

      const result = await scanService.scan();

      expect(result.imported).toBe(1);
      expect(importedEmailStatus.status).toBe("PROCESSED");
      expect(session.markSeen).toHaveBeenCalledTimes(1);
    });

    /*
     * A CANCEL email cancels the Trip its document names. It is carried out,
     * so the message is marked PROCESSED and read — the instruction has been
     * dealt with and must not be offered again.
     */
    it("cancels the Trip a CANCEL: email names", async () => {
      messageCarrying("NEW/1page.pdf");
      await scanService.scan();
      expect(createdTrips[0].status).toBe(TripStatus.OPEN);

      messageCarrying("NEW/1page.pdf", {
        messageId: "<cancel-1page@carrier.test>",
        subject: "CANCEL: Trucking Order 1212816",
      });
      const result = await scanService.scan();

      expect(createdTrips).toHaveLength(1);
      expect(createdTrips[0].status).toBe(TripStatus.CANCELLED);
      expect(result).toMatchObject({ imported: 1, failed: 0 });
      expect(importedEmailStatus.status).toBe("PROCESSED");
      expect(session.markSeen).toHaveBeenCalled();

      // The cancellation document is KEPT: it is the reason the Trip left the
      // planning, and the event recording that points straight at it.
      expect(createdPdfDocuments).toHaveLength(2);
      expect(recordedHistory).toContainEqual(
        expect.objectContaining({
          eventType: "CANCELLED",
          pdfDocumentId: PDF_DOCUMENT_ID,
        }),
      );
    });

    /* A cancellation that matches nothing creates nothing, and still succeeds. */
    it("creates no Trip when a CANCEL: email matches nothing", async () => {
      messageCarrying("NEW/1page.pdf", {
        subject: "CANCEL: Trucking Order 1212816",
      });

      const result = await scanService.scan();

      expect(createdTrips).toEqual([]);
      expect(result).toMatchObject({ imported: 1, failed: 0 });
      expect(importedEmailStatus.status).toBe("PROCESSED");
      /*
       * The document is still kept. It arrived and was accepted; that it named
       * a booking we do not have is a fact about our records, not a reason to
       * throw the sender's document away. There is no Trip to record an event
       * against, which is why the history stays empty.
       */
      expect(createdPdfDocuments).toHaveLength(1);
      expect(recordedHistory).toEqual([]);
    });

    /*
     * An UPDATE email revises the Trip that already exists. The document here
     * is the same order, so the revision changes no value — which is exactly
     * the case worth pinning: no SECOND Trip appears, the document is still
     * kept, and the event says plainly that nothing moved.
     */
    it("revises the existing Trip an UPDATE: email names", async () => {
      messageCarrying("NEW/1page.pdf");
      await scanService.scan();

      messageCarrying("NEW/1page.pdf", {
        messageId: "<update-1page@carrier.test>",
        subject: "UPDATE: Trucking Order 1212816",
      });
      const result = await scanService.scan();

      expect(createdTrips).toHaveLength(1);
      expect(result).toMatchObject({ imported: 1, failed: 0 });
      expect(session.markSeen).toHaveBeenCalledTimes(2);

      // Two documents: the order, and the update that repeated it.
      expect(createdPdfDocuments).toHaveLength(2);
      expect(recordedHistory).toEqual([
        expect.objectContaining({
          eventType: "UPDATE_APPLIED",
          pdfDocumentId: PDF_DOCUMENT_ID,
          previousValue: undefined,
          newValue: undefined,
        }),
      ]);
    });

    /*
     * An UPDATE: email for a booking nobody holds CREATES the Trip. The order
     * it revises never reached us, and refusing it would leave real transport
     * out of the planning.
     */
    it("creates a Trip from an UPDATE: email that matches none", async () => {
      messageCarrying("NEW/1page.pdf", {
        subject: "UPDATE: Trucking Order 1212816",
      });

      const result = await scanService.scan();

      expect(createdTrips).toHaveLength(1);
      expect(createdTrips[0].status).toBe(TripStatus.OPEN);
      expect(result).toMatchObject({ imported: 1, failed: 0 });
      expect(importedEmailStatus.status).toBe("PROCESSED");
      expect(session.markSeen).toHaveBeenCalled();
      // Its document is kept: it is that Trip's source document now.
      expect(createdPdfDocuments).toHaveLength(1);
      expect(deletedPdfDocuments).toEqual([]);
      expect(recordedHistory).toContainEqual(
        expect.objectContaining({ eventType: "UPDATE_CREATED_TRIP" }),
      );
    });

    /*
     * A document stamped CANCELLED is cancelled even when the email says NEW.
     * The stamp is what the sender printed on the order itself.
     */
    it("does not plan work from a CANCELLED document sent as NEW", async () => {
      messageCarrying("CANCEL/cancelled_transportorder1353889.pdf", {
        subject: "NEW: Trucking Order 1353889",
      });

      const result = await scanService.scan();

      expect(createdTrips).toEqual([]);
      expect(result).toMatchObject({ imported: 1, failed: 0 });
      // Kept like any other cancellation: the stamp is the instruction.
      expect(createdPdfDocuments).toHaveLength(1);
    });


    /**
     * ── THE REAL PAIR, THROUGH THE MAILBOX ──────────────────────────────────
     * One booking, two real documents from the fixture folders, delivered as
     * three emails. This is the whole workflow at the boundary it actually
     * arrives at: the action comes from the SUBJECT, the bytes are the sender's
     * own, and every step is recorded against the same Trip.
     * ────────────────────────────────────────────────────────────────────────
     */
    describe("a real order, revised and then cancelled", () => {
      const PLANNED = "UPDATE/transportorder1369485.pdf";
      const CANCELLED = "CANCEL/cancelled_transportorder1369485.pdf";
      const BOOKING = "ANRDUB2790203";

      it("creates, revises and cancels one Trip", async () => {
        messageCarrying(PLANNED, {
          messageId: "<real-new@carrier.test>",
          subject: "NEW: Trucking Order 1369485",
        });
        await scanService.scan();

        expect(createdTrips).toHaveLength(1);
        expect(createdTrips[0].bookingNumber).toBe(BOOKING);
        expect(createdTrips[0].status).toBe(TripStatus.OPEN);

        messageCarrying(PLANNED, {
          messageId: "<real-update@carrier.test>",
          subject: "UPDATE: Trucking Order 1369485",
        });
        await scanService.scan();

        expect(createdTrips).toHaveLength(1);
        expect(recordedHistory).toContainEqual(
          expect.objectContaining({ eventType: "UPDATE_APPLIED" }),
        );

        messageCarrying(CANCELLED, {
          messageId: "<real-cancel@carrier.test>",
          subject: "CANCEL: Trucking Order 1369485",
        });
        const result = await scanService.scan();

        expect(createdTrips[0].status).toBe(TripStatus.CANCELLED);
        expect(result).toMatchObject({ imported: 1, failed: 0 });
        // Three emails, three documents, all kept.
        expect(createdPdfDocuments).toHaveLength(3);
        expect(importedEmailStatus.status).toBe("PROCESSED");
        expect(session.markSeen).toHaveBeenCalledTimes(3);
      });

      /** The dangerous order: the cancellation first, the revision after it. */
      it("keeps the Trip cancelled when the revision arrives last", async () => {
        messageCarrying(PLANNED, {
          messageId: "<real-new@carrier.test>",
          subject: "NEW: Trucking Order 1369485",
        });
        await scanService.scan();

        messageCarrying(CANCELLED, {
          messageId: "<real-cancel@carrier.test>",
          subject: "CANCEL: Trucking Order 1369485",
        });
        await scanService.scan();

        messageCarrying(PLANNED, {
          messageId: "<real-late-update@carrier.test>",
          subject: "UPDATE: Trucking Order 1369485",
        });
        const result = await scanService.scan();

        expect(createdTrips[0].status).toBe(TripStatus.CANCELLED);
        // The refusal is a failure for the MESSAGE — it stays unread and is
        // offered again — while the Trip and its documents are untouched.
        expect(result).toMatchObject({ failed: 1, imported: 0 });
        expect(importedEmailStatus.status).toBe("FAILED");
        expect(recordedHistory).toContainEqual(
          expect.objectContaining({ eventType: "UPDATE_REFUSED" }),
        );
      });

      /** A second NEW for the same booking must not create a second Trip. */
      it("creates no second Trip when the order is re-sent after cancelling", async () => {
        messageCarrying(PLANNED, {
          messageId: "<real-new@carrier.test>",
          subject: "NEW: Trucking Order 1369485",
        });
        await scanService.scan();

        messageCarrying(CANCELLED, {
          messageId: "<real-cancel@carrier.test>",
          subject: "CANCEL: Trucking Order 1369485",
        });
        await scanService.scan();

        messageCarrying(PLANNED, {
          messageId: "<real-new-again@carrier.test>",
          subject: "NEW: Trucking Order 1369485",
        });
        const result = await scanService.scan();

        expect(createdTrips).toHaveLength(1);
        expect(createdTrips[0].status).toBe(TripStatus.CANCELLED);
        // Its Trips already exist, which is not a failure.
        expect(result).toMatchObject({ alreadyProcessed: 1, failed: 0 });
        expect(recordedHistory).toContainEqual(
          expect.objectContaining({ eventType: "NEW_REFUSED_DUPLICATE" }),
        );
      });
    });


    /**
     * ── A COST CONFIRMATION THROUGH THE MAILBOX ─────────────────────────────
     * Eucon sends these after we report a waiting time. The subject announces
     * the action, the PDF states the amount, and the Trip it names already
     * exists — which is the point: a confirmation is read by its own reader
     * precisely so the transport order printed inside it never becomes a
     * second Trip.
     * ────────────────────────────────────────────────────────────────────────
     */
    describe("a cost confirmation", () => {
      const CONFIRMATION =
        "Cost-Combination/COST_CONFIRMATION_NR_4132482__ANRDUB2789089__EUCU4530818.pdf";
      const BOOKING = "ANRDUB2789089";

      /** The Trip the confirmation names, as an ordinary order would create it. */
      function existingTrip() {
        createdTrips.push({
          id: "trip-existing",
          bookingNumber: BOOKING,
          status: TripStatus.OPEN,
          waitingTimeMinutes: 150,
          vehicleId: "vehicle-1",
        } as unknown as Record<string, unknown>);
      }

      it("records the confirmed amount against the Trip it names", async () => {
        existingTrip();
        messageCarrying(CONFIRMATION, {
          messageId: "<cc-4132482@carrier.test>",
          subject: "COST CONFIRMATION NR 4132482 ANRDUB2789089",
        });

        const result = await scanService.scan();

        expect(result).toMatchObject({ imported: 1, failed: 0 });
        expect(importedEmailStatus.status).toBe("PROCESSED");
        expect(session.markSeen).toHaveBeenCalled();
        // The document is kept, and no Trip was created.
        expect(createdPdfDocuments).toHaveLength(1);
        expect(createdTrips).toHaveLength(1);
      });

      it("is recorded as its own kind of email", async () => {
        existingTrip();
        messageCarrying(CONFIRMATION, {
          messageId: "<cc-4132482@carrier.test>",
          subject: "COST CONFIRMATION NR 4132482 ANRDUB2789089",
        });

        await scanService.scan();

        // Not NEW, not UPDATE, not CANCEL: /imports must be able to tell.
        expect(startedImportType).toBe("COST_CONFIRMATION");
      });

      it("changes nothing about the Trip", async () => {
        existingTrip();
        const before = { ...createdTrips[0] };
        messageCarrying(CONFIRMATION, {
          messageId: "<cc-4132482@carrier.test>",
          subject: "COST CONFIRMATION NR 4132482 ANRDUB2789089",
        });

        await scanService.scan();

        // Not the status, and above all not the waiting time it confirms.
        expect(createdTrips[0]).toEqual(before);
      });

      it("leaves an unknown booking retryable, creating nothing", async () => {
        messageCarrying(CONFIRMATION, {
          messageId: "<cc-unknown@carrier.test>",
          subject: "COST CONFIRMATION NR 4132482 ANRDUB2789089",
        });

        const result = await scanService.scan();

        expect(result).toMatchObject({ failed: 1, imported: 0 });
        expect(importedEmailStatus.status).toBe("FAILED");
        // Unread, so the next scan offers it again once the Trip exists.
        expect(session.markSeen).not.toHaveBeenCalled();
        expect(createdTrips).toEqual([]);
        expect(createdPdfDocuments).toEqual([]);
      });

      it("refuses a subject that contradicts its document", async () => {
        existingTrip();
        messageCarrying(CONFIRMATION, {
          messageId: "<cc-mismatch@carrier.test>",
          subject: "COST CONFIRMATION NR 9999999 ANRDUB9999999",
        });

        const result = await scanService.scan();

        expect(result).toMatchObject({ failed: 1, imported: 0 });
        expect(session.markSeen).not.toHaveBeenCalled();
        expect(createdPdfDocuments).toEqual([]);
      });
    });

    it("marks an unreadable attachment FAILED and leaves it unread", async () => {
      session.findCandidates.mockResolvedValue([mailboxMessage()]);
      session.downloadAttachment.mockResolvedValue({
        filename: "broken.pdf",
        content: new Uint8Array(Buffer.from("this is not a PDF at all")),
      });

      const result = await scanService.scan();

      expect(result).toMatchObject({ failed: 1, imported: 0 });
      expect(importedEmailStatus.status).toBe("FAILED");
      expect(session.markSeen).not.toHaveBeenCalled();
      expect(createdTrips).toEqual([]);
    });

    it("leaves no stored file behind when an order cannot be read", async () => {
      session.findCandidates.mockResolvedValue([mailboxMessage()]);
      session.downloadAttachment.mockResolvedValue({
        filename: "broken.pdf",
        content: new Uint8Array(Buffer.from("this is not a PDF at all")),
      });

      await scanService.scan();

      expect(readdirSync(storageDirectory)).toEqual([]);
    });

    /*
     * A cancellation DOES store its document: it is the reason a Trip left the
     * planning, and the event recording that points at it.
     */
    it("keeps the file of a cancellation", async () => {
      messageCarrying("NEW/1page.pdf", {
        subject: "CANCEL: Trucking Order 1212816",
      });

      await scanService.scan();

      expect(readdirSync(storageDirectory)).toHaveLength(1);
    });
  });
});
