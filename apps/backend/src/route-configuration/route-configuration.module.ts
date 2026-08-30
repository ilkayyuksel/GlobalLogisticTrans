import { Module } from "@nestjs/common";

import { RouteCostModule } from "../route-costs/route-cost.module";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RoutePricingModule } from "../route-pricing/route-pricing.module";
import { RouteConfigurationController } from "./route-configuration.controller";
import { RouteConfigurationService } from "./route-configuration.service";

/**
 * The operator's view of route pricing.
 *
 * It owns NO table. Both modules it imports keep their own endpoints and their
 * own rules; this one composes them into the single record an operator
 * configures, so there is one place to change a route and no way to leave it
 * half configured.
 *
 * The dependency points one way — neither RoutePricing nor RouteCost knows this
 * module exists — so no cycle can form and both stay independently testable.
 *
 * `RouteCostRepository` is provided directly for one read the service layer
 * does not expose: turning a component CODE into its id, so the API can speak
 * of Toll and Tunnel rather than of UUIDs. It is a stateless Prisma wrapper,
 * and the same instance-per-module precedent EffectivePricingModule already
 * sets.
 */
@Module({
  imports: [RoutePricingModule, RouteCostModule],
  controllers: [RouteConfigurationController],
  providers: [RouteConfigurationService, RouteCostRepository],
  exports: [RouteConfigurationService],
})
export class RouteConfigurationModule {}
