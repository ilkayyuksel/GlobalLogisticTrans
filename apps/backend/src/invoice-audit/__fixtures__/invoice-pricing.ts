import { CombinationMatchOutcome, RouteMatchMethod, type Prisma } from "@prisma/client";

import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import type { RouteMatchView } from "../../trip-pricing/route-match-view";
import type { InvoiceFuelRateReader } from "../pricing/invoice-fuel-rate.reader";

/**
 * A stored price the invoice check may rely on, for tests about everything
 * ELSE: the route was found exactly, and a Trip charged a Backload was priced
 * as the Combination it is grouped in.
 *
 * Tests about reliability itself build their `routeMatch` explicitly.
 */
export const EXACT_ROUTE_MATCH: RouteMatchView = {
  method: RouteMatchMethod.EXACT,
  routePricingId: "route-1",
  combinationRouteGroupId: null,
  combinationMatch: null,
  legs: [],
  overSt: null,
  // The invoice check never reads the price-check mark of a route.
  reviewed: null,
};

export const EXACT_COMBINATION_MATCH: RouteMatchView = {
  ...EXACT_ROUTE_MATCH,
  combinationRouteGroupId: "combination-1",
  combinationMatch: CombinationMatchOutcome.MATCHED,
};

/**
 * The effective pricing as `EffectivePricingService` answers it, priced on an
 * exact route — on a Combination when it carries a Backload. A Trip given one
 * of these with a Backload must be grouped (`tripGroupId`), as in the system.
 */
export function reliablyPriced(pricing: EffectivePricing): CurrentTripPricing {
  return {
    ...pricing,
    routeMatch: pricing.backload.greaterThan(0) ? EXACT_COMBINATION_MATCH : EXACT_ROUTE_MATCH,
  };
}

/** No Trip's snapshot recorded a Fuel rate: Fuel is written as an amount. */
export const NO_FUEL_RATES = {
  findForTrips: async () => new Map<string, Prisma.Decimal>(),
} as unknown as InvoiceFuelRateReader;

/** Every Trip's snapshot recorded `rate` as its Fuel percentage. */
export function fuelRatesOf(rate: Prisma.Decimal): InvoiceFuelRateReader {
  return {
    findForTrips: async (tripIds: readonly string[]) =>
      new Map(tripIds.map((tripId) => [tripId, rate])),
  } as unknown as InvoiceFuelRateReader;
}
