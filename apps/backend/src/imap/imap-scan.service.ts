import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ImportSource, ImportType } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { DuplicateBookingNumberException } from "../trips/exceptions/trip.exceptions";
import { PdfImportException } from "../pdf-import/exceptions/pdf-import.exceptions";
import {
  PdfImportResult,
  PdfTripImporter,
} from "../pdf-import/pdf-trip-importer.service";
import { ImapScanResultDto } from "./dto/imap-scan-result.dto";
import {
  ImapDisabledException,
  ImapException,
  UnexpectedAttachmentCountException,
} from "./exceptions/imap.exceptions";
import {
  ImapMailboxClient,
  ImapMailboxSession,
  MailboxMessage,
} from "./imap-mailbox.client";
import { ImportedEmailService } from "./imported-email.service";
import { MessageAction, selectMessage } from "./message-selection";

/** A supported email carries exactly one, per `businessrules.md` §1. */
const EXPECTED_PDF_ATTACHMENTS = 1;

/**
 * Scans the mailbox and turns transport-order emails into Trips.
 *
 * This service owns the flow and nothing else. It does not speak IMAP — that is
 * `ImapMailboxClient` — and it does not know how a PDF becomes a Trip — that is
 * `PdfTripImporter`, unchanged. What lives here is the sequence, and the
 * decision about what each failure means.
 *
 * The blast radius of a failure is the whole design. A connection, credential
 * or folder problem aborts the scan, because without a mailbox there is nothing
 * to iterate and marking anything processed would be a lie. Every other failure
 * belongs to one email: it is recorded, the email is left unread so the next
 * scan retries it, and the loop continues. One malformed attachment must never
 * stop the orders behind it.
 *
 * There is no retry framework. The next scan IS the retry.
 */
@Injectable()
export class ImapScanService {
  /**
   * Guards against two scans at once inside this process.
   *
   * A plain boolean is enough: the scheduler and the endpoint run on the same
   * event loop, so there is no interleaving between the check and the set. This
   * is one backend process with one mailbox — a distributed lock would be
   * machinery for a problem that does not exist here.
   */
  private scanning = false;

  constructor(
    private readonly mailboxClient: ImapMailboxClient,
    private readonly importedEmailService: ImportedEmailService,
    private readonly pdfTripImporter: PdfTripImporter,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(ImapScanService.name);
  }

  /**
   * Runs one scan, unless one is already running.
   *
   * A rejected overlapping scan is reported, not thrown: a scheduled tick
   * arriving while the previous one is still working is normal operation, not
   * an error anybody needs to act on.
   */
  async scan(): Promise<ImapScanResultDto> {
    // Checked before the guard and before any connection: asking a disabled
    // feature to run is a configuration mistake, and reporting it as a mailbox
    // failure would send an operator to check the wrong thing entirely.
    if (this.configService.get<boolean>("ENABLE_IMAP") !== true) {
      throw new ImapDisabledException();
    }

    if (this.scanning) {
      this.logger.warn("Scan skipped: a scan is already running");

      return emptyResult({ scanAlreadyRunning: true });
    }

    this.scanning = true;

    try {
      return await this.runScan();
    } finally {
      // Released even when the scan aborts, or one connection failure would
      // block every future scan until the process restarts.
      this.scanning = false;
    }
  }

  private async runScan(): Promise<ImapScanResultDto> {
    const started = Date.now();

    const result = await this.mailboxClient.withMailbox(async (session) => {
      const messages = await session.findCandidates();

      this.logger.log("Mailbox scanned", { candidateCount: messages.length });

      const counters = emptyResult();

      for (const message of messages) {
        await this.processMessage(session, message, counters);
      }

      return counters;
    });

    this.logger.log("Mailbox scan finished", {
      ...result,
      durationMs: Date.now() - started,
    });

    return result;
  }

  /**
   * Handles one email from selection to outcome.
   *
   * Every branch updates exactly one counter, so the summary a caller receives
   * always accounts for every message the mailbox offered.
   */
  private async processMessage(
    session: ImapMailboxSession,
    message: MailboxMessage,
    counters: ImapScanResultDto,
  ): Promise<void> {
    counters.scanned += 1;

    // Asked before anything is downloaded: an email seen by an earlier scan
    // must not cost a second attachment fetch.
    const known = await this.importedEmailService.findByMessageId(
      message.messageId,
    );

    if (known) {
      counters.alreadyProcessed += 1;
      this.logger.log("Email already known, skipped", {
        messageId: message.messageId,
        previousStatus: known.processingStatus,
      });

      return;
    }

    const selection = selectMessage(message, {
      trustedSenders: this.configService.getOrThrow<string[]>(
        "IMAP_TRUSTED_SENDERS",
      ),
      newSubjectPrefix:
        this.configService.getOrThrow<string>("MAIL_SUBJECT_NEW"),
    });

    if (!selection.accepted) {
      await this.importedEmailService.recordIgnored(
        message,
        importTypeFor(selection.action),
        selection.outcome,
      );
      counters.ignored += 1;

      return;
    }

    await this.importMessage(
      session,
      message,
      selection.action ?? MessageAction.NEW,
      counters,
    );
  }

