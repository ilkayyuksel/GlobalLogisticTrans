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

/** pricing_rules.md numbers the Tunnel sixth in the sequence. */
export const TUNNEL_CALCULATION_ORDER = 6;

/** Matches the wording used for the other route-dependent components. */
const TUNNEL_DESCRIPTION = "Tunnel";

/**
 * Calculates the Tunnel charge — step 6 of the pricing sequence.
 *
 * Tunnel is route-dependent and works exactly as the Toll does. Whether it
 * APPLIES comes from the Trip: an assigned Custom Property linked to the TUNNEL
 * component. How MUCH comes from the route: the active RouteCost for that
 * component. Neither half can answer for the other, which is why the two live
 * in different tables.
 *
 * A Trip that was never assigned the property produces NO line, rather than a
 * line of zero — even when the route has a tunnel cost configured. A zero line
 * would claim the tunnel was considered and priced at nothing; no line says the
 * component does not apply to this transport.
 *
 * The opposite case — the property assigned but the route cost missing or
 * deactivated — is a configuration error and never reaches this calculator. The
 * Engine validates the pairing while building the context and refuses there
 * with PRICING_MISSING_ROUTE_COST. That check is component-agnostic and already
 * covers TUNNEL, so this calculator deliberately adds no validation of its own:
 * a second, Tunnel-specific check could only disagree with the first.
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
export class TunnelCalculator implements PricingCalculationStep {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(TunnelCalculator.name);
  }

  calculate(context: PricingCalculationContext): PricingLine[] {
    this.logger.log("Tunnel calculation started", { tripId: context.tripId });

    const tunnelCost = this.findTunnelCost(context);
    const lines = tunnelCost ? [this.tunnelLine(tunnelCost)] : [];

    this.logger.log("Tunnel calculation completed", {
      tripId: context.tripId,
      lineCount: lines.length,
    });

    return lines;
  }

  /**
   * The route's tunnel cost, but only when this Trip actually carries it.
   *
   * The two are matched on the component id rather than on a name: the route
   * cost names the component it prices, and the assigned property names the
   * component it makes applicable. When those are the same component, the Trip
   * owes that cost. A property renamed in the catalog therefore changes
   * nothing, and a toll cost can never be mistaken for a tunnel one.
   *
   * Both lists are already resolved for this Trip and this route, so the match
   * is a comparison in memory and never a query.
   */
  private findTunnelCost(
    context: PricingCalculationContext,
  ): PricingRouteCostInput | null {
    const tunnelCost = context.routeCosts.find(
      (routeCost) => routeCost.componentCode === PricingComponentCode.TUNNEL,
    );

    if (!tunnelCost) {
      return null;
    }

    const applies = context.assignedCustomProperties.some(
      (property) =>
        property.pricingComponentId === tunnelCost.pricingComponentId,
    );

    return applies ? tunnelCost : null;
  }

  /**
   * The configured cost, unchanged.
   *
   * No arithmetic takes place, so the amount reaches the breakdown exactly as
   * it was configured. Quantity and unit price stay null — a tunnel charge is
   * flat for the route, not a rate per unit of anything.
   *
   * The line records no reference to the Custom Property that made the tunnel
   * apply. The property decided applicability only; the charge is the route's,
   * and naming the property on the line would suggest the amount came from it.
   */
  private tunnelLine(tunnelCost: PricingRouteCostInput): PricingLine {
    return {
      component: PricingComponentCode.TUNNEL,
      description: TUNNEL_DESCRIPTION,
      amount: toStorableAmount(new Prisma.Decimal(tunnelCost.amount)),
      calculationOrder: TUNNEL_CALCULATION_ORDER,
      quantity: null,
      unitPrice: null,
      customPropertyId: null,
    };
  }
}
