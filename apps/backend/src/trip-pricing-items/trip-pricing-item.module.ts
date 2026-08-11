import { Module } from "@nestjs/common";

import { CustomPropertyModule } from "../custom-properties/custom-property.module";
import { TripPricingModule } from "../trip-pricing/trip-pricing.module";
import { TripPricingItemController } from "./trip-pricing-item.controller";
import { TripPricingItemRepository } from "./trip-pricing-item.repository";
import { TripPricingItemService } from "./trip-pricing-item.service";

/**
 * PrismaModule and LoggerModule are global, so only the two modules whose
 * services are called directly are imported.
 *
 * Both are read-only dependencies: TripPricingModule supplies the parent
 * snapshot's existence check, and CustomPropertyModule supplies the Reference
 * Entity's. Neither is ever written to from here — an item explains a total, it
 * must never change one.
 *
 * Dependencies flow one way: TripPricing knows nothing about its items, so no
 * cycle can form.
 *
 * TripPricingItemService is exported because the future Pricing Engine persists
 * each line through the service, never through the repository, so database
 * access stays behind a single door.
 */
@Module({
  imports: [TripPricingModule, CustomPropertyModule],
  controllers: [TripPricingItemController],
  providers: [TripPricingItemService, TripPricingItemRepository],
  exports: [TripPricingItemService],
})
export class TripPricingItemModule {}
