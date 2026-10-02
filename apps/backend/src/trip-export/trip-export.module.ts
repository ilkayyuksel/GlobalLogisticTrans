import { Module } from "@nestjs/common";

import { SettingsModule } from "../settings/settings.module";
import { TripPricingModule } from "../trip-pricing/trip-pricing.module";
import { TripModule } from "../trips/trip.module";
import { TripExportController } from "./trip-export.controller";
import { TripExportLabelsService } from "./trip-export-labels.service";

/**
 * The words exports print about Trips — one vocabulary, one owner.
 *
 * Exported because the invoice check prints the same words into the
 * customer's workbook that the browser's exports print into ours.
 */
@Module({
  imports: [TripModule, TripPricingModule, SettingsModule],
  controllers: [TripExportController],
  providers: [TripExportLabelsService],
  exports: [TripExportLabelsService],
})
export class TripExportModule {}
