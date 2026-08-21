import { Injectable } from "@nestjs/common";
import {
  EmailProcessingStatus,
  ImportType,
  ImportedEmail,
} from "@prisma/client";

import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  PaginatedImportedEmailsDto,
  toImportedEmailResponse,
} from "./dto/imported-email-response.dto";
import { ListImportedEmailsQueryDto } from "./dto/list-imported-emails-query.dto";
import { MailboxMessage } from "./imap-mailbox.client";
import { ImportedEmailRepository } from "./imported-email.repository";

/**
 * The record of every email this system has looked at.
 *
 * Its purpose is idempotency. IMAP's `\Seen` flag decides which messages a scan
 * is offered, but it is mutable by anyone opening the mailbox in a mail client
 * and it cannot say why something failed. This table answers both durably, and
 * it already existed in the schema for exactly this reason — the unique
 * `messageId` is documented as the guard against a reconnecting session
 * reprocessing an email.
 *
 * The email body is never stored. The column is nullable and documented as
 * debugging-only, and a transport order's body adds nothing the PDF does not
 * already carry.
 */
@Injectable()
export class ImportedEmailService {
  constructor(
    private readonly repository: ImportedEmailRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(ImportedEmailService.name);
  }

  /**
   * A page of imported emails, newest first.
   *
   * Read-only by design: this record is written by the scan and is the evidence
   * of what the mailbox did. Nothing may edit or delete it from outside, so
   * there is no update or remove counterpart here.
   */
  async findAll(
    query: ListImportedEmailsQueryDto,
  ): Promise<PaginatedImportedEmailsDto> {
    const { items, totalItems } = await this.repository.findPage({
      processingStatus: query.processingStatus,
      importType: query.importType,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toImportedEmailResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  /** Whether this email was already handled by an earlier scan. */
  findByMessageId(messageId: string): Promise<ImportedEmail | null> {
    return this.repository.findByMessageId(messageId);
  }

  /**
   * Opens the record for an email about to be imported.
   *
   * Created as PROCESSING rather than RECEIVED: the row is written at the
   * moment work starts, so a row left in PROCESSING is itself the evidence that
   * a scan died mid-import. Nothing else would record that.
   *
   * The action comes from the caller, which read it from the subject. It used
   * to be NEW for every processed email, which made an update, a cancellation
   * and a cost confirmation indistinguishable in `/imports` once they had been
   * handled — a record of what arrived that could not say what it was.
   */
  startProcessing(
    message: MailboxMessage,
    importType: ImportType,
  ): Promise<ImportedEmail> {
    return this.repository.create({
      messageId: message.messageId,
      senderEmail: message.senderEmail,
      subject: message.subject,
      receivedAt: message.receivedAt,
      importType,
      processingStatus: EmailProcessingStatus.PROCESSING,
    });
  }

  /**
   * Records an email that will never be imported.
   *
   * An untrusted sender, or an UPDATE or CANCEL this version cannot carry out.
   * Written rather than discarded so the decision is auditable, and so a
   * rescan recognises the email instead of re-evaluating it. `importType` still
   * reflects what the subject asked for, which is what makes these rows a
   * usable work list when UPDATE and CANCEL are implemented.
   */
  recordIgnored(
    message: MailboxMessage,
    importType: ImportType,
    reason: string,
  ): Promise<ImportedEmail> {
    this.logger.log("Email ignored", {
      messageId: message.messageId,
      senderEmail: message.senderEmail,
      reason,
    });

    return this.repository.create({
      messageId: message.messageId,
      senderEmail: message.senderEmail,
      subject: message.subject,
      receivedAt: message.receivedAt,
      importType,
      processingStatus: EmailProcessingStatus.IGNORED,
      processedAt: new Date(),
    });
  }

  markProcessed(importedEmailId: string): Promise<ImportedEmail> {
    return this.repository.updateStatus(
      importedEmailId,
      EmailProcessingStatus.PROCESSED,
      new Date(),
    );
  }

  /**
   * A failure that the next scan should retry.
   *
   * `processedAt` stays null, because nothing was processed. The email is also
   * left unread in the mailbox, so the next scan picks it up again — which is
   * the entire retry mechanism.
   */
  markFailed(importedEmailId: string): Promise<ImportedEmail> {
    return this.repository.updateStatus(
      importedEmailId,
      EmailProcessingStatus.FAILED,
      null,
    );
  }

  /**
   * An email whose PDF turned out to be one this system already holds.
   *
   * Marked IGNORED rather than FAILED: nothing went wrong, the Trips simply
   * exist already. Leaving it FAILED would put a permanent error in the record
   * for a mailbox behaving exactly as expected, and would invite someone to
   * "fix" a duplicate into existence.
   */
  markAlreadyImported(importedEmailId: string): Promise<ImportedEmail> {
    return this.repository.updateStatus(
      importedEmailId,
      EmailProcessingStatus.IGNORED,
      new Date(),
    );
  }
}
