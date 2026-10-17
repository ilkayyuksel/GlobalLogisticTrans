import { CombinationMatchOutcome, RouteMatchMethod } from "@prisma/client";

import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import type { RoutableTrip } from "../../trips/trip-route";
import { assessRouteEvidence, type RouteEvidence } from "./route-evidence";

/**
 * Whether a Trip's STORED price may be compared with — and written into — the
 * customer's invoice.
 *
 * ── A PRICE NOBODY CAN STAND BEHIND IS NOT €0 ───────────────────────────────
 * A Trip whose route was not found is priced at zero by the Engine. Reading
 * that zero as "this transport costs nothing" would, under the old rule, have
 * overwritten the customer's 312,00 with 0,00 and settled the Trip. So every
 * reason below makes the line UNRELIABLE: it is marked for review, nothing on
 * it is written, and it is never settled.
 *
 * ── EVERYTHING IS READ FROM WHAT WAS STORED ─────────────────────────────────
 * The snapshot, its route-match record and the Trip's own group. Nothing is
 * matched again and nothing is priced again; a snapshot this module distrusts
 * is reported, and repricing it is somebody else's explicit decision.
 */
export const PriceProblem = {
  /** The Trip has never been priced. */
  NO_SNAPSHOT: "NO_SNAPSHOT",
  /** The snapshot predates the route-match record: nothing says how it was priced. */
  METADATA_MISSING: "METADATA_MISSING",
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  ROUTE_AMBIGUOUS: "ROUTE_AMBIGUOUS",
  /** A grouped Trip whose Combination was not priced as one. */
  COMBINATION_NOT_PRICED: "COMBINATION_NOT_PRICED",
  /** The snapshot contradicts the Trip's group membership: it is out of date. */
  SNAPSHOT_INCONSISTENT: "SNAPSHOT_INCONSISTENT",
  /** The recorded road cannot be shown to be a safe match for the Trip's road. */
  ROUTE_NOT_EVIDENCED: "ROUTE_NOT_EVIDENCED",
} as const;

export type PriceProblem = (typeof PriceProblem)[keyof typeof PriceProblem];

export interface PriceReliability {
  readonly reliable: boolean;
  readonly problem: PriceProblem | null;
  /** Why, in a sentence a log and a report can carry. */
  readonly explanation: string | null;
  /** What the snapshot proves about the road; null when it was not examined. */
  readonly evidence: RouteEvidence | null;
}

/** The Trip facts this judgement reads. */
export type AssessedTrip = RoutableTrip & { readonly tripGroupId: string | null };

export function assessPriceReliability(
  trip: AssessedTrip,
  pricing: CurrentTripPricing | null,
): PriceReliability {
  if (pricing === null) {
    return unreliable(PriceProblem.NO_SNAPSHOT, "the Trip has never been priced", null);
  }

  const group = groupProblem(trip, pricing);

  if (group !== null) {
    return group;
  }

  const { method } = pricing.routeMatch;

  if (method === null) {
    return unreliable(
      PriceProblem.METADATA_MISSING,
      "the stored price does not record how its route was matched",
      null,
    );
  }

  if (method === RouteMatchMethod.NOT_FOUND) {
    return unreliable(PriceProblem.ROUTE_NOT_FOUND, "no route was found for the Trip", null);
  }

  if (method === RouteMatchMethod.AMBIGUOUS) {
    return unreliable(PriceProblem.ROUTE_AMBIGUOUS, "several routes matched the Trip", null);
  }

  const evidence = assessRouteEvidence(trip, pricing.routeMatch);

  if (!evidence.reliable) {
    return unreliable(
      PriceProblem.ROUTE_NOT_EVIDENCED,
      `the Trip ${evidence.tripRoute ?? "(no road)"} was priced on ${evidence.pricedRoute ?? "(no recorded road)"}, which the stored data does not show to be the same road (${evidence.relation})`,
      evidence,
    );
  }

  return { reliable: true, problem: null, explanation: null, evidence };
}

/**
 * ── THE SNAPSHOT MUST AGREE WITH THE TRIP'S GROUP ──────────────────────────
 * A grouped Trip is priced on a Combination or not at all, and the Backload
 * follows membership. So a grouped Trip whose snapshot says nothing about its
 * pair, and an ungrouped one whose snapshot carries a Combination or a Backload,
 * were priced under a membership that no longer holds.
 */
function groupProblem(
  trip: AssessedTrip,
  pricing: CurrentTripPricing,
): PriceReliability | null {
  const { combinationMatch, combinationRouteGroupId } = pricing.routeMatch;

  if (trip.tripGroupId) {
    if (combinationMatch === null) {
      return unreliable(
        PriceProblem.SNAPSHOT_INCONSISTENT,
        "the Trip belongs to a group, but its stored price records no Combination",
        null,
      );
    }

    if (
      combinationMatch !== CombinationMatchOutcome.MATCHED ||
      combinationRouteGroupId === null
    ) {
      return unreliable(
        PriceProblem.COMBINATION_NOT_PRICED,
        `the Trip's Combination was not priced (${combinationMatch})`,
        null,
      );
    }

    return null;
  }

  if (
    combinationRouteGroupId !== null ||
    combinationMatch !== null ||
    pricing.backload.greaterThan(0)
  ) {
    return unreliable(
      PriceProblem.SNAPSHOT_INCONSISTENT,
      "the Trip belongs to no group, but its stored price was made for a Combination",
      null,
    );
  }

  return null;
}

function unreliable(
  problem: PriceProblem,
  explanation: string,
  evidence: RouteEvidence | null,
): PriceReliability {
  return { reliable: false, problem, explanation, evidence };
}
