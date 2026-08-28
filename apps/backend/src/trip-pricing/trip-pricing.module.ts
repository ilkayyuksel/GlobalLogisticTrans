import { Module } from "@nestjs/common";

import { TripModule } from "../trips/trip.module";
import { TripPricingController } from "./trip-pricing.controller";
import { TripPricingOverrideController } from "./trip-pricing-override.controller";
import { TripPricingOverrideService } from "./trip-pricing-override.service";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { EffectivePricingService } from "./effective-pricing.service";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";
import { TripPricingService } from "./trip-pricing.service";

/**
 * PrismaModule and LoggerModule are global, so only TripModule is imported.
 *
 * TripModule supplies the Trip existence lookup and the Trip's status, rather
 * than this module's repository reading the trip table. Dependencies flow one
 * way: Trip knows nothing about pricing, so no cycle can form. That direction
 * is deliberate — planning must stay independent of pricing, never the reverse.
 *
 * TripPricingService is exported because the future Pricing Engine persists its
 * results through the service, never through the repository, so database access
 * stays behind a single door.
 */
@Module({
  imports: [TripModule],
  controllers: [TripPricingController, TripPricingOverrideController],
  providers: [
    TripPricingService,
    TripPricingRepository,
    TripPricingOverrideRepository,
    TripPricingOverrideService,
    EffectivePricingService,
    TripPricingItemRepository,
  ],
  /*
   * EffectivePricingService is exported because it is the SHARED source the
   * Ritten columns, the Trip detail panel and both Excel exports will read.
   * Exporting the override repository too would invite a caller to write one
   * without going through the rules; it stays inside.
   */
  exports: [TripPricingService, EffectivePricingService],
})
export class TripPricingModule {}
