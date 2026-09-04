import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PricingCalculationContext,
  PricingRouteCostInput,
} from "./pricing-calculation-context";
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
 * This used to take two facts: the route supplied the AMOUNT, while an assigned
 * Custom Property linked to the TOLL component supplied APPLICABILITY. That
 * made a real charge depend on somebody ticking a box, so a Trip on a tolled
 * route was silently priced without its toll whenever the box was missed. The
 * property is gone from this decision; the route answers both halves.
 *
 * A route with NO toll configured produces no line, rather than a line of
 * zero — the same distinction the Combination Surcharge makes. A zero line
 * would claim the toll was considered and priced at nothing; no line says the
 * road carries none. A route configured AS zero is a different statement and
 * does produce a line, because somebody decided it.
 *
 * The amount comes exclusively from the RouteCost, unchanged, and an operator
 * who disagrees with it corrects the Toll column on the Ritten row — which is
 * exactly what that override is for.
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

    const tollCost = this.findTollCost(context);
    const lines = tollCost ? [this.tollLine(tollCost)] : [];

    this.logger.log("Toll calculation completed", {
      tripId: context.tripId,
      lineCount: lines.length,
    });

    return lines;
  }

  /**
   * The toll configured for this Trip's route, if the route has one.
   *
   * Selected by component CODE rather than by id, so a toll cost can never be
   * mistaken for a tunnel one, and the costs are already resolved for this
   * route — the match is a comparison in memory and never a query.
   */
  private findTollCost(
    context: PricingCalculationContext,
  ): PricingRouteCostInput | null {
    return (
      context.routeCosts.find(
        (routeCost) => routeCost.componentCode === PricingComponentCode.TOLL,
      ) ?? null
    );
  }

  /**
   * The configured cost, unchanged.
   *
   * No arithmetic takes place, so the amount reaches the breakdown exactly as
   * it was configured. Quantity and unit price stay null — a toll is a flat
   * charge for the route, not a rate per unit of anything.
   *
   * The line records no reference to the Custom Property that made the toll
   * apply. The property decided applicability only; the charge is the route's,
   * and naming the property on the line would suggest the amount came from it.
   */
  private tollLine(tollCost: PricingRouteCostInput): PricingLine {
    return {
      component: PricingComponentCode.TOLL,
      description: TOLL_DESCRIPTION,
      amount: toStorableAmount(new Prisma.Decimal(tollCost.amount)),
      calculationOrder: TOLL_CALCULATION_ORDER,
      quantity: null,
      unitPrice: null,
      customPropertyId: null,
    };
  }
}
