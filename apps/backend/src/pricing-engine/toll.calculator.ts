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
 * Toll is route-dependent, so two independent facts decide it. Whether it
 * APPLIES comes from the Trip: an assigned Custom Property linked to the TOLL
 * component. How MUCH comes from the route: the active RouteCost for that
 * component on this Trip's route. Neither half can answer for the other, which
 * is why the two live in different tables.
 *
 * A Trip that was never assigned the property produces NO line, rather than a
 * line of zero — the same distinction the Combination Surcharge makes. A zero
 * line would claim the toll was considered and priced at nothing; no line says
 * the component does not apply to this transport.
 *
 * The opposite case — the property assigned but the route cost missing — is a
 * configuration error and never reaches this calculator: the Engine validates
 * it while building the context and refuses the calculation there. That check
 * is deliberately component-agnostic, so it covers every route-priced component
 * rather than only this one.
 *
 * The amount comes exclusively from the RouteCost. A property linked to a
 * component carries no price of its own — the database enforces that its
 * default price is null — so there is nothing else it could come from.
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
   * The route's toll cost, but only when this Trip actually carries the toll.
   *
   * The two are matched on the component id rather than on a name: the route
   * cost names the component it prices, and the assigned property names the
   * component it makes applicable. When those are the same component, the Trip
   * owes that cost.
   *
   * Both lists are already resolved for this Trip and this route, so the match
   * is a comparison in memory and never a query.
   */
  private findTollCost(
    context: PricingCalculationContext,
  ): PricingRouteCostInput | null {
    const tollCost = context.routeCosts.find(
      (routeCost) => routeCost.componentCode === PricingComponentCode.TOLL,
    );

    if (!tollCost) {
      return null;
    }

    const applies = context.assignedCustomProperties.some(
      (property) => property.pricingComponentId === tollCost.pricingComponentId,
    );

    return applies ? tollCost : null;
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
