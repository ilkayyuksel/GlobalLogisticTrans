import { Module } from "@nestjs/common";

import { CustomPropertyModule } from "../custom-properties/custom-property.module";
import { RoutePricingModule } from "../route-pricing/route-pricing.module";
import { SettingsModule } from "../settings/settings.module";
import { TripPricingItemModule } from "../trip-pricing-items/trip-pricing-item.module";
import { TripPricingModule } from "../trip-pricing/trip-pricing.module";
import { TripModule } from "../trips/trip.module";
import { BasePriceCalculator } from "./base-price.calculator";
import { CombinationSurchargeCalculator } from "./combination-surcharge.calculator";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingEngineService } from "./pricing-engine.service";
import { PRICING_CALCULATION_STEPS } from "./pricing-line";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";

/**
 * The Pricing Engine.
 *
 * There is no controller and no repository here, and that is the point: the
 * Engine is a domain service. It owns no table, so it imports the six modules
 * that own the data it needs and talks to their Services only.
 *
 * All six dependencies flow one way. Nothing in Settings, RoutePricing,
 * CustomProperty, Trip, TripPricing or TripPricingItem knows the Engine exists,
 * so no cycle can form and each of them stays independently testable. When a
 * calculation eventually has to be triggered by closing a Trip, that trigger
 * must be an event rather than a call from TripService, or this direction
 * inverts and the planning domain starts depending on pricing.
 *
 * PricingEngineService is exported so a future trigger — a "Reprocess Pricing"
 * endpoint, a queue worker, a scheduled job — can drive it. The resolvers and
 * the snapshot writer are deliberately NOT exported: they are the Engine's
 * internals, and a caller reaching past the Engine into them would bypass the
 * validation that makes a context trustworthy.
 */
@Module({
  imports: [
    SettingsModule,
    RoutePricingModule,
    CustomPropertyModule,
    TripModule,
    TripPricingModule,
    TripPricingItemModule,
  ],
  providers: [
    PricingEngineService,
    PricingRuleResolver,
    PricingComponentResolver,
    PricingSnapshotWriter,
    BasePriceCalculator,
    CombinationSurchargeCalculator,
    {
      /**
       * The pricing sequence, in the order pricing_rules.md defines.
       *
       * The order of this array IS the calculation order and is a business
       * rule, not an implementation detail — the document warns that changing
       * it changes the result. A future component is appended here in its
       * documented position; no existing calculator is edited.
       */
      provide: PRICING_CALCULATION_STEPS,
      useFactory: (
        basePrice: BasePriceCalculator,
        combinationSurcharge: CombinationSurchargeCalculator,
      ) => [basePrice, combinationSurcharge],
      inject: [BasePriceCalculator, CombinationSurchargeCalculator],
    },
  ],
  exports: [PricingEngineService],
})
export class PricingEngineModule {}
