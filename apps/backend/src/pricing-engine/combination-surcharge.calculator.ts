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

/** pricing_rules.md numbers the Combination Surcharge second in the sequence. */
export const COMBINATION_CALCULATION_ORDER = 2;

/** Matches the wording already used by the seeded pricing snapshots. */
const COMBINATION_DESCRIPTION = "Combination surcharge";

/**
 * Calculates the Combination Surcharge — step 2 of the pricing sequence.
 *
 * pricing_rules.md: "Only Trips belonging to a TripGroup are eligible." A Trip
 * outside a Combination therefore produces NO line at all, rather than a line
 * of zero. The two are different statements: a zero line claims the surcharge
 * was considered and priced at nothing, while no line says the component does
 * not apply to this transport. A breakdown is read by people, and it should not
 * imply a charge that was never in question.
 *
 * The surcharge is a flat configured amount. It is read from the context, which
 * the foundation has already resolved and validated — this step performs no
 * lookup and re-checks nothing, so a missing or unusable Setting has already
 * aborted the calculation with MissingPricingSettingException before any step
 * runs.
 *
 * All arithmetic is Decimal. Amounts are never logged.
 */
@Injectable()
export class CombinationSurchargeCalculator implements PricingCalculationStep {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(CombinationSurchargeCalculator.name);
  }

  calculate(context: PricingCalculationContext): PricingLine[] {
    this.logger.log("Combination surcharge calculation started", {
      tripId: context.tripId,
      isCombination: context.isCombination,
    });

    const lines = context.isCombination
      ? [this.surchargeLine(context.rules.combinationSurcharge)]
      : [];

    this.logger.log("Combination surcharge calculation completed", {
      tripId: context.tripId,
      isCombination: context.isCombination,
      lineCount: lines.length,
    });

    return lines;
  }

  /**
   * The configured amount, unchanged.
   *
   * No arithmetic takes place, so the surcharge reaches the breakdown exactly
   * as it was configured. Quantity and unit price stay null — a flat surcharge
   * is not charged per unit of anything.
   */
  private surchargeLine(combinationSurcharge: string): PricingLine {
    return {
      component: PricingComponentCode.COMBINATION,
      description: COMBINATION_DESCRIPTION,
      amount: toStorableAmount(new Prisma.Decimal(combinationSurcharge)),
      calculationOrder: COMBINATION_CALCULATION_ORDER,
      quantity: null,
      unitPrice: null,
      customPropertyId: null,
    };
  }
}
