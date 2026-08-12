import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { MONEY_DECIMAL_PLACES } from "../common/dto/money";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  PricingCalculationContext,
  PricingRouteIdentity,
} from "./pricing-calculation-context";
import {
  PricingCalculationStep,
  PricingComponentCode,
  PricingLine,
} from "./pricing-line";
import { PricingStrategy } from "./pricing-settings";

/** pricing_rules.md numbers the Base Route Price first in the sequence. */
export const BASE_PRICE_CALCULATION_ORDER = 1;

/**
 * Commercial rounding, applied once per line.
 *
 * A distance-based base price multiplies two two-decimal values and can carry
 * four decimals, while `trip_pricing_item.amount` is NUMERIC(12,2). Rounding
 * here rather than leaving it to the database keeps the amount the Engine
 * produced identical to the amount that gets stored.
 *
 * Half-up is the convention an invoice reader expects; no source document
 * specifies a rule, so this is a decision rather than a transcription.
 */
const MONEY_ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

/**
 * Calculates the Base Price — step 1 of the pricing sequence.
 *
 * Every Trip begins with exactly one Base Price, and the active Pricing
 * Strategy decides how it is derived. Both strategies are implemented here
 * because they are two ways of answering one question; a Trip is priced by
 * exactly one of them.
 *
 * The calculator is pure: it reads the validated context and returns a line.
 * It performs no lookup, no validation and no write — the context is already
 * guaranteed complete by the time a step runs, which is what lets a step be a
 * formula and nothing else.
 *
 * All arithmetic is Decimal. Not one JavaScript number takes part.
 *
 * Amounts are never logged.
 */
@Injectable()
export class BasePriceCalculator implements PricingCalculationStep {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(BasePriceCalculator.name);
  }

  calculate(context: PricingCalculationContext): PricingLine[] {
    this.logger.log("Base price calculation started", {
      tripId: context.tripId,
      strategy: context.baseSource.strategy,
    });

    const line =
      context.baseSource.strategy === PricingStrategy.ROUTE_BASED
        ? this.fromConfiguredRoute(context.baseSource, context.route)
        : this.fromDistance(context.baseSource);

    this.logger.log("Base price calculation completed", {
      tripId: context.tripId,
      strategy: context.baseSource.strategy,
      calculationOrder: line.calculationOrder,
    });

    return [line];
  }

  /**
   * Route-Based Pricing: the configured price of the route IS the base price.
   *
   * No arithmetic at all, so the configured amount reaches the breakdown
   * untouched. Quantity and unit price stay null — a flat route price is not
   * charged per unit of anything.
   *
   * The description names the route from the context rather than from the
   * configured row. The two are the same text: the configuration was looked up
   * by matching departure and destination exactly.
   */
  private fromConfiguredRoute(
    baseSource: Extract<
      PricingCalculationContext["baseSource"],
      { strategy: typeof PricingStrategy.ROUTE_BASED }
    >,
    route: PricingRouteIdentity,
  ): PricingLine {
    return {
      component: PricingComponentCode.BASE_PRICE,
      description: this.describeRoute(route),
      amount: this.toStorableAmount(new Prisma.Decimal(baseSource.basePrice)),
      calculationOrder: BASE_PRICE_CALCULATION_ORDER,
      quantity: null,
      unitPrice: null,
      customPropertyId: null,
    };
  }

  /**
   * Distance-Based Pricing: distance multiplied by the configured rate.
   *
   * The distance and the rate are kept on the line as quantity and unit price,
   * so the breakdown explains how the amount was reached without anyone having
   * to recompute it.
   */
  private fromDistance(
    baseSource: Extract<
      PricingCalculationContext["baseSource"],
      { strategy: typeof PricingStrategy.DISTANCE_BASED }
    >,
  ): PricingLine {
    const distanceKm = new Prisma.Decimal(baseSource.distanceKm);
    const ratePerKm = new Prisma.Decimal(baseSource.ratePerKm);

    return {
      component: PricingComponentCode.BASE_PRICE,
      description: `${distanceKm.toFixed(MONEY_DECIMAL_PLACES)} km`,
      amount: this.toStorableAmount(distanceKm.mul(ratePerKm)),
      calculationOrder: BASE_PRICE_CALCULATION_ORDER,
      quantity: distanceKm,
      unitPrice: ratePerKm,
      customPropertyId: null,
    };
  }

  /**
   * Names the route on the breakdown line.
   *
   * `departure` is nullable because `trip.terminal` is. Route-Based Pricing
   * cannot reach this method without a terminal — resolving its base source
   * rejects a Trip that has none — but the type permits it, so the destination
   * alone is named rather than printing an empty half of the route.
   */
  private describeRoute(route: PricingRouteIdentity): string {
    return route.departure === null
      ? route.destination
      : `${route.departure} - ${route.destination}`;
  }

  /** Reduces an exact result to the precision the amount column can hold. */
  private toStorableAmount(amount: Prisma.Decimal): Prisma.Decimal {
    return amount.toDecimalPlaces(MONEY_DECIMAL_PLACES, MONEY_ROUNDING);
  }
}
