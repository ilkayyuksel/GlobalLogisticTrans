import { Module } from "@nestjs/common";

import { MailModule } from "../mail/mail.module";
import { PdfImportModule } from "../pdf-import/pdf-import.module";
import { ImapMailboxClient } from "./imap-mailbox.client";
import { ImapScanController } from "./imap-scan.controller";
import { ImapScanService } from "./imap-scan.service";
import { ImapScheduler } from "./imap.scheduler";
import { ImportFailureForwarder } from "./import-failure-forwarder.service";
import { ImportedEmailController } from "./imported-email.controller";
import { ImportedEmailRepository } from "./imported-email.repository";
import { ImportedEmailService } from "./imported-email.service";

/**
 * Mailbox ingestion.
 *
 * Depends on PdfImportModule and nothing else of the business: the mailbox side
 * hands over bytes and a filename, and everything after that — parsing,
 * terminals, Trips, TripGroups, storage — stays behind `PdfTripImporter`
 * exactly as the manual path uses it.
 *
 * MailModule is the one outgoing dependency: an email whose import fails is
 * forwarded to a person. It is imported HERE and nowhere on the manual upload
 * path, which is what keeps an upload from ever sending mail.
 *
 * Nothing is exported. This module is a driver, not a service other modules
 * call; the only ways in are the scheduled job and the operator endpoint, and
 * both go through the same `ImapScanService`.
 */
@Module({
  imports: [PdfImportModule, MailModule],
  controllers: [ImapScanController, ImportedEmailController],
  providers: [
    ImapScanService,
    ImapMailboxClient,
    ImportedEmailService,
    ImportedEmailRepository,
    ImapScheduler,
    ImportFailureForwarder,
  ],
})
export class ImapModule {}
