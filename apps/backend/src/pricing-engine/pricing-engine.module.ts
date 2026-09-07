import { Module } from "@nestjs/common";

import { CustomPropertyModule } from "../custom-properties/custom-property.module";
import { RouteCostModule } from "../route-costs/route-cost.module";
import { RoutePricingModule } from "../route-pricing/route-pricing.module";
import { SettingsModule } from "../settings/settings.module";
import { TripCustomPropertyReadModule } from "../trip-custom-properties/trip-custom-property-read.module";
import { TripPricingItemModule } from "../trip-pricing-items/trip-pricing-item.module";
import { TripPricingModule } from "../trip-pricing/trip-pricing.module";
import { TripReadModule } from "../trips/trip-read.module";
import { BasePriceCalculator } from "./base-price.calculator";
import { CombinationSurchargeCalculator } from "./combination-surcharge.calculator";
import { CostConfirmationReadModule } from "../cost-confirmations/cost-confirmation-read.module";
import { CostConfirmationCalculator } from "./cost-confirmation.calculator";
import { CustomPropertyCalculator } from "./custom-property.calculator";
import { FuelSurchargeCalculator } from "./fuel-surcharge.calculator";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingEngineService } from "./pricing-engine.service";
import { PricingRecalculationService } from "./pricing-recalculation.service";
import { PRICING_CALCULATION_STEPS } from "./pricing-line";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";
import { RouteCostResolver } from "./route-cost.resolver";
import { TarChargeReadRepository } from "./tar-charge-read.repository";
import { TollCalculator } from "./toll.calculator";
import { TripClosedPricingListener } from "./trip-closed-pricing.listener";
import { TunnelCalculator } from "./tunnel.calculator";
import { WaitingTimeCalculator } from "./waiting-time.calculator";

/**
 * The Pricing Engine.
 *
 * There is no controller and no repository here, and that is the point: the
 * Engine is a domain service. It owns no table, so it imports the modules that
 * own the data it needs and talks to their Services only.
 *
 * ── IT IMPORTS READ SIDES, NOT DOMAINS ──────────────────────────────────────
 * Three of its inputs are now also things an operator CHANGES, and each change
 * has to leave the Trip's pricing current:
 *
 *   a Custom Property is assigned or removed
 *   a waiting-time window is entered or cleared
 *   a Cost Confirmation is recorded
 *
 * So TripModule, TripCustomPropertyModule and CostConfirmationModule all depend
 * on this module. If this module depended on them in return, every one of those
 * would be a cycle — and hiding a cycle behind forwardRef does not remove it,
 * it only moves the failure from boot to the first undefined dependency.
 *
 * The Engine therefore reads through the narrow READ modules instead. Each of
 * them imports nothing but Prisma, which is global, so they sit below both
 * sides and the graph stays acyclic:
 *
 *   TripCustomPropertyModule ─┐                ┌─> TripReadModule
 *   CostConfirmationModule ───┼─> PricingEngine┼─> CostConfirmationReadModule
 *   TripModule ───────────────┘       │        └─> TripCustomPropertyReadModule
 *                                     └─> TripPricingModule ─> TripReadModule
 *
 * A read module must never import this one.
 *
 * ── WHAT IT STILL READS THROUGH FULL DOMAINS ────────────────────────────────
 * Settings, RoutePricing, RouteCost, CustomProperty, TripPricing and
 * TripPricingItem know nothing about pricing recalculation and never will, so
 * there is nothing to invert: the Engine keeps using their services and every
 * rule they enforce stays true for the Engine too.
 *
 * It reaches the Custom Property CATALOG for exactly one thing: the property it
 * applies automatically — TAR — which by definition nobody assigned, so there
 * is no assignment to read it from. It is looked up by the id the
 * AUTOMATIC_CUSTOM_PROPERTY_ID Setting holds, never by name.
 *
 * ── WHAT IT EXPORTS ─────────────────────────────────────────────────────────
 * PricingEngineService, so a trigger — the reprocess endpoint, a queue worker,
 * a scheduled job — can drive it, and PricingRecalculationService, which is the
 * ONE place the "write kept, pricing null, reason code" contract lives. The
 * resolvers and the snapshot writer are deliberately NOT exported: they are the
 * Engine's internals, and a caller reaching past the Engine into them would
 * bypass the validation that makes a context trustworthy.
 *
 * Closing a Trip still prices it through an EVENT rather than a call from
 * TripService — see TripClosedPricingListener. Recalculating after an input
 * change is a direct call because the caller must WAIT for the answer and
 * return it; that is the difference between the two, and it is why one arrow
 * points each way without forming a loop.
 */
@Module({
  imports: [
    CostConfirmationReadModule,
    CustomPropertyModule,
    SettingsModule,
    RoutePricingModule,
    RouteCostModule,
    TripReadModule,
    TripCustomPropertyReadModule,
    TripPricingModule,
    TripPricingItemModule,
  ],
  providers: [
    PricingEngineService,
    PricingRecalculationService,
    TripClosedPricingListener,
    PricingRuleResolver,
    PricingComponentResolver,
    TarChargeReadRepository,
    RouteCostResolver,
    PricingSnapshotWriter,
    BasePriceCalculator,
    CombinationSurchargeCalculator,
    FuelSurchargeCalculator,
    WaitingTimeCalculator,
    TollCalculator,
    TunnelCalculator,
    CustomPropertyCalculator,
    CostConfirmationCalculator,
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
        costConfirmation: CostConfirmationCalculator,
      ) => [
        basePrice,
        combinationSurcharge,
        fuelSurcharge,
        waitingTime,
        toll,
        tunnel,
        customProperty,
        // Appended last: it depends on no earlier line, and none depends on it.
        costConfirmation,
      ],
      inject: [
        BasePriceCalculator,
        CombinationSurchargeCalculator,
        FuelSurchargeCalculator,
        WaitingTimeCalculator,
        TollCalculator,
        TunnelCalculator,
        CustomPropertyCalculator,
        CostConfirmationCalculator,
      ],
    },
  ],
  exports: [PricingEngineService, PricingRecalculationService],
})
export class PricingEngineModule {}
