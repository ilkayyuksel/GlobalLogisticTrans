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
 * Tunnel is route-dependent and works exactly as the Toll does: the ROUTE
 * decides both whether it applies and what it costs. A tunnel is a property of
 * the road, and a Trip that drives through one pays for it.
 *
 * It used to also require an assigned Custom Property linked to the TUNNEL
 * component, which made a real charge depend on somebody ticking a box. A Trip
 * on a tunnelled route was then priced without its tunnel whenever the box was
 * missed. That requirement is gone.
 *
 * A route with NO tunnel configured produces no line, rather than a line of
 * zero: a zero line would claim the tunnel was considered and priced at
 * nothing, while no line says the road has none. A route configured AS zero is
 * somebody's decision and does produce a line.
 *
 * The amount comes exclusively from the RouteCost, unchanged. An operator who
 * disagrees corrects the Tunnel column on the Ritten row.
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
   * The tunnel charge configured for this Trip's route, if the route has one.
   *
   * Selected by component CODE rather than by id, so a tunnel cost can never be
   * mistaken for a toll one, and the costs are already resolved for this
   * route — the match is a comparison in memory and never a query.
   */
  private findTunnelCost(
    context: PricingCalculationContext,
  ): PricingRouteCostInput | null {
    return (
      context.routeCosts.find(
        (routeCost) => routeCost.componentCode === PricingComponentCode.TUNNEL,
      ) ?? null
    );
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
