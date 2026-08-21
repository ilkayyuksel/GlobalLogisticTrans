import { Module } from "@nestjs/common";

import { CostConfirmationModule } from "../cost-confirmations/cost-confirmation.module";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

import { EnvironmentVariables } from "../config/environment.variables";
import { PdfDocumentModule } from "../pdf-documents/pdf-document.module";
import { TripModule } from "../trips/trip.module";
import { PdfImportController } from "./pdf-import.controller";
import { PdfTripImporter } from "./pdf-trip-importer.service";
import { PdfUploadService } from "./pdf-upload.service";

const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * How many documents one upload may carry.
 *
 * An operator empties a mail folder of a morning's orders, not an archive. The
 * cap is what keeps a single request from becoming an unbounded amount of
 * parsing work; a larger batch is two uploads.
 */
const MAX_FILES_PER_UPLOAD = 20;

/**
 * The PDF import.
 *
 * Two callers, one path. The mailbox reaches `PdfTripImporter` directly, the
 * upload endpoint reaches it through `PdfUploadService`, and neither of them
 * knows how a PDF becomes a Trip.
 *
 * Uploads are held in memory rather than spooled to a temporary directory. A
 * transport order is measured in kilobytes and the limit below keeps it that
 * way, so there is no temporary file to clean up and no second place where
 * customer documents could be left behind — the only file this system writes is
 * the content-addressed one `PdfDocumentService` stores.
 */
@Module({
  imports: [
    CostConfirmationModule,
    TripModule,
    PdfDocumentModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService<EnvironmentVariables, true>,
      ) => ({
        storage: memoryStorage(),
        limits: {
          // Enforced while the request is being read, so an oversized file is
          // never held in full and never reaches the importer.
          fileSize:
            configService.get("PDF_UPLOAD_MAX_SIZE_MB", { infer: true }) *
            BYTES_PER_MEGABYTE,
          files: MAX_FILES_PER_UPLOAD,
        },
      }),
    }),
  ],
  controllers: [PdfImportController],
  providers: [PdfTripImporter, PdfUploadService],
  exports: [PdfTripImporter],
})
export class PdfImportModule {}
