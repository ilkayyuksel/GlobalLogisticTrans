import { ConfigService } from "@nestjs/config";
import {
  EmailProcessingStatus,
  ImportSource,
  ImportType,
} from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { UnknownTerminalException } from "../pdf-import/exceptions/pdf-import.exceptions";
import { PdfTripImporter } from "../pdf-import/pdf-trip-importer.service";
import { DuplicateBookingNumberException } from "../trips/exceptions/trip.exceptions";
import {
  ImapConnectionException,
  ImapDisabledException,
  ImapErrorCode,
} from "./exceptions/imap.exceptions";
import {
  ImapMailboxClient,
  ImapMailboxSession,
  MailboxAttachment,
  MailboxMessage,
} from "./imap-mailbox.client";
import { ImapScanService } from "./imap-scan.service";
import { ImportedEmailService } from "./imported-email.service";

/**
 * The scan's behaviour, with the mailbox replaced at its boundary.
 *
 * No test here opens a socket. `ImapMailboxClient` is the seam: everything it
 * would have learned from a server is supplied as plain data, which is what
 * makes the failure paths — a refused login, a missing attachment, a rejected
 * PDF — exhaustively testable.
 */

const TRUSTED_SENDER = "orders@carrier.test";
const IMPORTED_EMAIL_ID = "e1111111-1111-4111-8111-111111111111";

function pdfAttachment(
  overrides: Partial<MailboxAttachment> = {},
): MailboxAttachment {
  return {
    part: "2",
    filename: "order.pdf",
    contentType: "application/pdf",
    sizeBytes: 58949,
    ...overrides,
  };
}

function mailboxMessage(
  overrides: Partial<MailboxMessage> = {},
): MailboxMessage {
  return {
    uid: 101,
    messageId: "<order-1@carrier.test>",
    senderEmail: TRUSTED_SENDER,
    subject: "NEW: Trucking Order 1212816",
    receivedAt: new Date("2026-08-13T06:00:00.000Z"),
    attachments: [pdfAttachment()],
    ...overrides,
  };
}

