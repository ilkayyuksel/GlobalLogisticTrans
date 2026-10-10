import { Prisma, type RouteMatchMethod } from "@prisma/client";

import {
  OVER_ST_DESCRIPTION,
  OVER_ST_SURCHARGE_DESCRIPTION,
} from "./over-st-lines";

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
  readonly legs: readonly RouteMatchLegView[];
  /** Null unless a Combination priced the Trip. */
  readonly overSt: AppliedOverStView | null;
}

/** The parts of a stored snapshot the view is read from. */
export interface StoredRouteMatch {
  readonly routeMatch: RouteMatchMethod | null;
  readonly routePricingId: string | null;
  readonly combinationRouteGroupId: string | null;
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

export function toRouteMatchView(snapshot: StoredRouteMatch): RouteMatchView {
  return {
    method: snapshot.routeMatch,
    routePricingId: snapshot.routePricingId,
    combinationRouteGroupId: snapshot.combinationRouteGroupId,
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
  };
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
