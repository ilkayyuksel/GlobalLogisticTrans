import { Module } from "@nestjs/common";

import { SmtpMailClient } from "./smtp-mail.client";

/**
 * Outgoing mail.
 *
 * Exports the transport and nothing else. What a message SAYS belongs to the
 * module sending it — the mailbox import composes its own failure forward — so
 * this stays a boundary rather than becoming a place where every kind of email
 * the product sends accumulates its wording.
 */
@Module({
  providers: [SmtpMailClient],
  exports: [SmtpMailClient],
})
export class MailModule {}
