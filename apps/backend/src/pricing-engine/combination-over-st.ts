import { Prisma } from "@prisma/client";

import type { CombinationOverStDto } from "../route-pricing/dto/route-pricing-response.dto";
import type { RoadEndpoints } from "../route-pricing/route-identity";
import {
  OVER_ST_DESCRIPTION,
  OVER_ST_SURCHARGE_DESCRIPTION,
} from "../trip-pricing/over-st-lines";
import { toTripRoute } from "../trips/trip-route";
import type { TripReadView } from "../trips/trip-read.service";
import type { PricingOverStInput } from "./pricing-calculation-context";
import { PricingComponentCode, type PricingLine } from "./pricing-line";
import { toStorableAmount } from "./pricing-money";

/**
 * Over ST: which road a Trip drives, and whether its Combination owes Over ST.
 *
 * ── THE RULE, AS THE BUSINESS FIXED IT ──────────────────────────────────────
 * A Combination configuration may carry Over ST — a Tarief, a Toll and a
 * Tunnel of its own. It applies to LEG 2 only, and only when all of these
 * hold:
 *
 *   the Trip is a leg of a Combination identified by its PAIR of roads;
 *   both legs have a planningDate, and Leg 2's differs from Leg 1's;
 *   the Combination has Over ST configured — at least one of the three filled
 *     in; 0.00 counts as filled in, all three empty does not.
 *
 * When it applies, Leg 2's Tarief, Toll and Tunnel each carry the configured
 * Over ST amount on top of Leg 2's own route price, and Leg 2's Tarief also
 * carries the OVER_ST_SURCHARGE Setting (70.00) once. All of it is produced by
 * the calculation itself, from scratch every time — never added to a stored
 * snapshot — so a second calculation cannot add it twice, and a calculation
 * after the dates are equal again carries none of it.
 *
 * `planningDate` and nothing else: never the original planning date. Both are
 * calendar dates (`YYYY-MM-DD`) on the read side, so no time zone reaches the
 * comparison.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The road a Trip is priced on: its real driving direction.
 *
 * A DELIVERY drives terminal → city; a COLLECTION drives city → terminal — the
 * same reading the Ritten list and the customer's price list use (`AALST ->
 * Quay 869`). A Trip with no direction reads terminal → city, as it always
 * did. Null without both ends: there is no road to match.
 */
export function pricingRoadOf(trip: TripReadView): RoadEndpoints | null {
  const route = toTripRoute(trip);

  return route && route.from !== "" && route.to !== ""
    ? { departure: route.from, destination: route.to }
    : null;
}

/** The other Trip of this Trip's genuine Combination, or null. */
export function partnerOf(
  trip: TripReadView,
  members: readonly TripReadView[],
): TripReadView | null {
  return (
    members.find(
      (member) =>
        member.id !== trip.id &&
        member.tripGroupId === trip.tripGroupId &&
        member.pdfDocumentId === trip.pdfDocumentId,
    ) ?? null
  );
}

/** Why Over ST does or does not apply — what a log can say about it. */
export type OverStDecision =
  | { readonly applies: true; readonly amounts: PricingOverStInput }
  | {
      readonly applies: false;
      readonly reason: "NOT_LEG_2" | "DATE_MISSING" | "SAME_DAY" | "NOT_CONFIGURED";
    };

const ZERO = "0.00";

/** A stated amount, or zero for one nobody stated. Never null, never NaN. */
function amountOf(value: string | null): string {
  return value === null ? ZERO : new Prisma.Decimal(value).toFixed(2);
}

export function decideOverSt(
  legPosition: number | null,
  trip: TripReadView,
  partner: TripReadView,
  configured: CombinationOverStDto,
): OverStDecision {
  if (legPosition !== 2) {
    return { applies: false, reason: "NOT_LEG_2" };
  }

  // Both days must be known: guessing that a missing one "differs" would
  // charge Over ST on a Trip nobody scheduled.
  if (trip.planningDate === null || partner.planningDate === null) {
    return { applies: false, reason: "DATE_MISSING" };
  }

  if (trip.planningDate === partner.planningDate) {
    return { applies: false, reason: "SAME_DAY" };
  }

  if (configured.tarief === null && configured.toll === null && configured.tunnel === null) {
    return { applies: false, reason: "NOT_CONFIGURED" };
  }

  return {
    applies: true,
    amounts: {
      tarief: amountOf(configured.tarief),
      toll: amountOf(configured.toll),
      tunnel: amountOf(configured.tunnel),
    },
  };
}

export { OVER_ST_DESCRIPTION, OVER_ST_SURCHARGE_DESCRIPTION } from "../trip-pricing/over-st-lines";

/**
 * The Over ST line one pricing step adds, or none.
 *
 * Its own line, under the step's OWN component — Tarief, Toll or Tunnel — so the
 * column reads Leg 2's effective amount (Leg 2 + Over ST) while the breakdown
 * still shows where the addition came from. A zero adds nothing and writes no
 * line, exactly as an absent amount.
 */
export function overStLine(
  component: PricingComponentCode,
  amount: string | undefined,
  calculationOrder: number,
  description: string = OVER_ST_DESCRIPTION,
): PricingLine[] {
  if (amount === undefined) {
    return [];
  }

  const value = new Prisma.Decimal(amount);

  if (value.isZero()) {
    return [];
  }

  return [
    {
      component,
      description,
      amount: toStorableAmount(value),
      calculationOrder,
      quantity: null,
      unitPrice: null,
      customPropertyId: null,
    },
  ];
}

/**
 * The fixed surcharge on Leg 2's Tarief, once, when Over ST applies.
 *
 * Part of the Tarief — a BASE_PRICE line — so the fuel on it follows exactly
 * as it follows the rest of the Tarief.
 */
export function overStSurchargeLine(
  overSt: PricingOverStInput | null,
  surcharge: string,
  calculationOrder: number,
): PricingLine[] {
  return overSt === null
    ? []
    : overStLine(
        PricingComponentCode.BASE_PRICE,
        surcharge,
        calculationOrder,
        OVER_ST_SURCHARGE_DESCRIPTION,
      );
}
