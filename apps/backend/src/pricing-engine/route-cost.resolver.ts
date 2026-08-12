import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../logger/app-logger.service";
import { RouteCostService } from "../route-costs/route-cost.service";
import {
  PricingRouteCostInput,
  PricingRouteIdentity,
} from "./pricing-calculation-context";

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

  async resolve(
    tripId: string,
    route: PricingRouteIdentity,
  ): Promise<PricingRouteCostInput[]> {
    // `trip.terminal` is nullable, and route costs are matched on it. Without a
    // departure there is no route identity to match, so nothing can be
    // resolved — which is different from a route that resolved to nothing.
    if (route.departure === null) {
      this.logger.warn("Trip has no terminal, so no route cost can be matched", {
        tripId,
      });

      return [];
    }

    const routeCosts = await this.routeCostService.findActiveForRoute(
      route.departure,
      route.destination,
    );

    this.logger.log("Route costs resolved", {
      tripId,
      routeCostCount: routeCosts.length,
      components: routeCosts.map((cost) => cost.pricingComponent.code),
    });

    return routeCosts.map((cost) => ({
      routeCostId: cost.id,
      pricingComponentId: cost.pricingComponentId,
      componentCode: cost.pricingComponent.code,
      amount: cost.amount,
    }));
  }
}
