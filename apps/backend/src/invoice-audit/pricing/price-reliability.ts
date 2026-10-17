import { CombinationMatchOutcome, RouteMatchMethod } from "@prisma/client";

import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import type { RoutableTrip } from "../../trips/trip-route";
import { describeRoutes, type RouteDescription } from "./route-description";

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
 * ── THE SYSTEM'S OWN MATCH DECIDES ──────────────────────────────────────────
 * The snapshot, its route-match record and the Trip's own group. A route the
 * matcher FOUND — EXACT, NORMALIZED, or a FUZZY match it only records for one
 * unique, uncontested candidate — is relied on as found: `Eindhout` priced on
 * `LAAKDAL (EINDHOUT)` is the system's successful match, and this check does
 * not judge the two spellings a second time (owner, October 2026). Nothing is
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
} as const;

export type PriceProblem = (typeof PriceProblem)[keyof typeof PriceProblem];

export interface PriceReliability {
  readonly reliable: boolean;
  readonly problem: PriceProblem | null;
  /** Why, in a sentence the screen and a report can carry. */
  readonly explanation: string | null;
  /** The two roads and the stored match method, for information; null without a snapshot. */
  readonly route: RouteDescription | null;
}

/** The Trip facts this judgement reads. */
export type AssessedTrip = RoutableTrip & { readonly tripGroupId: string | null };

export function assessPriceReliability(
  trip: AssessedTrip,
  pricing: CurrentTripPricing | null,
): PriceReliability {
  if (pricing === null) {
    return unreliable(PriceProblem.NO_SNAPSHOT, "De rit is nooit geprijsd.", null);
  }

  const route = describeRoutes(trip, pricing.routeMatch);
  const problem = groupProblem(trip, pricing) ?? matchProblem(pricing.routeMatch.method);

  return problem === null
    ? { reliable: true, problem: null, explanation: null, route }
    : unreliable(problem.problem, problem.explanation, route);
}

/** What the stored route match says, read as the matcher recorded it. */
function matchProblem(method: RouteMatchMethod | null): Problem | null {
  if (method === null) {
    return {
      problem: PriceProblem.METADATA_MISSING,
      explanation: "De opgeslagen prijs vermeldt niet hoe de route gevonden werd.",
    };
  }

  if (method === RouteMatchMethod.NOT_FOUND) {
    return { problem: PriceProblem.ROUTE_NOT_FOUND, explanation: "Voor de rit is geen route gevonden." };
  }

  if (method === RouteMatchMethod.AMBIGUOUS) {
    return { problem: PriceProblem.ROUTE_AMBIGUOUS, explanation: "Meerdere routes passen bij de rit." };
  }

  return null;
}

interface Problem {
  readonly problem: PriceProblem;
  readonly explanation: string;
}

/**
 * ── THE SNAPSHOT MUST AGREE WITH THE TRIP'S GROUP ──────────────────────────
 * A grouped Trip is priced on a Combination or not at all, and the Backload
 * follows membership. So a grouped Trip whose snapshot says nothing about its
 * pair, and an ungrouped one whose snapshot carries a Combination or a Backload,
 * were priced under a membership that no longer holds.
 */
function groupProblem(trip: AssessedTrip, pricing: CurrentTripPricing): Problem | null {
  const { combinationMatch, combinationRouteGroupId } = pricing.routeMatch;

  if (trip.tripGroupId) {
    if (combinationMatch === null) {
      return {
        problem: PriceProblem.SNAPSHOT_INCONSISTENT,
        explanation: "De rit hoort bij een groep, maar de opgeslagen prijs vermeldt geen combinatie.",
      };
    }

    if (
      combinationMatch !== CombinationMatchOutcome.MATCHED ||
      combinationRouteGroupId === null
    ) {
      return {
        problem: PriceProblem.COMBINATION_NOT_PRICED,
        explanation: "De combinatie van de rit is niet als combinatie geprijsd.",
      };
    }

    return null;
  }

  if (
    combinationRouteGroupId !== null ||
    combinationMatch !== null ||
    pricing.backload.greaterThan(0)
  ) {
    return {
      problem: PriceProblem.SNAPSHOT_INCONSISTENT,
      explanation: "De rit hoort bij geen groep, maar de opgeslagen prijs is voor een combinatie gemaakt.",
    };
  }

  return null;
}

function unreliable(
  problem: PriceProblem,
  explanation: string,
  route: RouteDescription | null,
): PriceReliability {
  return { reliable: false, problem, explanation, route };
}
