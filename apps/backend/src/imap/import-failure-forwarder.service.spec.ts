import { ConfigService } from "@nestjs/config";
import {
  EmailProcessingStatus,
  ImportType,
  ImportedEmail,
} from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { OutgoingMessage, SmtpMailClient } from "../mail/smtp-mail.client";
import { UnreadablePdfException } from "../pdf-import/exceptions/pdf-import.exceptions";
import { PdfTripImporter } from "../pdf-import/pdf-trip-importer.service";
import {
  AttachmentDownloadException,
  UnexpectedAttachmentCountException,
} from "./exceptions/imap.exceptions";
import {
  ImapMailboxClient,
  ImapMailboxSession,
  MailboxMessage,
} from "./imap-mailbox.client";
import { ImapScanService } from "./imap-scan.service";
import {
  FORWARD_SUBJECT_PREFIX,
  ImportFailureForwarder,
  composeFailureForward,
} from "./import-failure-forwarder.service";
import { ImportedEmailRepository } from "./imported-email.repository";
import { ImportedEmailService } from "./imported-email.service";
import { selectMessage } from "./message-selection";

/**
 * Forwarding the original email of a FAILED mailbox import to a person.
 *
 * ── WHAT IS REAL HERE ───────────────────────────────────────────────────────
 * The forwarder, the composition of the forward, the scan and its retry
 * lifecycle (`decideRescan`, `reopenForRetry`, `markFailed`), the email record
 * service and the subject selection. Replaced: the mail server (a recording
 * double — no message leaves the test), the mailbox (plain data), the email
 * table (an in-memory store that PERSISTS between scans, which is what makes a
 * retry a retry) and the importer, whose only job here is to fail or succeed.
 *
 * The real importer, a real IMAP server, a real SMTP server and a real database
 * are exercised together by the runtime verification, not here.
 */

const TRUSTED_SENDER = "orders@carrier.test";
const FORWARD_TO = "info@iytechsolutions.be";
const SUBJECT = "NEW: [DEL] Quay 869 - COULOGNE";

/** The raw message as an IMAP server would hand it over. */
const RAW_SOURCE = Buffer.from(
  [
    "From: orders@carrier.test",
    "To: import@trano.test",
    `Subject: ${SUBJECT}`,
    "Message-ID: <1385766@carrier.test>",
    "",
    "Please find the order attached.",
  ].join("\r\n"),
);

function mailboxMessage(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return {
    uid: 101,
    messageId: "<1385766@carrier.test>",
    senderEmail: TRUSTED_SENDER,
    subject: SUBJECT,
    receivedAt: new Date("2026-10-01T06:00:00.000Z"),
    attachments: [
      {
        part: "2",
        filename: "transportorder1385766.pdf",
        contentType: "application/pdf",
        sizeBytes: 59423,
      },
    ],
    ...overrides,
  };
}

function silentLogger() {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function configWith(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    ENABLE_IMAP: true,
    ENABLE_IMPORT_FAILURE_FORWARD: true,
    IMPORT_FAILURE_FORWARD_TO: FORWARD_TO,
    IMAP_TRUSTED_SENDERS: [TRUSTED_SENDER],
    MAIL_SUBJECT_NEW: "NEW:",
    ...overrides,
  };

  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) {
        throw new Error(`missing ${key}`);
      }

      return values[key];
    }),
  } as unknown as ConfigService;
}

/**
 * The `imported_email` table, in memory — and it REMEMBERS.
 *
 * One row per Message-ID, exactly as the unique column enforces, so the second
 * scan of a failed email finds the row the first scan left behind.
 */
