import { Module } from "@nestjs/common";

import { TripModule } from "../trips/trip.module";
import { TripPricingController } from "./trip-pricing.controller";
import { TripPricingRepository } from "./trip-pricing.repository";
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
  controllers: [TripPricingController],
  providers: [TripPricingService, TripPricingRepository],
  exports: [TripPricingService],
})
export class TripPricingModule {}
