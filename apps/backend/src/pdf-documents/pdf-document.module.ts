import { Module } from "@nestjs/common";

import { PdfDocumentRepository } from "./pdf-document.repository";
import { PdfDocumentService } from "./pdf-document.service";

/**
 * No controller: a PdfDocument is created by an import, never by a request, so
 * there is nothing for a client to call. A read API can be added when something
 * actually needs to list documents.
 *
 * Only the service is exported. TripRepository reaches this module's repository
 * by constructing it against the transaction client — the same way
 * TripPricingRepository binds its item repository — so the write path needs no
 * provider from here.
 */
@Module({
  providers: [PdfDocumentService, PdfDocumentRepository],
  exports: [PdfDocumentService],
})
export class PdfDocumentModule {}
