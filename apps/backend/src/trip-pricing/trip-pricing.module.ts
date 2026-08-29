import { Module } from "@nestjs/common";

import { TripModule } from "../trips/trip.module";
import { EffectivePricingModule } from "./effective-pricing.module";
import { TripPricingController } from "./trip-pricing.controller";
import { TripPricingOverrideController } from "./trip-pricing-override.controller";
import { TripPricingOverrideService } from "./trip-pricing-override.service";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";
import { TripPricingService } from "./trip-pricing.service";

/**
 * PrismaModule and LoggerModule are global, so only two modules are imported.
 *
 * TripModule supplies the Trip existence lookup and the Trip's status, rather
 * than this module's repository reading the trip table. That direction is
 * deliberate: the pricing WRITE paths depend on Trip, never the reverse, so a
 * correction can always be refused for a Trip that does not exist.
 *
 * The Ritten list now carries each Trip's effective pricing, so TripModule does
 * read a stored figure — but through EffectivePricingModule, which sits BELOW
 * both of us and depends on neither. Nothing here became reachable from Trip:
 * not the overrides, not the Engine, not the reprocess path.
 *
 * TripPricingService is exported because the future Pricing Engine persists its
 * results through the service, never through the repository, so database access
 * stays behind a single door.
 */
@Module({
  imports: [TripModule, EffectivePricingModule],
  controllers: [TripPricingController, TripPricingOverrideController],
  providers: [
    TripPricingService,
    TripPricingRepository,
    TripPricingOverrideRepository,
    TripPricingOverrideService,
    TripPricingItemRepository,
  ],
  /*
   * EffectivePricingModule is re-exported because EffectivePricingService is
   * the SHARED source the Ritten columns, the Trip detail panel and both Excel
   * exports read, and every module that already imports this one expects to
   * find it here. The read itself now lives one level down — see that module
   * for why. Exporting the override repository too would invite a caller to
   * write one without going through the rules; it stays inside.
   */
  exports: [TripPricingService, EffectivePricingModule],
})
export class TripPricingModule {}
