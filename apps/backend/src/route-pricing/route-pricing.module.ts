import { Module } from "@nestjs/common";

import { CombinationRoutePricingService } from "./combination-route-pricing.service";
import { RoutePricingController } from "./route-pricing.controller";
import { RoutePricingRepository } from "./route-pricing.repository";
import { RoutePricingService } from "./route-pricing.service";

/**
 * PrismaModule and LoggerModule are global, so no imports are needed.
 *
 * RoutePricingService is exported because the Pricing Engine will need to read
 * the configured base price for a route. It depends on the service, never on
 * the repository, so database access stays behind a single door.
 *
 * CombinationRoutePricingService is exported for the same reason and stands
 * beside it rather than inside it: one stores a route, the other stores a PAIR
 * of legs and the rules that make them a pair.
 */
@Module({
  controllers: [RoutePricingController],
  providers: [
    RoutePricingService,
    CombinationRoutePricingService,
    RoutePricingRepository,
  ],
  exports: [RoutePricingService, CombinationRoutePricingService],
})
export class RoutePricingModule {}
