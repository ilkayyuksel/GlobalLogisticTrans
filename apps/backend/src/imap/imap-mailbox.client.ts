import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ImapFlow, MessageStructureObject } from "imapflow";

import { AppLoggerService } from "../logger/app-logger.service";
import { PDF_MIME_TYPE } from "../pdf-documents/pdf-document.service";
import {
  AttachmentDownloadException,
  ImapConnectionException,
  ImapErrorCode,
} from "./exceptions/imap.exceptions";

/**
 * One message, reduced to what the scan actually decides on.
 *
 * No body, no headers beyond these, and no attachment bytes: everything here is
 * either an identifier or something a selection rule reads. Bytes are fetched
 * separately, and only for a message that has already been accepted.
 */
export interface MailboxMessage {
  readonly uid: number;
  /** RFC Message-ID. The idempotency key, and unique in `imported_email`. */
  readonly messageId: string;
  readonly senderEmail: string;
  readonly subject: string;
  readonly receivedAt: Date;
  readonly attachments: readonly MailboxAttachment[];
}

/** An attachment as the server describes it, before anything is downloaded. */
export interface MailboxAttachment {
  /** IMAP body part number, used to fetch just this part. */
  readonly part: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface DownloadedAttachment {
  readonly filename: string;
  readonly content: Uint8Array;
}

/**
 * The boundary between this system and an IMAP server.
 *
 * It knows connections, folders, envelopes and body parts. It knows nothing
 * about Trips, PdfDocuments, parsing or Prisma, and it returns plain data
 * rather than domain objects — which is what lets the scan service be tested
 * exhaustively without a mailbox, by replacing this one class.
 *
 * Every method opens and closes its own connection. A long-lived connection
 * would have to survive network drops and server timeouts between scans that
 * are minutes apart; connecting per scan costs a second and removes that entire
 * class of problem.
 */
@Injectable()
export class ImapMailboxClient {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(ImapMailboxClient.name);
  }

  /**
   * Runs `work` against an open mailbox, then always closes it.
   *
   * The connection is a resource with two failure modes worth separating:
   * refusing to connect and refusing the credentials. `error_codes.md` gives
   * them different codes because the fixes are different — one is a network or
   * host problem, the other is a password.
   */
  async withMailbox<TResult>(
    work: (client: ImapMailboxSession) => Promise<TResult>,
  ): Promise<TResult> {
    const host = this.configService.getOrThrow<string>("IMAP_HOST");
    const folder = this.configService.getOrThrow<string>("IMAP_FOLDER");

    const client = new ImapFlow({
      host,
      port: this.configService.getOrThrow<number>("IMAP_PORT"),
      secure: this.configService.getOrThrow<boolean>("IMAP_TLS"),
      auth: {
        user: this.configService.getOrThrow<string>("IMAP_USERNAME"),
        pass: this.configService.getOrThrow<string>("IMAP_PASSWORD"),
      },
      // imapflow logs the whole IMAP conversation at info level by default,
      // which would put credentials and message content in our logs.
      logger: false,
    });

    try {
      await client.connect();
    } catch (error: unknown) {
      throw new ImapConnectionException(
        isAuthenticationFailure(error)
          ? ImapErrorCode.AUTHENTICATION_FAILED
          : ImapErrorCode.CONNECTION_FAILED,
        host,
        describe(error),
      );
    }

    this.logger.log("Mailbox connection established", { host, folder });

    try {
      const lock = await this.openFolder(client, host, folder);

      try {
        return await work(new ImapMailboxSession(client));
      } finally {
        lock.release();
      }
    } finally {
      // logout() speaks to the server and can itself fail; close() cannot, and
      // a failed cleanup must never replace the real error.
      await client.logout().catch(() => client.close());
    }
  }

  private async openFolder(client: ImapFlow, host: string, folder: string) {
    try {
      return await client.getMailboxLock(folder);
    } catch (error: unknown) {
      throw new ImapConnectionException(
        ImapErrorCode.MAILBOX_ACCESS_FAILED,
        host,
        `folder "${folder}" could not be opened: ${describe(error)}`,
      );
    }
  }
}

/**
 * An open mailbox.
 *
 * Separate from the client so that the connection's lifetime is visible in the
 * type: these operations exist only inside `withMailbox`, and cannot be called
 * against a closed connection by accident.
 */
export class ImapMailboxSession {
  constructor(private readonly client: ImapFlow) {}

