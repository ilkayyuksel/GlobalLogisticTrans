import { Module } from "@nestjs/common";

import { PdfDocumentController } from "./pdf-document.controller";
import { PdfDocumentRepository } from "./pdf-document.repository";
import { PdfDocumentService } from "./pdf-document.service";

/**
 * One controller, and it serves content only: a PdfDocument is created by an
 * import, never by a request, so there is nothing to create, update or list
 * here. What a client can do is read the transport order behind a Trip.
 *
 * Only the service is exported. TripRepository reaches this module's repository
 * by constructing it against the transaction client — the same way
 * TripPricingRepository binds its item repository — so the write path needs no
 * provider from here.
 */
@Module({
  controllers: [PdfDocumentController],
  providers: [PdfDocumentService, PdfDocumentRepository],
  exports: [PdfDocumentService],
})
export class PdfDocumentModule {}
