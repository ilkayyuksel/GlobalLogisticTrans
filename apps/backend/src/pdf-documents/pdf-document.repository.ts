import { Injectable } from "@nestjs/common";
import { PdfDocument, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export type CreatePdfDocumentData = Prisma.PdfDocumentUncheckedCreateInput;

/**
 * Database access for the PdfDocument domain.
 *
 * Contains no business rules, and only the two operations an import needs. No
 * update and no delete, because a stored transport order is the evidence behind
 * every Trip that came from it: it is written once and never altered. Reads
 * beyond the duplicate lookup can be added when something actually displays a
 * document — TripRepository already answers the existence question its own
 * foreign key needs.
 */
@Injectable()
export class PdfDocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The document with this content hash, if one was already imported.
   *
   * `file_hash` is deliberately NOT unique in the schema — the same PDF may
   * legitimately arrive twice, for instance resent with an `UPDATE:` subject —
   * so this is a lookup rather than a constraint.
   */
  findByFileHash(fileHash: string): Promise<PdfDocument | null> {
    return this.prisma.pdfDocument.findFirst({ where: { fileHash } });
  }

  create(data: CreatePdfDocumentData): Promise<PdfDocument> {
    return this.prisma.pdfDocument.create({ data });
  }
}
