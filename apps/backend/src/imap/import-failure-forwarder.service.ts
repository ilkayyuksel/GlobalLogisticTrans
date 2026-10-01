import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ImportedEmail } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { OutgoingMessage, SmtpMailClient } from "../mail/smtp-mail.client";
import { AttachmentDownloadException } from "./exceptions/imap.exceptions";
import { ImapMailboxSession, MailboxMessage } from "./imap-mailbox.client";
import { ImportedEmailService } from "./imported-email.service";

/**
 * The prefix every forward's subject carries.
 *
 * It is also what keeps a forward from ever being imported: `selectMessage`
 * accepts only a subject that STARTS with an instruction (`NEW:`, `UPDATE:`,
 * `CANCEL:`, `COST CONFIRMATION`), and this one starts with a bracket. Should a
 * forward ever land in the scanned mailbox, it is refused as an unrecognised
 * subject and recorded IGNORED — never mistaken for a customer's order.
 */
export const FORWARD_SUBJECT_PREFIX = "[TRANO IMPORT ERROR]";

/** The original email travels whole, as an attached message. */
const ORIGINAL_MESSAGE_FILENAME = "origineel-bericht.eml";
const ORIGINAL_MESSAGE_CONTENT_TYPE = "message/rfc822";

/** What went wrong, as the scan already describes it in its own log. */
export interface ImportFailure {
  readonly error: unknown;
  readonly errorCode: string | null;
}

/**
 * Sends the original email of a failed mailbox import to a person — once.
 *
 * ── WHY THIS LIVES IN THE MAILBOX MODULE ────────────────────────────────────
 * Only the mailbox scan calls it. A PDF uploaded through the Trano screen goes
 * straight to `PdfTripImporter` and never passes through `ImapScanService`, so
 * it can never be forwarded — not because a flag forbids it, but because the
 * code that forwards is not on that path. The person who uploaded the file is
 * looking at the error already.
 *
 * ── ONCE PER EMAIL ──────────────────────────────────────────────────────────
 * A failed email is retried on every scan for the rest of the day — every five
 * minutes. Without a record, one unreadable order would send a hundred alerts.
 * The record is `imported_email.failure_forwarded_at`, on the row that already
 * exists for exactly this email: set after the mail server accepted the
 * forward, never cleared. A later retry that fails again finds it set and
 * stays quiet; one that SUCCEEDS imports normally and never reaches this class.
 *
 * Written AFTER sending, deliberately. The other order — mark, then send — would
 * lose the alert altogether if the send failed after the mark. This order can at
 * worst send it twice, should the process die in the instant between the two;
 * a duplicate alert is the cheaper mistake.
 *
 * ── IT NEVER CHANGES WHAT HAPPENED TO THE IMPORT ────────────────────────────
 * The email is already FAILED and unread when this runs. A broken mail server
 * is logged and swallowed here, so it can neither hide that failure nor turn
 * into one: the import's own status is the record, and this is a notification
 * about it.
 */
@Injectable()
export class ImportFailureForwarder {
  constructor(
    private readonly mailer: SmtpMailClient,
    private readonly importedEmailService: ImportedEmailService,
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(ImportFailureForwarder.name);
  }

  async forwardOnce(
    session: ImapMailboxSession,
    message: MailboxMessage,
    importedEmail: ImportedEmail,
    failure: ImportFailure,
  ): Promise<void> {
    if (!this.configService.get<boolean>("ENABLE_IMPORT_FAILURE_FORWARD")) {
      return;
    }

    if (!isForwardableFailure(failure.error)) {
      return;
    }

    if (importedEmail.failureForwardedAt !== null) {
      this.logger.log("Failed email already forwarded, not sent again", {
        messageId: message.messageId,
        forwardedAt: importedEmail.failureForwardedAt.toISOString(),
      });

      return;
    }

    try {
      const source = await session.downloadSource(message);

      await this.mailer.send(
        composeFailureForward({
          to: this.configService.getOrThrow<string>("IMPORT_FAILURE_FORWARD_TO"),
          message,
          failure,
          failedAt: new Date(),
          source,
        }),
      );

      await this.importedEmailService.markFailureForwarded(importedEmail.id);

      this.logger.log("Failed email forwarded", {
        messageId: message.messageId,
        errorCode: failure.errorCode,
      });
    } catch (error: unknown) {
      /*
       * Logged, never rethrown. The record stays unset, so the next scan's
       * retry — which runs anyway — tries the forward again.
       */
      this.logger.warn("Failed email could not be forwarded", {
        messageId: message.messageId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Whether a failure is one a person must be told about.
 *
 * Every failure of an email Trano ACCEPTED counts — an unreadable PDF, an
 * order that cannot be imported, a cost confirmation matching no Trip, a mail
 * carrying no PDF or several — because none of them will fix itself, and the
 * scan's retry will meet the same document again tomorrow.
 *
 * Except one: an attachment the server listed and then failed to hand over.
 * That is the network between two servers, nothing was processed, and the next
 * scan simply downloads it again. Forwarding it would alert somebody about an
 * order that will very likely import five minutes later.
 */
export function isForwardableFailure(error: unknown): boolean {
  return !(error instanceof AttachmentDownloadException);
}

/**
 * The forward: a short technical note, and the original email attached whole.
 *
 * ── WHY ATTACHED AND NOT RETYPED ────────────────────────────────────────────
 * The original is the raw message as the server holds it, attached as
 * `message/rfc822` — the standard form of "forward as attachment". Every mail
 * client opens it as the email it was: its own headers, its body and its PDFs,
 * byte for byte. Copying the body into this message instead would mean parsing
 * and re-encoding somebody else's email, and every step of that is a way to
 * lose the very detail that explains why it failed.
 *
 * Sent from the system's own address. The original sender is named in the note
 * and preserved inside the attachment; putting them in From would be spoofing.
 */
export function composeFailureForward(input: {
  readonly to: string;
  readonly message: MailboxMessage;
  readonly failure: ImportFailure;
  readonly failedAt: Date;
  readonly source: Buffer;
}): OutgoingMessage {
  const { message, failure } = input;

  const attachments =
    message.attachments.length === 0
      ? "(geen PDF-bijlage)"
      : message.attachments.map((attachment) => attachment.filename).join(", ");

  const reason =
    failure.error instanceof Error ? failure.error.message : String(failure.error);

  const text = [
    "Trano kon een e-mail uit de importmailbox niet verwerken.",
    "De oorspronkelijke e-mail is ongewijzigd bijgevoegd, met alle originele bijlagen.",
    "",
    `Bijlage(n):   ${attachments}`,
    `Fout:         ${failure.errorCode ? `[${failure.errorCode}] ` : ""}${reason}`,
    `Tijdstip:     ${input.failedAt.toISOString()} (UTC)`,
    "",
    "Oorspronkelijke e-mail",
    `  Van:        ${message.senderEmail}`,
    `  Onderwerp:  ${message.subject}`,
    `  Ontvangen:  ${message.receivedAt.toISOString()} (UTC)`,
    `  Message-ID: ${message.messageId}`,
    "",
    "Deze melding wordt één keer per e-mail verstuurd. Trano probeert de import",
    "vandaag automatisch opnieuw; slaagt dat, dan wordt de rit gewoon aangemaakt.",
  ].join("\n");

  return {
    to: input.to,
    subject: `${FORWARD_SUBJECT_PREFIX} ${message.subject}`.trim(),
    text,
    attachments: [
      {
        filename: ORIGINAL_MESSAGE_FILENAME,
        content: input.source,
        contentType: ORIGINAL_MESSAGE_CONTENT_TYPE,
      },
    ],
  };
}
