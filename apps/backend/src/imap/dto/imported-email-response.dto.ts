import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  EmailProcessingStatus,
  ImportType,
  ImportedEmail,
} from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";

/**
 * Public shape of an imported email.
 *
 * Read-only, and deliberately narrow. The stored `body` is NEVER exposed: it is
 * kept for debugging a specific failure, and a transport order's body may carry
 * customer correspondence that has no business being on an operations screen.
 * The `messageId` is also withheld — it identifies the message to the mail
 * server and tells an operator nothing.
 *
 * What is here answers the questions an operator actually asks: did it arrive,
 * was it handled, what kind of instruction was it, and did it produce a
 * document.
 */
export class ImportedEmailResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "orders@carrier.example.com" })
  senderEmail!: string;

  @ApiProperty({ example: "NEW: Trucking Order 1212816" })
  subject!: string;

  @ApiProperty({ format: "date-time", description: "When the mail was sent." })
  receivedAt!: Date;

  @ApiPropertyOptional({
    format: "date-time",
    nullable: true,
    description:
      "When processing finished. Null while pending, and null for a failure, because nothing was processed.",
  })
  processedAt!: Date | null;

  @ApiProperty({
    enum: EmailProcessingStatus,
    description:
      "RECEIVED or PROCESSING means work is outstanding. PROCESSED means Trips were created. FAILED means the next scan will retry it. IGNORED means it was set aside deliberately — an untrusted sender, an unsupported instruction, or an order already imported.",
  })
  processingStatus!: EmailProcessingStatus;

  @ApiProperty({
    enum: ImportType,
    description:
      "What the subject asked for. UPDATE and CANCEL are recognised but not carried out by this version, and are recorded as IGNORED.",
  })
  importType!: ImportType;

  @ApiPropertyOptional({
    format: "uuid",
    nullable: true,
    description:
      "The stored PDF this email produced, when it produced one. Null for an email that never got that far.",
  })
  pdfDocumentId!: string | null;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class PaginatedImportedEmailsDto {
  @ApiProperty({ type: [ImportedEmailResponseDto] })
  items!: ImportedEmailResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

/** The email with its PDF joined, as the repository loads it. */
export type ImportedEmailWithDocument = ImportedEmail & {
  pdfDocument: { id: string } | null;
};

export function toImportedEmailResponse(
  email: ImportedEmailWithDocument,
): ImportedEmailResponseDto {
  return {
    id: email.id,
    senderEmail: email.senderEmail,
    subject: email.subject,
    receivedAt: email.receivedAt,
    processedAt: email.processedAt,
    processingStatus: email.processingStatus,
    importType: email.importType,
    pdfDocumentId: email.pdfDocument ? email.pdfDocument.id : null,
  };
}