function inMemoryEmailTable() {
  const rows = new Map<string, ImportedEmail>();
  let sequence = 0;

  const byId = (id: string) =>
    [...rows.values()].find((row) => row.id === id) as ImportedEmail;

  const update = (id: string, data: Partial<ImportedEmail>) => {
    const row = { ...byId(id), ...data, updatedAt: new Date() };
    rows.set(row.messageId, row);

    return Promise.resolve(row);
  };

  const repository = {
    findByMessageId: jest.fn((messageId: string) =>
      Promise.resolve(rows.get(messageId) ?? null),
    ),
    create: jest.fn((data: Partial<ImportedEmail>) => {
      sequence += 1;
      const row = {
        id: `email-${sequence}`,
        processedAt: null,
        failureForwardedAt: null,
        body: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as ImportedEmail;
      rows.set(row.messageId, row);

      return Promise.resolve(row);
    }),
    updateStatus: jest.fn(
      (id: string, processingStatus: EmailProcessingStatus, processedAt: Date | null) =>
        update(id, { processingStatus, processedAt }),
    ),
    markFailureForwarded: jest.fn((id: string, failureForwardedAt: Date) =>
      update(id, { failureForwardedAt }),
    ),
  };

  return { rows, repository };
}

/** A mail server that records what it was asked to send. */
function recordingMailer() {
  const sent: OutgoingMessage[] = [];

  return {
    sent,
    mailer: {
      send: jest.fn((message: OutgoingMessage) => {
        sent.push(message);

        return Promise.resolve();
      }),
    },
  };
}

function sessionServing(messages: MailboxMessage[]) {
  return {
    findCandidates: jest.fn().mockResolvedValue(messages),
    downloadAttachment: jest.fn((_message: MailboxMessage, attachment: { filename: string }) =>
      Promise.resolve({
        filename: attachment.filename,
        content: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      }),
    ),
    downloadSource: jest.fn().mockResolvedValue(RAW_SOURCE),
    markSeen: jest.fn().mockResolvedValue(undefined),
  };
}

/** The whole mailbox side, with the importer deciding the outcome per file. */
function buildScan(options: {
  session: ReturnType<typeof sessionServing>;
  importOutcome: (filename: string) => Promise<unknown>;
  mailer: { send: jest.Mock };
  config?: ConfigService;
}) {
  const logger = silentLogger() as unknown as AppLoggerService;
  const config = options.config ?? configWith();
  const table = inMemoryEmailTable();
  const importedEmailService = new ImportedEmailService(
    table.repository as unknown as ImportedEmailRepository,
    logger,
  );
  const forwarder = new ImportFailureForwarder(
    options.mailer as unknown as SmtpMailClient,
    importedEmailService,
    config,
    logger,
  );
  const importer = {
    import: jest.fn((_content: Uint8Array, filename: string) =>
      options.importOutcome(filename),
    ),
  };

  const service = new ImapScanService(
    {
      withMailbox: (work: (session: ImapMailboxSession) => Promise<unknown>) =>
        work(options.session as unknown as ImapMailboxSession),
    } as unknown as ImapMailboxClient,
    importedEmailService,
    importer as unknown as PdfTripImporter,
    config,
    forwarder,
    logger,
  );

  return { service, table, importer };
}

const IMPORTED = {
  trips: [{ id: "trip-1" }],
  combination: false,
  cancellations: [],
  revisions: [],
  costConfirmations: [],
};

function parseFailure(filename: string) {
  return Promise.reject(
    new UnreadablePdfException(
      filename,
      "No readable city line was found under 'DELIVERY 1:'.",
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("the forward itself", () => {
  const forward = composeFailureForward({
    to: FORWARD_TO,
    message: mailboxMessage(),
    failure: {
      error: new UnreadablePdfException(
        "transportorder1385766.pdf",
        "No readable city line was found under 'DELIVERY 1:'.",
      ),
      errorCode: "PDF_IMPORT_UNREADABLE_PDF",
    },
    failedAt: new Date("2026-10-01T06:05:00.000Z"),
    source: RAW_SOURCE,
  });

  it("goes to the configured recipient", () => {
    expect(forward.to).toBe(FORWARD_TO);
  });

  it("carries a recognisable subject built from the original", () => {
    expect(forward.subject).toBe(`[TRANO IMPORT ERROR] ${SUBJECT}`);
  });

  it("names the attachment, the error and the moment", () => {
    expect(forward.text).toContain("transportorder1385766.pdf");
    expect(forward.text).toContain("[PDF_IMPORT_UNREADABLE_PDF]");
    expect(forward.text).toContain("No readable city line");
    expect(forward.text).toContain("2026-10-01T06:05:00.000Z (UTC)");
  });

  it("names the original sender in the text, never in From", () => {
    expect(forward.text).toContain(TRUSTED_SENDER);
    expect(forward).not.toHaveProperty("from");
  });

  /** The whole original, byte for byte, as an attached message. */
  it("attaches the original email unchanged", () => {
    expect(forward.attachments).toEqual([
      {
        filename: "origineel-bericht.eml",
        contentType: "message/rfc822",
        content: RAW_SOURCE,
      },
    ]);
  });

  /** One email carrying two PDFs is ONE failure, and both are named. */
  it("names every PDF of a mail that carried several", () => {
    const twoPdfs = composeFailureForward({
      to: FORWARD_TO,
      message: mailboxMessage({
        attachments: [
          { part: "2", filename: "transportorder1385766.pdf", contentType: "application/pdf", sizeBytes: 1 },
          { part: "3", filename: "transportorder1385767.pdf", contentType: "application/pdf", sizeBytes: 1 },
        ],
      }),
      failure: {
        error: new UnexpectedAttachmentCountException("<x@carrier.test>", 2),
        errorCode: "IMAP_NO_PDF_ATTACHMENT",
      },
      failedAt: new Date(),
      source: RAW_SOURCE,
    });

    expect(twoPdfs.text).toContain(
      "transportorder1385766.pdf, transportorder1385767.pdf",
    );
    expect(twoPdfs.attachments).toHaveLength(1);
  });
});

/**
 * TEST 9 — a forward can never be imported.
 *
 * Even in the worst case: the forward lands in the scanned mailbox and its
 * sender is on the allowlist. The subject decides, and `[TRANO IMPORT ERROR]`
 * is no instruction the scan carries out — whatever the original said.
 */
describe("a forward that reaches the scanned mailbox", () => {
  it.each([
    "NEW: [DEL] Quay 869 - COULOGNE",
    "UPDATE: [DEL] Quay 869 - COULOGNE",
    "CANCEL: [DEL] Quay 869 - COULOGNE",
    "COST CONFIRMATION NR 4208847",
  ])("is refused, even from a trusted sender (%s)", (original) => {
    const selection = selectMessage(
      {
        senderEmail: TRUSTED_SENDER,
        subject: `${FORWARD_SUBJECT_PREFIX} ${original}`,
      },
      { trustedSenders: [TRUSTED_SENDER], newSubjectPrefix: "NEW:" },
    );

    expect(selection).toMatchObject({
      accepted: false,
      outcome: "NO_RECOGNISED_PREFIX",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("forwarding a failed mailbox import", () => {
  /** TEST 1 — EMAIL + parser failure. */
  it("forwards the original email once when its import fails", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([mailboxMessage()]);
    const { service, table } = buildScan({ session, mailer, importOutcome: parseFailure });

    const result = await service.scan();

    expect(result).toMatchObject({ failed: 1, imported: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: FORWARD_TO,
      subject: `[TRANO IMPORT ERROR] ${SUBJECT}`,
    });
    expect(sent[0].attachments[0].content).toBe(RAW_SOURCE);

    const row = table.rows.get("<1385766@carrier.test>");
    expect(row?.processingStatus).toBe(EmailProcessingStatus.FAILED);
    expect(row?.failureForwardedAt).toBeInstanceOf(Date);
    // Still unread, still retried: forwarding told somebody, nothing more.
    expect(session.markSeen).not.toHaveBeenCalled();
  });

  /** TEST 2 — EMAIL + success. */
  it("forwards nothing when the import succeeds", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([mailboxMessage()]);
    const { service, table } = buildScan({
      session,
      mailer,
      importOutcome: () => Promise.resolve(IMPORTED),
    });

    await service.scan();

    expect(sent).toHaveLength(0);
    expect(session.downloadSource).not.toHaveBeenCalled();
    expect(table.rows.get("<1385766@carrier.test>")?.processingStatus).toBe(
      EmailProcessingStatus.PROCESSED,
    );
  });

  /**
   * TEST 5 — the same failure, seen again.
   *
   * A FAILED email is retried on every scan for the rest of the day. Three
   * scans, three failed attempts, ONE forward.
   */
  it("does not forward the same failed email again on later scans", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([mailboxMessage()]);
    const { service, table, importer } = buildScan({
      session,
      mailer,
      importOutcome: parseFailure,
    });

    await service.scan();
    await service.scan();
    await service.scan();

    // Genuinely retried each time — the import was attempted three times…
    expect(importer.import).toHaveBeenCalledTimes(3);
    // …and still exactly one row and one forward.
    expect(table.rows.size).toBe(1);
    expect(sent).toHaveLength(1);
    expect(session.downloadSource).toHaveBeenCalledTimes(1);
  });

  /** A retry that SUCCEEDS imports normally and is not forwarded. */
  it("imports normally when a later retry succeeds", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([mailboxMessage()]);
    let attempt = 0;
    const { service, table } = buildScan({
      session,
      mailer,
      importOutcome: (filename) => {
        attempt += 1;

        return attempt === 1 ? parseFailure(filename) : Promise.resolve(IMPORTED);
      },
    });

    await service.scan();
    await service.scan();

    const row = table.rows.get("<1385766@carrier.test>");
    expect(row?.processingStatus).toBe(EmailProcessingStatus.PROCESSED);
    expect(sent).toHaveLength(1);
    expect(session.markSeen).toHaveBeenCalledTimes(1);
  });

  /**
   * TEST 6 — one mail succeeds, another fails, in the same scan.
   *
   * Each email is its own unit of work: the success stays imported and read,
   * and only the failure is forwarded.
   */
  it("forwards only the failed one of two emails", async () => {
    const { sent, mailer } = recordingMailer();
    const failing = mailboxMessage();
    const working = mailboxMessage({
      uid: 102,
      messageId: "<1385767@carrier.test>",
      attachments: [
        { part: "2", filename: "transportorder1385767.pdf", contentType: "application/pdf", sizeBytes: 58489 },
      ],
    });
    const session = sessionServing([failing, working]);
    const { service, table } = buildScan({
      session,
      mailer,
      importOutcome: (filename) =>
        filename === "transportorder1385766.pdf"
          ? parseFailure(filename)
          : Promise.resolve(IMPORTED),
    });

    const result = await service.scan();

    expect(result).toMatchObject({ imported: 1, failed: 1 });
    expect(table.rows.get("<1385767@carrier.test>")?.processingStatus).toBe(
      EmailProcessingStatus.PROCESSED,
    );
    expect(session.markSeen).toHaveBeenCalledWith(working);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("transportorder1385766.pdf");
    expect(sent[0].text).not.toContain("transportorder1385767.pdf");
  });

  /**
   * TEST 7 — one mail carrying two PDFs.
   *
   * The scan refuses such a mail as a whole (exactly one PDF per mail), so it
   * is ONE failure: one forward, naming both files, with both inside the
   * attached original.
   */
  it("forwards a mail with two PDFs exactly once", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([
      mailboxMessage({
        attachments: [
          { part: "2", filename: "transportorder1385766.pdf", contentType: "application/pdf", sizeBytes: 1 },
          { part: "3", filename: "transportorder1385767.pdf", contentType: "application/pdf", sizeBytes: 1 },
        ],
      }),
    ]);
    const { service } = buildScan({
      session,
      mailer,
      importOutcome: () => Promise.resolve(IMPORTED),
    });

    await service.scan();
    await service.scan();

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(
      "transportorder1385766.pdf, transportorder1385767.pdf",
    );
  });

  /**
   * TEST 8 — the mail server is down.
   *
   * The import failure is recorded exactly as before, nothing throws, and the
   * forward is NOT marked sent — so the next scan, which retries the email
   * anyway, tries the forward again.
   */
  it("keeps the import failure, and retries the forward, when SMTP fails", async () => {
    const sent: OutgoingMessage[] = [];
    let smtpUp = false;
    const mailer = {
      send: jest.fn((message: OutgoingMessage) => {
        if (!smtpUp) {
          return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:587"));
        }

        sent.push(message);

        return Promise.resolve();
      }),
    };
    const session = sessionServing([mailboxMessage()]);
    const { service, table } = buildScan({ session, mailer, importOutcome: parseFailure });

    const first = await service.scan();

    const row = table.rows.get("<1385766@carrier.test>");
    expect(first).toMatchObject({ failed: 1 });
    expect(row?.processingStatus).toBe(EmailProcessingStatus.FAILED);
    expect(row?.failureForwardedAt).toBeNull();

    smtpUp = true;
    await service.scan();
    await service.scan();

    expect(sent).toHaveLength(1);
    expect(table.rows.get("<1385766@carrier.test>")?.failureForwardedAt).toBeInstanceOf(Date);
  });

  /** An attachment the server failed to hand over is retried, not reported. */
  it("does not forward a failed attachment download", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([mailboxMessage()]);
    session.downloadAttachment.mockRejectedValue(
      new AttachmentDownloadException("<1385766@carrier.test>", "transportorder1385766.pdf", "timeout"),
    );
    const { service, table } = buildScan({
      session,
      mailer,
      importOutcome: () => Promise.resolve(IMPORTED),
    });

    await service.scan();

    expect(table.rows.get("<1385766@carrier.test>")?.processingStatus).toBe(
      EmailProcessingStatus.FAILED,
    );
    expect(sent).toHaveLength(0);
  });

  /** An email that was never accepted is not a failed import. */
  it("does not forward an email from an untrusted sender", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([
      mailboxMessage({ senderEmail: "someone@elsewhere.test" }),
    ]);
    const { service, importer } = buildScan({ session, mailer, importOutcome: parseFailure });

    await service.scan();

    expect(importer.import).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  /** The switch is off by default, and off means nothing is sent. */
  it("sends nothing while the feature is switched off", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([mailboxMessage()]);
    const { service, table } = buildScan({
      session,
      mailer,
      importOutcome: parseFailure,
      config: configWith({ ENABLE_IMPORT_FAILURE_FORWARD: false }),
    });

    await service.scan();

    expect(table.rows.get("<1385766@carrier.test>")?.processingStatus).toBe(
      EmailProcessingStatus.FAILED,
    );
    expect(sent).toHaveLength(0);
    expect(session.downloadSource).not.toHaveBeenCalled();
  });

  /** A failure to fetch the original is logged, never thrown. */
  it("survives an original that cannot be fetched, and tries again later", async () => {
    const { sent, mailer } = recordingMailer();
    const session = sessionServing([mailboxMessage()]);
    session.downloadSource
      .mockRejectedValueOnce(new Error("server closed the connection"))
      .mockResolvedValue(RAW_SOURCE);
    const { service, table } = buildScan({ session, mailer, importOutcome: parseFailure });

    await service.scan();
    expect(sent).toHaveLength(0);
    expect(table.rows.get("<1385766@carrier.test>")?.failureForwardedAt).toBeNull();

    await service.scan();
    expect(sent).toHaveLength(1);
  });

  /** The import type is recorded as before: forwarding changes no record. */
  it("leaves the email's own record exactly as the scan wrote it", async () => {
    const { mailer } = recordingMailer();
    const session = sessionServing([mailboxMessage()]);
    const { service, table } = buildScan({ session, mailer, importOutcome: parseFailure });

    await service.scan();

    expect(table.rows.get("<1385766@carrier.test>")).toMatchObject({
      importType: ImportType.NEW,
      processingStatus: EmailProcessingStatus.FAILED,
      processedAt: null,
    });
  });
});
