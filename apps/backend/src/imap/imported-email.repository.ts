import { Injectable } from "@nestjs/common";
import {
  EmailProcessingStatus,
  ImportType,
  ImportedEmail,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { ImportedEmailWithDocument } from "./dto/imported-email-response.dto";

export type CreateImportedEmailData = Prisma.ImportedEmailUncheckedCreateInput;

export interface FindImportedEmailsFilter {
  processingStatus?: EmailProcessingStatus;
  importType?: ImportType;
  skip: number;
  take: number;
}

export interface ImportedEmailPage {
  items: ImportedEmailWithDocument[];
  totalItems: number;
}

/**
 * Database access for the ImportedEmail domain.
 *
 * Contains no business rules. There is no delete: the record of which emails
 * were handled is what makes a rescan safe, so it is only ever added to.
 */
@Injectable()
export class ImportedEmailRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The record of an email, if this system has seen it before.
   *
   * `message_id` is unique in the schema, so this answers "was this email
   * already handled" definitively — the check that lets a rescan skip work
   * instead of repeating it.
   */
  findByMessageId(messageId: string): Promise<ImportedEmail | null> {
    return this.prisma.importedEmail.findUnique({ where: { messageId } });
  }

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a scan writes between the two queries.
   *
   * Newest first: an operator opening this screen is asking about the mail that
   * just arrived, not the mail from last month. The PDF is joined rather than
   * fetched per row, so a page costs one round trip however long it is.
   */
  async findPage(filter: FindImportedEmailsFilter): Promise<ImportedEmailPage> {
    const where: Prisma.ImportedEmailWhereInput = {
      ...(filter.processingStatus
        ? { processingStatus: filter.processingStatus }
        : {}),
      ...(filter.importType ? { importType: filter.importType } : {}),
    };

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.importedEmail.findMany({
        where,
        // receivedAt then id, so paging stays stable when two mails share a
        // timestamp — which a batch delivery makes entirely possible.
        orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
        include: { pdfDocument: { select: { id: true } } },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.importedEmail.count({ where }),
    ]);

    return { items, totalItems };
  }

  create(data: CreateImportedEmailData): Promise<ImportedEmail> {
    return this.prisma.importedEmail.create({ data });
  }

  updateStatus(
    id: string,
    status: EmailProcessingStatus,
    processedAt: Date | null,
  ): Promise<ImportedEmail> {
    return this.prisma.importedEmail.update({
      where: { id },
      data: { processingStatus: status, processedAt },
    });
  }
}
