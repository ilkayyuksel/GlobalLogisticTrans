import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingCalculationContext } from "./pricing-calculation-context";
import {
  PricingCalculationStep,
  PricingComponentCode,
  PricingLine,
} from "./pricing-line";
import { toStorableAmount } from "./pricing-money";

/** pricing_rules.md numbers the Fuel Surcharge third in the sequence. */
export const FUEL_CALCULATION_ORDER = 3;

/** A configured percentage is a rate per hundred, not a fraction. */
const PERCENT_DIVISOR = new Prisma.Decimal(100);

/**
 * Calculates the Fuel Surcharge — step 3 of the pricing sequence.
 *
 * pricing_rules.md: "Fuel is calculated only on the Base Price." That rule is
 * enforced structurally rather than by convention — this step reads exactly one
 * line out of what came before it, the BASE_PRICE line, and never sees a total
 * or a running subtotal. A Combination Surcharge, a waiting-time charge, a toll
 * or any component added in a later phase can therefore never reach the fuel
 * base by accident, because the calculation has no expression in which they
 * could appear.
 *
 * The percentage is read from the context, which the foundation has already
 * resolved and validated. This step performs no lookup, re-checks nothing and
 * raises nothing: a missing or unusable FUEL_PERCENTAGE has already aborted the
 * calculation with MissingPricingSettingException before any step runs.
 *
 * All arithmetic is Decimal, and the result is rounded exactly once. Amounts
 * are never logged.
 */
@Injectable()
export class FuelSurchargeCalculator implements PricingCalculationStep {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(FuelSurchargeCalculator.name);
  }

  calculate(
    context: PricingCalculationContext,
    precedingLines: readonly PricingLine[],
  ): PricingLine[] {
    this.logger.log("Fuel surcharge calculation started", {
      tripId: context.tripId,
    });

    // "Every Trip begins with exactly one Base Price" (pricing_rules.md), so
    // the first match is the only match.
    const basePriceLine = precedingLines.find(
      (line) => line.component === PricingComponentCode.BASE_PRICE,
    );

    if (!basePriceLine) {
      // Diagnostics, not validation: nothing is rejected and nothing is thrown.
      // Fuel is a percentage OF something, so with no base price there is
      // nothing to charge it on — but a silent absence would hide a misordered
      // step list, which is the only way this can happen.
      this.logger.warn("No base price line to apply the fuel surcharge to", {
        tripId: context.tripId,
      });
    }

    const lines = basePriceLine
      ? [this.surchargeLine(basePriceLine, context.rules.fuelPercentage)]
      : [];

    this.logger.log("Fuel surcharge calculation completed", {
      tripId: context.tripId,
      lineCount: lines.length,
    });

    return lines;
  }

  /**
   * base x percentage / 100.
   *
   * Multiplying before dividing keeps every intermediate exact: the product of
   * two decimals is exact, and dividing by a power of ten only shifts the
   * decimal point. Dividing the percentage by 100 first would introduce a
   * repeating fraction for a rate such as 1/3 and lose precision before the
   * multiplication ever happened.
   *
   * The single rounding is applied here, to the final amount, and nowhere else.
   */
  private surchargeLine(
    basePriceLine: PricingLine,
    fuelPercentage: string,
  ): PricingLine {
    const amount = basePriceLine.amount
      .mul(new Prisma.Decimal(fuelPercentage))
      .div(PERCENT_DIVISOR);

    return {
      component: PricingComponentCode.FUEL_SURCHARGE,
      // Matches the wording used by the seeded pricing snapshots, and records
      // the rate that was actually applied.
      description: `Fuel ${fuelPercentage}%`,
      amount: toStorableAmount(amount),
      calculationOrder: FUEL_CALCULATION_ORDER,
      quantity: null,
      unitPrice: null,
      customPropertyId: null,
    };
  }
}
