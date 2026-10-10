import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { RouteCostService } from "../route-costs/route-cost.service";
import { RouteConfigurationKind } from "../route-pricing/route-pricing.repository";
import { PricingRouteCostInput } from "./pricing-calculation-context";
import { MatchedRouteConfiguration } from "./pricing-component.resolver";

/**
 * Resolves the route-dependent costs configured for a Trip's route.
 *
 * One responsibility, and a narrow one: given a route, return every active
 * RouteCost on it. It does not decide which of them apply — that depends on the
 * Trip's assigned Custom Properties and belongs to a calculator — and it does
 * not add anything up.
 *
 * A route with nothing configured is not an error here. Whether a missing cost
 * is acceptable depends on whether the Trip actually carries that component,
 * which this resolver cannot see. Failing here would make every Trip on an
 * unconfigured route unpriceable, including the ones that owe no toll at all.
 *
 * Amounts are never logged. Only identifiers and counts appear in the log.
 */
@Injectable()
export class RouteCostResolver {
  constructor(
    private readonly routeCostService: RouteCostService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(RouteCostResolver.name);
  }

  /**
   * `matchedRoute` is the configuration this Trip was priced against.
   *
   * ── WHY THE COSTS FOLLOW THE MATCH ────────────────────────────────────────
   * The Tarief, the Toll and the Tunnel of one Trip come from ONE matched
   * configuration, never from three separate lookups:
   *
   *   a Combination leg OWNS its costs — the road it runs may also be an
   *     ordinary route with a tunnel of its own — so they are read by its id;
   *   an ordinary route's costs are read by the CONFIGURED road, as stored, so
   *     a Trip matched despite a typo or a difference in letter case still finds
   *     the costs of the route that priced its Tarief;
   *   no match, no costs: nothing reliable was found, and the Toll and Tunnel
   *     follow the Tarief to zero rather than come from a guess.
   */
  async resolve(
    tripId: string,
    matchedRoute: MatchedRouteConfiguration | null,
  ): Promise<PricingRouteCostInput[]> {
    if (!matchedRoute) {
      this.logger.log("No route matched, so no route cost applies", { tripId });

      return [];
    }

    if (matchedRoute.kind === RouteConfigurationKind.COMBINATION) {
      return this.resolveOwnedBy(tripId, matchedRoute.routePricingId);
    }

    const routeCosts = await this.routeCostService.findActiveForRoute(
      matchedRoute.departure,
      matchedRoute.destination,
    );

    this.logger.log("Route costs resolved", {
      tripId,
      routePricingId: matchedRoute.routePricingId,
      routeCostCount: routeCosts.length,
      components: routeCosts.map((cost) => cost.pricingComponent.code),
    });

    return routeCosts.map((cost) => toInput(cost));
  }

  /** The costs configured for one Combination leg, found by the leg itself. */
  private async resolveOwnedBy(
    tripId: string,
    routePricingId: string,
  ): Promise<PricingRouteCostInput[]> {
    const routeCosts =
      await this.routeCostService.findActiveForRoutePricing(routePricingId);

    this.logger.log("Combination leg route costs resolved", {
      tripId,
      routePricingId,
      routeCostCount: routeCosts.length,
      components: routeCosts.map((cost) => cost.pricingComponent.code),
    });

    return routeCosts.map((cost) => toInput(cost));
  }
}

/** One stored cost, as the calculation phase reads it. */
function toInput(cost: {
  id: string;
  pricingComponentId: string;
  pricingComponent: { code: string };
  amount: string;
}): PricingRouteCostInput {
  return {
    routeCostId: cost.id,
    pricingComponentId: cost.pricingComponentId,
    componentCode: cost.pricingComponent.code,
    amount: cost.amount,
  };
}
