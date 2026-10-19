import { Module } from "@nestjs/common";

import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";
import { TripPricingModule } from "../trip-pricing/trip-pricing.module";
import { BulkPricingReprocessService } from "./bulk-pricing-reprocess.service";
import { PricingReprocessController } from "./pricing-reprocess.controller";
import { TripRouteChoiceController } from "./trip-route-choice.controller";

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
 * It provides only the bulk reprocess, which loops the single-Trip reprocess;
 * every other service it needs is borrowed.
 */
@Module({
  imports: [PricingEngineModule, TripPricingModule],
  controllers: [PricingReprocessController, TripRouteChoiceController],
  providers: [BulkPricingReprocessService],
})
export class PricingReprocessModule {}
