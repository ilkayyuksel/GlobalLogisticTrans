import type { Prisma } from "@prisma/client";

import { FAILED_CALCULATION_STATUS, PRICED_TRIP_STATUS } from "./current-pricing";

/** The configurations whose prices nobody has checked yet — see `RouteReviewRepository`. */
export interface UnreviewedConfigurations {
  /** Ordinary routes not marked as checked. A Combination leg is never here. */
  readonly routePricingIds: readonly string[];
  /** Combinations not marked as checked: a Combination is checked as a whole. */
  readonly combinationRouteGroupIds: readonly string[];
}

/**
 * The Trips whose route or route price needs attention — the Ritten list's
 * "Route nakijken" filter.
 *
 * ── ONE OF TWO REASONS, READ FROM THE CURRENT PRICE ─────────────────────────
 * Only the Trip's CURRENT price counts (`current-pricing.ts`): a CLOSED Trip
 * whose snapshot is not FAILED. A reopened Trip's old snapshot, or one a later
 * calculation failed to replace, says nothing about its route now — and a
 * failed calculation is not a missing route.
 *
 *   NO USABLE ROUTE   the calculation recorded how it matched (`route_match`)
 *                     and priced no route at all (`route_pricing_id` null):
 *                     NOT_FOUND, AMBIGUOUS, or a grouped Trip whose pair is no
 *                     configured Combination. A route an operator CHOSE is a
 *                     route (`route_pricing_id` set), so it is never here. A
 *                     snapshot from before the match was recorded
 *                     (`route_match` null) is not called unmatched either.
 *   PRICE UNCHECKED   it was priced on a route whose prices are not marked as
 *                     checked on the Routeprijzen page: the Combination's own
 *                     mark when a Combination priced it, never a leg's; the
 *                     route's mark otherwise.
 *
 * One condition on the Trip itself, so a Trip is listed once whatever holds,
 * and it narrows the whole result in the database — paging, counts and the
 * day sections stay right. Nothing is matched or priced here.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function routeAttentionWhere(unreviewed: UnreviewedConfigurations): Prisma.TripWhereInput {
  return {
    status: PRICED_TRIP_STATUS,
    pricing: {
      is: {
        calculationStatus: { not: FAILED_CALCULATION_STATUS },
        OR: [
          { routePricingId: null, routeMatch: { not: null } },
          {
            routePricingId: { not: null },
            combinationRouteGroupId: { in: [...unreviewed.combinationRouteGroupIds] },
          },
          {
            combinationRouteGroupId: null,
            routePricingId: { in: [...unreviewed.routePricingIds] },
          },
        ],
      },
    },
  };
}
