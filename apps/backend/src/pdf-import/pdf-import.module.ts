import { Module } from "@nestjs/common";

import { PdfDocumentModule } from "../pdf-documents/pdf-document.module";
import { TripModule } from "../trips/trip.module";
import { PdfTripImporter } from "./pdf-trip-importer.service";

/**
 * No controller yet: importing is not something a client asks for today. The
 * IMAP service will drive this, and a manual-upload endpoint can be added when
 * there is a decision about who may upload and what they see back.
 *
 * The importer is exported so those callers can reach it without either of them
 * learning how a PDF becomes a Trip.
 */
@Module({
  imports: [TripModule, PdfDocumentModule],
  providers: [PdfTripImporter],
  exports: [PdfTripImporter],
})
export class PdfImportModule {}
