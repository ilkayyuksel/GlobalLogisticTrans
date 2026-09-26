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

/** pricing_rules.md numbers the Toll fifth in the sequence. */
export const TOLL_CALCULATION_ORDER = 5;

/** Matches the wording used by the seeded pricing snapshots. */
const TOLL_DESCRIPTION = "Toll";

/**
 * Calculates the Toll — step 5 of the pricing sequence.
 *
 * ── THE ROUTE DECIDES, END TO END ───────────────────────────────────────────
 * A toll is a property of the road, not of the load. If the route a Trip drives
 * has a toll configured, that Trip pays it — there is nothing for an operator
 * to decide, and nothing for them to remember.
 *
 * ── THE ROUTE'S LENGTH TIMES ONE RATE ───────────────────────────────────────
 * The toll used to be an amount stored on each route. It is now derived:
 *
 *     Toll = the route's kilometres × the configured rate per kilometre
 *
 * The road contributes its LENGTH, which is a fact about that road and changes
 * only when the road does, and the Settings contribute the price of one
 * kilometre, which is one number for the whole business rather than an amount
 * to re-enter on every route when tolls rise.
 *
 * ── AND WHAT SILENCE MEANS ──────────────────────────────────────────────────
 * Either half missing produces NO line, rather than a line of zero — the same
 * distinction the Combination Surcharge makes. No line says nobody has stated
 * what this road costs; a zero line would claim it was considered and priced at
 * nothing. A route stated AS nought kilometres is a decision somebody made, so
 * it does produce a line, of zero.
 *
 * An operator who disagrees with the result corrects the Toll column on the
 * Ritten row — which is exactly what that override is for.
 *
 * The calculator is pure: it reads the validated context and returns a line. It
 * performs no lookup, no validation and no write.
 *
 * All arithmetic is Decimal. Amounts are never logged.
 */
@Injectable()
export class TollCalculator implements PricingCalculationStep {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(TollCalculator.name);
  }

  calculate(context: PricingCalculationContext): PricingLine[] {
    this.logger.log("Toll calculation started", { tripId: context.tripId });

    const lines = this.tollLines(context);

    this.logger.log("Toll calculation completed", {
      tripId: context.tripId,
      lineCount: lines.length,
    });

    return lines;
  }

  /**
   * The line this Trip's road produces, or none at all.
   *
   * Both halves come from the validated context — the distance was resolved
   * with the route, the rate with the rules — so this performs no lookup and
   * decides nothing about configuration.
   */
  private tollLines(context: PricingCalculationContext): PricingLine[] {
    const { routeKilometres, rules } = context;

    if (routeKilometres === null || rules.tollRatePerKm === null) {
      return [];
    }

    return [this.tollLine(routeKilometres, rules.tollRatePerKm)];
  }

  /**
   * Kilometres times the rate, as Decimal.
   *
   * ── THE LINE SHOWS ITS OWN WORKING ──────────────────────────────────────
   * `quantity` holds the distance and `unitPrice` the rate, which is what those
   * two columns are for — the waiting time stores the price of one block in the
   * same place. Two things depend on it: a breakdown can say WHY the toll is
   * what it is, and a Trip closed today keeps the rate that applied today, so
   * moving the setting tomorrow cannot restate it.
   */
  private tollLine(kilometres: string, ratePerKm: string): PricingLine {
    const distance = new Prisma.Decimal(kilometres);
    const rate = new Prisma.Decimal(ratePerKm);

    return {
      component: PricingComponentCode.TOLL,
      description: TOLL_DESCRIPTION,
      amount: toStorableAmount(distance.mul(rate)),
      calculationOrder: TOLL_CALCULATION_ORDER,
      quantity: distance,
      unitPrice: rate,
      customPropertyId: null,
    };
  }
}