  /**
   * Carries out what the one PDF an accepted email carries asks for.
   *
   * The ImportedEmail row is opened first so that its id can be recorded on the
   * PdfDocument as provenance, and so a scan that dies mid-import leaves a row
   * in PROCESSING rather than no trace at all.
   *
   * All three actions share this lifecycle exactly: PROCESSING, then PROCESSED
   * and read on success, then FAILED and left UNREAD on any failure. A message
   * that failed must stay unread — an unread message is the only thing that
   * will offer the instruction again.
   */
  private async importMessage(
    session: ImapMailboxSession,
    message: MailboxMessage,
    action: MessageAction,
    counters: ImapScanResultDto,
  ): Promise<void> {
    const importedEmail =
      await this.importedEmailService.startProcessing(message);

    try {
      const attachment = this.requireSinglePdf(message);
      const downloaded = await session.downloadAttachment(message, attachment);

      const outcome = await this.carryOut(action, downloaded, importedEmail.id);

      await this.importedEmailService.markProcessed(importedEmail.id);
      // Only now: a message marked read before the Trips exist would never be
      // offered again, and the order would be silently lost.
      await session.markSeen(message);

      counters.imported += 1;

      this.logger.log("Email processed", {
        messageId: message.messageId,
        action,
        filename: downloaded.filename,
        byteCount: downloaded.content.byteLength,
        tripIds: outcome.trips.map((trip) => trip.id),
        combination: outcome.combination,
        cancellations: outcome.cancellations.map((entry) => entry.outcome),
        revisedTripIds: outcome.revisions.map((entry) => entry.tripId),
      });
    } catch (error: unknown) {
      await this.recordFailure(message, importedEmail.id, error, counters);
    }
  }

  /**
   * The one place the subject's instruction becomes an operation.
   *
   * Each action maps to exactly one importer method, and the importer owns what
   * each of them means — including the rule that a document stamped CANCELLED
   * is cancelled whichever instruction carried it. Nothing about cancelling or
   * revising is decided here.
   */
  private carryOut(
    action: MessageAction,
    downloaded: { filename: string; content: Uint8Array },
    importedEmailId: string,
  ): Promise<PdfImportResult> {
    if (action === MessageAction.CANCEL) {
      return this.pdfTripImporter.cancel(
        downloaded.content,
        downloaded.filename,
      );
    }

    if (action === MessageAction.UPDATE) {
      return this.pdfTripImporter.revise(
        downloaded.content,
        downloaded.filename,
      );
    }

    // Only a NEW order stores its document: a PdfDocument records what a Trip
    // was created from, and neither of the other two creates one.
    return this.pdfTripImporter.import(
      downloaded.content,
      downloaded.filename,
      {
        provenance: {
          importSource: ImportSource.EMAIL,
          importedEmailId,
        },
      },
    );
  }

  /**
   * Turns one email's failure into a recorded outcome.
   *
   * A duplicate booking number is singled out because it is not a failure at
   * all: it means these Trips already exist, which is exactly what should
   * happen when the same order arrives twice. Recording it as FAILED would put
   * a permanent error in the log for a system working correctly.
   */
  private async recordFailure(
    message: MailboxMessage,
    importedEmailId: string,
    error: unknown,
    counters: ImapScanResultDto,
  ): Promise<void> {
    if (error instanceof DuplicateBookingNumberException) {
      await this.importedEmailService.markAlreadyImported(importedEmailId);
      counters.alreadyProcessed += 1;

      this.logger.log("Email skipped: its Trips already exist", {
        messageId: message.messageId,
      });

      return;
    }

    await this.importedEmailService.markFailed(importedEmailId);
    counters.failed += 1;

    // Left unread deliberately: the next scan retries it.
    this.logger.warn("Email import failed", {
      messageId: message.messageId,
      errorCode: errorCodeOf(error),
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * The single PDF, or a refusal.
   *
   * Two PDFs are refused rather than half-imported: `PdfDocument` links to at
   * most one email, so the second could not be recorded even if it were
   * imported, and picking one arbitrarily would silently drop a real order.
   */
  private requireSinglePdf(message: MailboxMessage) {
    if (message.attachments.length !== EXPECTED_PDF_ATTACHMENTS) {
      throw new UnexpectedAttachmentCountException(
        message.messageId,
        message.attachments.length,
      );
    }

    return message.attachments[0];
  }
}

/**
 * The stored type of an email, from the action its subject asked for.
 *
 * An ignored email has no action — nobody could tell what it asked for — and is
 * recorded as NEW because the column cannot be null. Its IGNORED status and the
 * logged reason are what carry the meaning there.
 */
function importTypeFor(action: MessageAction | null): ImportType {
  if (action === MessageAction.UPDATE) {
    return ImportType.UPDATE;
  }

  if (action === MessageAction.CANCEL) {
    return ImportType.CANCEL;
  }

  return ImportType.NEW;
}

/**
 * The stable code, when the failure carries one.
 *
 * Both domains this scan can fail in expose one — `IMAP_00n` from the mailbox,
 * `IMPORT_*` from the PDF pipeline — and that code is what makes a log line
 * searchable without knowing which layer produced it.
 */
function errorCodeOf(error: unknown): string | null {
  return error instanceof ImapException || error instanceof PdfImportException
    ? error.code
    : null;
}

function emptyResult(
  overrides: Partial<ImapScanResultDto> = {},
): ImapScanResultDto {
  return {
    scanned: 0,
    imported: 0,
    ignored: 0,
    failed: 0,
    alreadyProcessed: 0,
    scanAlreadyRunning: false,
    ...overrides,
  };
}
