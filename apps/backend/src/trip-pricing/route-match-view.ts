import {
  Prisma,
  type CombinationMatchOutcome,
  type RouteMatchMethod,
  type RouteSelectionSource,
} from "@prisma/client";

import {
  OVER_ST_DESCRIPTION,
  OVER_ST_SURCHARGE_DESCRIPTION,
} from "./over-st-lines";
import type { RouteReviewStatus } from "./route-review.repository";

/**
 * Which configured route a stored calculation was priced against.
 *
 * ── READ FROM THE SNAPSHOT, NEVER MATCHED AGAIN ─────────────────────────────
 * Everything here comes from what the calculation stored: its match method, the
 * road(s) as they were configured then, the Combination it selected, and its
 * own Over ST lines. Nothing asks the matcher, so a route configuration changed
 * or removed since cannot alter what a stored price says about itself — and a
 * snapshot older than the record says "not recorded" rather than a guess.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface RouteMatchLegView {
  /** 1 or 2 for a Combination leg; null for an ordinary route. */
  readonly legPosition: number | null;
  /** True for the leg that priced THIS Trip. */
  readonly isPricedLeg: boolean;
  readonly routePricingId: string;
  readonly departure: string;
  readonly destination: string;
  readonly method: RouteMatchMethod;
}

/** What Over ST added to this calculation, from its own stored lines. */
export interface AppliedOverStView {
  readonly applied: boolean;
  readonly tarief: Prisma.Decimal;
  readonly toll: Prisma.Decimal;
  readonly tunnel: Prisma.Decimal;
  readonly surcharge: Prisma.Decimal;
}

export interface RouteMatchView {
  /** Null on a snapshot written before the match was recorded. */
  readonly method: RouteMatchMethod | null;
  readonly routePricingId: string | null;
  readonly combinationRouteGroupId: string | null;
  /** For a grouped Trip, what became of its pair; null otherwise or unrecorded. */
  readonly combinationMatch: CombinationMatchOutcome | null;
  /** AUTOMATIC, or MANUAL when an operator's route choice priced the Trip. */
  readonly selection: RouteSelectionSource;
  readonly legs: readonly RouteMatchLegView[];
  /** Null unless a Combination priced the Trip. */
  readonly overSt: AppliedOverStView | null;
  /**
   * Whether the configuration that priced the Trip has been through an
   * administrator's price check — the Routeprijzen page's own `reviewed` mark,
   * read live (see `route-review.repository.ts`). The group's mark for a
   * Combination. Null when nothing was priced on a route, when the
   * configuration no longer exists, or when the caller did not read it.
   */
  readonly reviewed: boolean | null;
}

/** The parts of a stored snapshot the view is read from. */
export interface StoredRouteMatch {
  readonly routeMatch: RouteMatchMethod | null;
  readonly routePricingId: string | null;
  readonly combinationRouteGroupId: string | null;
  readonly combinationMatch: CombinationMatchOutcome | null;
  readonly routeSelection: RouteSelectionSource;
  readonly routeLegs: readonly {
    readonly legPosition: number | null;
    readonly isPricedLeg: boolean;
    readonly routePricingId: string;
    readonly departure: string;
    readonly destination: string;
    readonly matchMethod: RouteMatchMethod;
  }[];
  readonly items: readonly {
    readonly pricingComponent: { readonly code: string };
    readonly description: string;
    readonly amount: Prisma.Decimal;
  }[];
}

const ZERO = new Prisma.Decimal(0);

export function toRouteMatchView(
  snapshot: StoredRouteMatch,
  reviewed: boolean | null,
): RouteMatchView {
  return {
    method: snapshot.routeMatch,
    routePricingId: snapshot.routePricingId,
    combinationRouteGroupId: snapshot.combinationRouteGroupId,
    combinationMatch: snapshot.combinationMatch,
    selection: snapshot.routeSelection,
    legs: [...snapshot.routeLegs]
      .sort((left, right) => (left.legPosition ?? 0) - (right.legPosition ?? 0))
      .map((leg) => ({
        legPosition: leg.legPosition,
        isPricedLeg: leg.isPricedLeg,
        routePricingId: leg.routePricingId,
        departure: leg.departure,
        destination: leg.destination,
        method: leg.matchMethod,
      })),
    overSt:
      snapshot.combinationRouteGroupId === null ? null : appliedOverSt(snapshot.items),
    reviewed,
  };
}

/**
 * The review mark of the configuration a snapshot was priced on: its
 * Combination's when a Combination priced it, otherwise its ordinary route's.
 * Never a leg's own flag, and never a guess from the route's names.
 */
export function reviewOf(
  snapshot: Pick<StoredRouteMatch, "routePricingId" | "combinationRouteGroupId">,
  status: RouteReviewStatus,
): boolean | null {
  if (snapshot.combinationRouteGroupId !== null) {
    return status.combinations.get(snapshot.combinationRouteGroupId) ?? null;
  }

  return snapshot.routePricingId === null
    ? null
    : (status.routes.get(snapshot.routePricingId) ?? null);
}

/** The Over ST lines the Engine wrote, summed per component. */
function appliedOverSt(items: StoredRouteMatch["items"]): AppliedOverStView {
  const sumOf = (description: string, componentCode: string) =>
    items
      .filter(
        (item) =>
          item.description === description &&
          item.pricingComponent.code === componentCode,
      )
      .reduce((sum, item) => sum.plus(item.amount), ZERO);

  const surchargeLines = items.filter(
    (item) => item.description === OVER_ST_SURCHARGE_DESCRIPTION,
  );
  const overStLines = items.filter((item) => item.description === OVER_ST_DESCRIPTION);

  return {
    // Applied when the calculation wrote any of it — the surcharge line alone
    // when every Over ST amount was configured as zero.
    applied: surchargeLines.length > 0 || overStLines.length > 0,
    tarief: sumOf(OVER_ST_DESCRIPTION, "BASE_PRICE"),
    toll: sumOf(OVER_ST_DESCRIPTION, "TOLL"),
    tunnel: sumOf(OVER_ST_DESCRIPTION, "TUNNEL"),
    surcharge: sumOf(OVER_ST_SURCHARGE_DESCRIPTION, "BASE_PRICE"),
  };
}
