import { Module } from "@nestjs/common";

import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";
import { TripPricingItemModule } from "../trip-pricing-items/trip-pricing-item.module";
import { TripPricingModule } from "../trip-pricing/trip-pricing.module";
import { PricingReprocessController } from "./pricing-reprocess.controller";

/**
 * The REST adapter for the Pricing Engine.
 *
 * A module of its own, containing only a controller, for one structural reason:
 * PricingEngineModule already imports TripPricingModule, so putting this
 * endpoint on TripPricingController would make the two import each other. A
 * thin adapter module breaks that cycle without weakening either side.
 *
 * It also keeps a decision made when the Engine was designed: the Engine is a
 * domain service, not a REST module. HTTP lives here — the route, the status
 * mapping, the response shape — and the Engine stays free of it, which is what
 * lets a queue worker or a scheduled job drive the same operation later.
 *
 * Nothing is provided or exported. This module contributes one route and
 * borrows every service it needs.
 */
@Module({
  imports: [PricingEngineModule, TripPricingModule, TripPricingItemModule],
  controllers: [PricingReprocessController],
})
export class PricingReprocessModule {}
