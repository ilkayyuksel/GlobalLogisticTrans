import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

import type { EnvironmentVariables } from "../config/environment.variables";
import { EffectivePricingModule } from "../trip-pricing/effective-pricing.module";
import { TripRepository } from "../trips/trip.repository";
import { InvoiceAuditController } from "./invoice-audit.controller";
import { InvoiceAuditService } from "./invoice-audit.service";
import { InvoiceRowMatchingService } from "./matching/invoice-row-matching.service";
import { MissingTripsService } from "./missing/missing-trips.service";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";

/** The unit the limit is reasoned about in, as the PDF upload states it too. */
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * The weekly invoice check.
 *
 * ── IT OWNS NO TABLE ────────────────────────────────────────────────────────
 * Nothing here is stored. The module reads a document, asks the Trip side what
 * it holds, and answers — so its only dependency is the READ side of Trips.
 *
 * `TripRepository` is provided directly rather than reached through
 * `TripService`: this needs one batched lookup by day and booking, which the
 * service layer does not expose, and the alternative would be a hundred service
 * calls for a hundred lines. It is a stateless Prisma wrapper and the same
 * instance-per-module precedent `RouteConfigurationModule` already sets for
 * `RouteCostRepository`.
 *
 * ── AND IT WRITES NO FILE ───────────────────────────────────────────────────
 * The upload is held in memory for the length of the request, exactly as the
 * PDF import holds a transport order: an invoice is measured in kilobytes, the
 * limit below keeps it that way, and there is no temporary file to clean up or
 * leave a customer's commercial figures in.
 */
@Module({
  imports: [
    /*
     * The READ side of pricing, and only that. It answers what a Trip is worth
     * with the Engine's figures and an operator's corrections already resolved;
     * nothing here can price, correct or reprocess anything.
     */
    EffectivePricingModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => ({
        storage: memoryStorage(),
        limits: {
          // Enforced while the request is being read, so an oversized file is
          // never held in full and never reaches the reader.
          fileSize:
            configService.get("INVOICE_UPLOAD_MAX_SIZE_MB", { infer: true }) *
            BYTES_PER_MEGABYTE,
          // One invoice per request: a check is about one week's document, and
          // a batch would have to answer which of several it reported on.
          files: 1,
        },
      }),
    }),
  ],
  controllers: [InvoiceAuditController],
  providers: [
    InvoiceAuditService,
    InvoiceSheetReader,
    InvoiceSheetWriter,
    InvoiceRowMatchingService,
    InvoicePricingService,
    MissingTripsService,
    TripRepository,
  ],
})
export class InvoiceAuditModule {}
