import type { RoadEndpoints } from "../route-pricing/route-identity";
import type { RouteMatchMethod } from "../route-pricing/route-matcher";
import type {
  PricingRouteLegTrace,
  PricingRouteMatchTrace,
} from "./pricing-calculation-context";

/**
 * What a snapshot records about the route it was priced against.
 *
 * Built from the match itself — the configurations the matcher returned, as
 * they read at that moment — so a screen can later say which road priced a
 * Trip without matching it again against today's configuration.
 */

/** A configured road as the matcher returned it. */
type ConfiguredRoad = RoadEndpoints & { readonly id: string };

/** An ordinary route, or no route at all. */
export function ordinaryRouteTrace(
  route: ConfiguredRoad | null,
  method: RouteMatchMethod,
): PricingRouteMatchTrace {
  return {
    routePricingId: route?.id ?? null,
    method,
    combinationRouteGroupId: null,
    legs: route ? [legTrace(route, null, true, method)] : [],
  };
}

/** One leg of a configured Combination, as the pair match returned it. */
export interface MatchedCombinationLeg {
  readonly leg: ConfiguredRoad & { readonly combinationLegPosition: number | null };
  readonly method: RouteMatchMethod;
}

/**
 * Both legs of the selected pair: the one that prices this Trip, and its
 * partner's — so either Trip's snapshot names the whole Combination.
 */
export function combinationTrace(
  combinationRouteGroupId: string,
  method: RouteMatchMethod,
  own: MatchedCombinationLeg,
  partner: MatchedCombinationLeg,
): PricingRouteMatchTrace {
  const legs = [
    legTrace(own.leg, own.leg.combinationLegPosition, true, own.method),
    legTrace(partner.leg, partner.leg.combinationLegPosition, false, partner.method),
  ].sort((left, right) => (left.legPosition ?? 0) - (right.legPosition ?? 0));

  return {
    routePricingId: own.leg.id,
    method,
    combinationRouteGroupId,
    legs,
  };
}

function legTrace(
  route: ConfiguredRoad,
  legPosition: number | null,
  isPricedLeg: boolean,
  method: RouteMatchMethod,
): PricingRouteLegTrace {
  return {
    legPosition,
    isPricedLeg,
    routePricingId: route.id,
    departure: route.departure,
    destination: route.destination,
    method,
  };
}
