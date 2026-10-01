import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { AppLoggerService } from "../logger/app-logger.service";

/** A file carried by an outgoing message. */
export interface OutgoingAttachment {
  readonly filename: string;
  readonly content: Buffer;
  readonly contentType: string;
}

/** One outgoing message, as plain data. */
export interface OutgoingMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly attachments: readonly OutgoingAttachment[];
}

/**
 * The boundary between this system and an outgoing mail server.
 *
 * The counterpart of `ImapMailboxClient`, and built the same way: it knows
 * connections and messages, and nothing about Trips, imports or why a message
 * is being sent. Replacing this one class is what lets everything that sends
 * mail be tested without a mail server.
 *
 * ── A TRANSPORT PER MESSAGE ─────────────────────────────────────────────────
 * The messages this sends are rare — an alert when an order cannot be read —
 * so a pooled, long-lived connection would spend its life idle and then have to
 * survive whatever the network did in between. Connecting per message costs a
 * second on a path that is already the slow one, and removes that whole class
 * of failure, exactly as the IMAP client decided for the same reason.
 */
@Injectable()
export class SmtpMailClient {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(SmtpMailClient.name);
  }

  /** Sends one message from the system's own address, or throws. */
  async send(message: OutgoingMessage): Promise<void> {
    const secure = this.configService.getOrThrow<boolean>("SMTP_SECURE");

    const transport = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>("SMTP_HOST"),
      port: this.configService.getOrThrow<number>("SMTP_PORT"),
      secure,
      /*
       * Without implicit TLS the connection MUST be upgraded with STARTTLS.
       * nodemailer would otherwise fall back to plain text when a server does
       * not offer the upgrade, and the password would cross the network in the
       * clear.
       */
      requireTLS: !secure,
      auth: {
        user: this.configService.getOrThrow<string>("SMTP_USERNAME"),
        pass: this.configService.getOrThrow<string>("SMTP_PASSWORD"),
      },
    });

    try {
      await transport.sendMail({
        from: this.configService.getOrThrow<string>("SMTP_FROM"),
        to: message.to,
        subject: message.subject,
        text: message.text,
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
        })),
      });
    } finally {
      transport.close();
    }

    // Identifiers only. The subject and body describe a customer's order.
    this.logger.log("Mail sent", {
      recipientDomain: message.to.split("@").pop() ?? "",
      attachmentCount: message.attachments.length,
    });
  }
}
