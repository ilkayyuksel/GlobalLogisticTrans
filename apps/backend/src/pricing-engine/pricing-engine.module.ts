import { Module } from "@nestjs/common";

import { RouteCostModule } from "../route-costs/route-cost.module";
import { RoutePricingModule } from "../route-pricing/route-pricing.module";
import { SettingsModule } from "../settings/settings.module";
import { TripCustomPropertyModule } from "../trip-custom-properties/trip-custom-property.module";
import { TripPricingItemModule } from "../trip-pricing-items/trip-pricing-item.module";
import { TripPricingModule } from "../trip-pricing/trip-pricing.module";
import { TripModule } from "../trips/trip.module";
import { BasePriceCalculator } from "./base-price.calculator";
import { CombinationSurchargeCalculator } from "./combination-surcharge.calculator";
import { CustomPropertyCalculator } from "./custom-property.calculator";
import { FuelSurchargeCalculator } from "./fuel-surcharge.calculator";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingEngineService } from "./pricing-engine.service";
import { PRICING_CALCULATION_STEPS } from "./pricing-line";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";
import { RouteCostResolver } from "./route-cost.resolver";
import { TollCalculator } from "./toll.calculator";
import { TripClosedPricingListener } from "./trip-closed-pricing.listener";
import { TunnelCalculator } from "./tunnel.calculator";
import { WaitingTimeCalculator } from "./waiting-time.calculator";

/**
 * The Pricing Engine.
 *
 * There is no controller and no repository here, and that is the point: the
 * Engine is a domain service. It owns no table, so it imports the seven modules
 * that own the data it needs and talks to their Services only.
 *
 * CustomPropertyModule is deliberately absent. The Engine reads a Trip's
 * ASSIGNED properties through TripCustomPropertyService, never the catalog, so
 * it has no reason to reach the catalog directly.
 *
 * All seven dependencies flow one way. Nothing in Settings, RoutePricing,
 * RouteCost, Trip, TripCustomProperty, TripPricing or TripPricingItem knows the
 * Engine exists, so no cycle can form and each of them stays independently
 * testable. When a calculation eventually has to be triggered by closing a
 * Trip, that trigger must be an event rather than a call from TripService, or
 * this direction inverts and the planning domain starts depending on pricing.
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
    RouteCostModule,
    TripModule,
    TripCustomPropertyModule,
    TripPricingModule,
    TripPricingItemModule,
  ],
  providers: [
    PricingEngineService,
    TripClosedPricingListener,
    PricingRuleResolver,
    PricingComponentResolver,
    RouteCostResolver,
    PricingSnapshotWriter,
    BasePriceCalculator,
    CombinationSurchargeCalculator,
    FuelSurchargeCalculator,
    WaitingTimeCalculator,
    TollCalculator,
    TunnelCalculator,
    CustomPropertyCalculator,
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
        fuelSurcharge: FuelSurchargeCalculator,
        waitingTime: WaitingTimeCalculator,
        toll: TollCalculator,
        tunnel: TunnelCalculator,
        customProperty: CustomPropertyCalculator,
      ) => [
        basePrice,
        combinationSurcharge,
        fuelSurcharge,
        waitingTime,
        toll,
        tunnel,
        customProperty,
      ],
      inject: [
        BasePriceCalculator,
        CombinationSurchargeCalculator,
        FuelSurchargeCalculator,
        WaitingTimeCalculator,
        TollCalculator,
        TunnelCalculator,
        CustomPropertyCalculator,
      ],
    },
  ],
  exports: [PricingEngineService],
})
export class PricingEngineModule {}