describe("ImapScanService", () => {
  let session: {
    findCandidates: jest.Mock;
    downloadAttachment: jest.Mock;
    markSeen: jest.Mock;
  };
  let mailboxClient: { withMailbox: jest.Mock };
  let importedEmailService: {
    findByMessageId: jest.Mock;
    startProcessing: jest.Mock;
    recordIgnored: jest.Mock;
    markProcessed: jest.Mock;
    markFailed: jest.Mock;
    markAlreadyImported: jest.Mock;
  };
  let pdfTripImporter: {
    import: jest.Mock;
    cancel: jest.Mock;
    revise: jest.Mock;
  };
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let service: ImapScanService;

  beforeEach(() => {
    session = {
      findCandidates: jest.fn().mockResolvedValue([mailboxMessage()]),
      downloadAttachment: jest.fn().mockResolvedValue({
        filename: "order.pdf",
        content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      }),
      markSeen: jest.fn().mockResolvedValue(undefined),
    };

    mailboxClient = {
      withMailbox: jest.fn((work: (s: unknown) => Promise<unknown>) =>
        work(session as unknown as ImapMailboxSession),
      ),
    };

    importedEmailService = {
      findByMessageId: jest.fn().mockResolvedValue(null),
      startProcessing: jest.fn().mockResolvedValue({ id: IMPORTED_EMAIL_ID }),
      recordIgnored: jest.fn().mockResolvedValue({ id: IMPORTED_EMAIL_ID }),
      markProcessed: jest.fn().mockResolvedValue({}),
      markFailed: jest.fn().mockResolvedValue({}),
      markAlreadyImported: jest.fn().mockResolvedValue({}),
    };

    pdfTripImporter = {
      import: jest.fn().mockResolvedValue({
        trips: [{ id: "trip-1" }],
        combination: false,
        cancellations: [],
        revisions: [],
        costConfirmations: [],
      }),
      cancel: jest.fn().mockResolvedValue({
        trips: [],
        combination: false,
        cancellations: [{ bookingNumber: "ANRDUB2602247", outcome: "CANCELLED" }],
        revisions: [],
        costConfirmations: [],
      }),
      revise: jest.fn().mockResolvedValue({
        trips: [],
        combination: false,
        cancellations: [],
        revisions: [{ bookingNumber: "ANRDUB2602247", tripId: "trip-1" }],
      }),
    };

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string) => (key === "ENABLE_IMAP" ? true : undefined)),
      getOrThrow: jest.fn((key: string) =>
        key === "IMAP_TRUSTED_SENDERS" ? [TRUSTED_SENDER] : "NEW:",
      ),
    };

    service = new ImapScanService(
      mailboxClient as unknown as ImapMailboxClient,
      importedEmailService as unknown as ImportedEmailService,
      pdfTripImporter as unknown as PdfTripImporter,
      configService as unknown as ConfigService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("a relevant email with one PDF", () => {
    it("imports it and reports one import", async () => {
      const result = await service.scan();

      expect(pdfTripImporter.import).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ scanned: 1, imported: 1, failed: 0 });
    });

    it("passes EMAIL provenance carrying the ImportedEmail id", async () => {
      await service.scan();

      expect(pdfTripImporter.import).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "order.pdf",
        {
          provenance: {
            importSource: ImportSource.EMAIL,
            importedEmailId: IMPORTED_EMAIL_ID,
          },
        },
      );
    });

    it("marks the email PROCESSED and the message read", async () => {
      await service.scan();

      expect(importedEmailService.markProcessed).toHaveBeenCalledWith(
        IMPORTED_EMAIL_ID,
      );
      expect(session.markSeen).toHaveBeenCalledTimes(1);
    });

    /**
     * A message marked read before the Trips exist would never be offered
     * again, and the order would be silently lost.
     */
    it("marks it read only after the import succeeded", async () => {
      const order: string[] = [];

      pdfTripImporter.import.mockImplementation(() => {
        order.push("import");
        return Promise.resolve({ trips: [], combination: false });
      });
      session.markSeen.mockImplementation(() => {
        order.push("markSeen");
        return Promise.resolve();
      });

      await service.scan();

      expect(order).toEqual(["import", "markSeen"]);
    });

    it("does not supply a terminal mapping, so the real one applies", async () => {
      await service.scan();

      const [, , options] = pdfTripImporter.import.mock.calls[0];

      expect(options.terminalMapping).toBeUndefined();
    });
  });

  /**
   * The three instructions, each routed to its own operation. The subject
   * decides which; the importer decides what each one means.
   */
  describe("the instruction an email carries", () => {
    it("imports a NEW order", async () => {
      await service.scan();

      expect(pdfTripImporter.import).toHaveBeenCalledTimes(1);
      expect(pdfTripImporter.cancel).not.toHaveBeenCalled();
      expect(pdfTripImporter.revise).not.toHaveBeenCalled();
    });

    it.each([
      ["CANCEL: Booking Cancelled", "cancel"],
      ["UPDATE: Booking Changed", "revise"],
    ] as const)("routes %p to the importer's %s", async (subject, method) => {
      session.findCandidates.mockResolvedValue([mailboxMessage({ subject })]);

      const result = await service.scan();

      expect(pdfTripImporter[method]).toHaveBeenCalledTimes(1);
      expect(pdfTripImporter.import).not.toHaveBeenCalled();
      // Carried out, so it counts as processed and is marked read.
      expect(result).toMatchObject({ scanned: 1, imported: 1, ignored: 0 });
      expect(session.markSeen).toHaveBeenCalledTimes(1);
    });

    /*
     * A cancellation and a revision store no PdfDocument, so neither carries
     * provenance: only a NEW order creates the Trip a document is recorded for.
     */
    it("gives a NEW order its email provenance", async () => {
      await service.scan();

      const [, , options] = pdfTripImporter.import.mock.calls[0];

      expect(options.provenance.importedEmailId).toBe(IMPORTED_EMAIL_ID);
    });

    it("marks a failed instruction FAILED and leaves it unread", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({ subject: "UPDATE: Booking Changed" }),
      ]);
      pdfTripImporter.revise.mockRejectedValue(
        new Error("no Trip holds that booking number"),
      );

      const result = await service.scan();

      expect(result).toMatchObject({ failed: 1, imported: 0 });
      expect(importedEmailService.markFailed).toHaveBeenCalledTimes(1);
      expect(session.markSeen).not.toHaveBeenCalled();
    });
  });

  describe("emails that must not be imported", () => {
    it.each([
      ["an untrusted sender", { senderEmail: "stranger@elsewhere.test" }],
      ["no recognised prefix", { subject: "Fwd: lunch" }],
    ])("ignores %s without importing", async (_case, overrides) => {
      session.findCandidates.mockResolvedValue([mailboxMessage(overrides)]);

      const result = await service.scan();

      expect(pdfTripImporter.import).not.toHaveBeenCalled();
      expect(result).toMatchObject({ scanned: 1, ignored: 1, imported: 0 });
    });

    it("never downloads an attachment for an irrelevant email", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({ subject: "Fwd: lunch" }),
      ]);

      await service.scan();

      expect(session.downloadAttachment).not.toHaveBeenCalled();
    });

    /*
     * An email nobody can classify is recorded as NEW, because the column
     * cannot be null. Its IGNORED status and its reason carry the meaning.
     */
    it("records an unclassifiable email with its reason", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({ subject: "Fwd: lunch" }),
      ]);

      await service.scan();

      expect(importedEmailService.recordIgnored).toHaveBeenCalledWith(
        expect.anything(),
        ImportType.NEW,
        "NO_RECOGNISED_PREFIX",
      );
    });

    it("leaves an ignored message unread, so nothing is hidden", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({ subject: "Fwd: lunch" }),
      ]);

      await service.scan();

      expect(session.markSeen).not.toHaveBeenCalled();
    });
  });

  describe("an email an earlier scan already handled", () => {
    it("is skipped without downloading or importing", async () => {
      importedEmailService.findByMessageId.mockResolvedValue({
        id: IMPORTED_EMAIL_ID,
        processingStatus: EmailProcessingStatus.PROCESSED,
      });

      const result = await service.scan();

      expect(session.downloadAttachment).not.toHaveBeenCalled();
      expect(pdfTripImporter.import).not.toHaveBeenCalled();
      expect(result).toMatchObject({ scanned: 1, alreadyProcessed: 1 });
    });

    it("does not write a second ImportedEmail row", async () => {
      importedEmailService.findByMessageId.mockResolvedValue({
        id: IMPORTED_EMAIL_ID,
        processingStatus: EmailProcessingStatus.FAILED,
      });

      await service.scan();

      expect(importedEmailService.startProcessing).not.toHaveBeenCalled();
    });
  });

  describe("attachments", () => {
    it("refuses an email with no PDF", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({ attachments: [] }),
      ]);

      const result = await service.scan();

      expect(importedEmailService.markFailed).toHaveBeenCalledWith(
        IMPORTED_EMAIL_ID,
      );
      expect(result).toMatchObject({ failed: 1, imported: 0 });
    });

    /**
     * Two PDFs are refused whole. PdfDocument links to at most one email, so
     * the second could not be recorded, and choosing between them would
     * silently drop a real transport order.
     */
    it("refuses an email with two PDFs without importing either", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({
          attachments: [
            pdfAttachment({ part: "2", filename: "first.pdf" }),
            pdfAttachment({ part: "3", filename: "second.pdf" }),
          ],
        }),
      ]);

      const result = await service.scan();

      expect(pdfTripImporter.import).not.toHaveBeenCalled();
      expect(result).toMatchObject({ failed: 1 });
    });

    it("reports the attachment-count failure with IMAP_004", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({ attachments: [] }),
      ]);

      await service.scan();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ errorCode: ImapErrorCode.NO_PDF_ATTACHMENT }),
      );
    });

    it("fails the email when the download itself fails", async () => {
      session.downloadAttachment.mockRejectedValue(new Error("stream closed"));

      const result = await service.scan();

      expect(importedEmailService.markFailed).toHaveBeenCalled();
      expect(session.markSeen).not.toHaveBeenCalled();
      expect(result).toMatchObject({ failed: 1 });
    });
  });

  describe("import failures", () => {
    it("fails the email and leaves it unread when the terminal is unknown", async () => {
      pdfTripImporter.import.mockRejectedValue(
        new UnknownTerminalException("PSA Quay 869", "ANRDUB2602247"),
      );

      const result = await service.scan();

      expect(importedEmailService.markFailed).toHaveBeenCalledWith(
        IMPORTED_EMAIL_ID,
      );
      expect(session.markSeen).not.toHaveBeenCalled();
      expect(result).toMatchObject({ failed: 1 });
    });

    it("logs the stable import error code", async () => {
      pdfTripImporter.import.mockRejectedValue(
        new UnknownTerminalException("PSA Quay 869", "ANRDUB2602247"),
      );

      await service.scan();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ errorCode: "IMPORT_UNKNOWN_TERMINAL" }),
      );
    });

    /**
     * Not a failure: the Trips already exist, which is exactly what should
     * happen when the same order arrives twice. Leaving it FAILED would put a
     * permanent error in the record for a system working correctly.
     */
    it("treats a duplicate booking as already imported", async () => {
      pdfTripImporter.import.mockRejectedValue(
        new DuplicateBookingNumberException("ANRDUB2602247", "trip-1"),
      );

      const result = await service.scan();

      expect(importedEmailService.markAlreadyImported).toHaveBeenCalledWith(
        IMPORTED_EMAIL_ID,
      );
      expect(importedEmailService.markFailed).not.toHaveBeenCalled();
      expect(result).toMatchObject({ alreadyProcessed: 1, failed: 0 });
    });

    it("continues to the next email after one fails", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({ messageId: "<broken@carrier.test>" }),
        mailboxMessage({ messageId: "<good@carrier.test>", uid: 102 }),
      ]);
      pdfTripImporter.import
        .mockRejectedValueOnce(new Error("parser rejected"))
        .mockResolvedValueOnce({
          trips: [{ id: "trip-2" }],
          combination: false,
          cancellations: [],
          revisions: [],
          costConfirmations: [],
        });

      const result = await service.scan();

      expect(result).toMatchObject({ scanned: 2, failed: 1, imported: 1 });
    });
  });

  describe("connection failures", () => {
    it.each([
      ["authentication", ImapErrorCode.AUTHENTICATION_FAILED],
      ["connection", ImapErrorCode.CONNECTION_FAILED],
      ["mailbox access", ImapErrorCode.MAILBOX_ACCESS_FAILED],
    ])("abort the whole scan on a %s failure", async (_case, code) => {
      mailboxClient.withMailbox.mockRejectedValue(
        new ImapConnectionException(code, "mail.carrier.test", "refused"),
      );

      await expect(service.scan()).rejects.toBeInstanceOf(
        ImapConnectionException,
      );
    });

    it("marks nothing as processed when the mailbox cannot be opened", async () => {
      mailboxClient.withMailbox.mockRejectedValue(
        new ImapConnectionException(
          ImapErrorCode.MAILBOX_ACCESS_FAILED,
          "mail.carrier.test",
          "no such folder",
        ),
      );

      await expect(service.scan()).rejects.toThrow();

      expect(importedEmailService.markProcessed).not.toHaveBeenCalled();
      expect(importedEmailService.startProcessing).not.toHaveBeenCalled();
    });

    it("does not block later scans after a connection failure", async () => {
      mailboxClient.withMailbox.mockRejectedValueOnce(
        new ImapConnectionException(
          ImapErrorCode.CONNECTION_FAILED,
          "mail.carrier.test",
          "timeout",
        ),
      );

      await expect(service.scan()).rejects.toThrow();

      await expect(service.scan()).resolves.toMatchObject({
        scanAlreadyRunning: false,
      });
    });
  });

  describe("overlapping scans", () => {
    it("does not start a second scan while one is running", async () => {
      let release: () => void = () => undefined;
      mailboxClient.withMailbox.mockImplementation(
        () =>
          new Promise<never>((resolve) => (release = resolve as () => void)),
      );

      const first = service.scan();
      const second = await service.scan();

      expect(second.scanAlreadyRunning).toBe(true);
      expect(mailboxClient.withMailbox).toHaveBeenCalledTimes(1);

      release();
      await first;
    });

    it("reports nothing scanned for the rejected scan", async () => {
      let release: () => void = () => undefined;
      mailboxClient.withMailbox.mockImplementation(
        () =>
          new Promise<never>((resolve) => (release = resolve as () => void)),
      );

      const first = service.scan();
      const second = await service.scan();

      expect(second).toMatchObject({ scanned: 0, imported: 0, failed: 0 });

      release();
      await first;
    });
  });

  describe("when mailbox ingestion is disabled", () => {
    beforeEach(() => {
      const configService = {
        get: jest.fn(() => false),
        getOrThrow: jest.fn(() => "NEW:"),
      };

      service = new ImapScanService(
        mailboxClient as unknown as ImapMailboxClient,
        importedEmailService as unknown as ImportedEmailService,
        pdfTripImporter as unknown as PdfTripImporter,
        configService as unknown as ConfigService,
        logger as unknown as AppLoggerService,
      );
    });

    /**
     * Reporting this as a mailbox failure would send an operator to check a
     * server when the real answer is a feature flag.
     */
    it("refuses with a reason of its own rather than a connection error", async () => {
      await expect(service.scan()).rejects.toBeInstanceOf(
        ImapDisabledException,
      );
    });

    it("contacts nothing", async () => {
      await expect(service.scan()).rejects.toThrow();

      expect(mailboxClient.withMailbox).not.toHaveBeenCalled();
    });
  });

  describe("counters", () => {
    it("accounts for every scanned message exactly once", async () => {
      session.findCandidates.mockResolvedValue([
        mailboxMessage({ messageId: "<a@carrier.test>" }),
        mailboxMessage({ messageId: "<b@carrier.test>", subject: "Fwd: x" }),
        mailboxMessage({ messageId: "<c@carrier.test>", attachments: [] }),
      ]);

      const result = await service.scan();

      expect(
        result.imported +
          result.ignored +
          result.failed +
          result.alreadyProcessed,
      ).toBe(result.scanned);
    });
  });

  describe("logging", () => {
    it("records identifiers, never message or attachment content", async () => {
      await service.scan();

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).toContain("<order-1@carrier.test>");
      expect(logged).not.toContain("%PDF");
      expect(logged).not.toContain("Uint8Array");
    });

    it("never logs a password or a body", async () => {
      await service.scan();

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]).toLowerCase();

      expect(logged).not.toContain("password");
      expect(logged).not.toContain("body");
    });
  });
});
