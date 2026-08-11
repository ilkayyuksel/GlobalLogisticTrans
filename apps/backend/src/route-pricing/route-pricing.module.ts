import { Module } from "@nestjs/common";

import { RoutePricingController } from "./route-pricing.controller";
import { RoutePricingRepository } from "./route-pricing.repository";
import { RoutePricingService } from "./route-pricing.service";

/**
 * PrismaModule and LoggerModule are global, so no imports are needed.
 *
 * RoutePricingService is exported because the Pricing Engine will need to read
 * the configured base price for a route. It depends on the service, never on
 * the repository, so database access stays behind a single door.
 */
@Module({
  controllers: [RoutePricingController],
  providers: [RoutePricingService, RoutePricingRepository],
  exports: [RoutePricingService],
})
export class RoutePricingModule {}