  /**
   * Today's messages, described but not downloaded.
   *
   * The date is the candidate filter, and the server applies it: `SINCE` is
   * part of the IMAP search, so a mailbox holding years of mail still returns
   * only the handful of envelopes a poll can act on. Nothing older is described,
   * listed or fetched during a normal scan.
   *
   * Deliberately NOT the unread flag. A flag is not a record of what this
   * system did — anyone opening the mailbox in a mail client can read a
   * transport order before the next poll, and filtering on `seen: false` would
   * then hide that order forever. What an email has already caused is answered
   * by `imported_email`, which this system alone writes, and every message
   * returned here is checked against it before anything is downloaded.
   *
   * Read and unread are therefore both returned. Re-describing a handful of
   * already-imported envelopes each poll is the price of never losing an order
   * to a flag, and it costs one envelope fetch — no attachment is downloaded
   * for a message `imported_email` already knows.
   */
  async findCandidates(): Promise<MailboxMessage[]> {
    const messages: MailboxMessage[] = [];

    for await (const message of this.client.fetch(
      { since: startOfToday() },
      { uid: true, envelope: true, bodyStructure: true },
    )) {
      const envelope = message.envelope;

      messages.push({
        uid: message.uid,
        messageId: envelope?.messageId ?? `uid:${message.uid}`,
        senderEmail: envelope?.from?.[0]?.address ?? "",
        subject: envelope?.subject ?? "",
        receivedAt: envelope?.date ?? new Date(),
        attachments: collectPdfAttachments(message.bodyStructure),
      });
    }

    return messages;
  }

  /** Fetches one body part. Only ever called for an accepted message. */
  async downloadAttachment(
    message: MailboxMessage,
    attachment: MailboxAttachment,
  ): Promise<DownloadedAttachment> {
    try {
      const download = await this.client.download(
        String(message.uid),
        attachment.part,
        { uid: true },
      );

      return {
        filename: attachment.filename,
        content: await readStream(download.content),
      };
    } catch (error: unknown) {
      throw new AttachmentDownloadException(
        message.messageId,
        attachment.filename,
        describe(error),
      );
    }
  }

  /**
   * Marks a message read, once its import succeeded.
   *
   * No longer what stops a second import — `imported_email` is — but it is what
   * makes the mailbox readable to a human: an operator opening the folder sees
   * at a glance which orders this system has taken in. A failed message stays
   * unread for the same reason, and is retried by the next scan, which is the
   * whole retry mechanism.
   */
  async markSeen(message: MailboxMessage): Promise<void> {
    await this.client.messageFlagsAdd(String(message.uid), ["\\Seen"], {
      uid: true,
    });
  }
}

/**
 * Midnight this morning, in the server's own timezone.
 *
 * IMAP `SINCE` compares whole dates rather than instants, so the time of day is
 * dropped by the protocol anyway; what matters is that the day is the local one,
 * because that is the day an operator means when they say a transport order
 * arrived today.
 */
function startOfToday(): Date {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The PDF attachments anywhere in the MIME tree.
 *
 * Walks recursively because a forwarded or signed message nests its parts. Both
 * the content type and the filename extension are accepted as evidence: some
 * senders label a PDF `application/octet-stream`, and rejecting those would
 * refuse real transport orders.
 */
function collectPdfAttachments(
  node: MessageStructureObject | undefined,
): MailboxAttachment[] {
  if (!node) {
    return [];
  }

  if (node.childNodes && node.childNodes.length > 0) {
    return node.childNodes.flatMap(collectPdfAttachments);
  }

  const filename = attachmentFilename(node);

  if (!filename || !node.part) {
    return [];
  }

  const isPdf =
    node.type?.toLowerCase() === PDF_MIME_TYPE ||
    filename.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    return [];
  }

  return [
    {
      part: node.part,
      filename,
      contentType: node.type ?? "",
      sizeBytes: node.size ?? 0,
    },
  ];
}

/**
 * The declared filename, from either header that can carry one.
 *
 * A part with no filename at all is inline content — a message body — not an
 * attachment, so it is skipped rather than given an invented name.
 */
function attachmentFilename(node: MessageStructureObject): string | null {
  return node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * IMAP reports a rejected login as a failed AUTHENTICATE command rather than a
 * distinct error type, so the response text is the only signal available.
 */
function isAuthenticationFailure(error: unknown): boolean {
  const text = describe(error).toLowerCase();

  return (
    text.includes("auth") ||
    text.includes("credentials") ||
    text.includes("login")
  );
}

/** The reason only. A stack would leak internals into an operational log. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
