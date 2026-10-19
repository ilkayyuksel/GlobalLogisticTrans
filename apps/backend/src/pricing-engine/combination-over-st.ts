import { Prisma, TripDirection } from "@prisma/client";

import type { CombinationOverStDto } from "../route-pricing/dto/route-pricing-response.dto";
import type { TripRoad } from "../route-pricing/route-matcher";
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
 * ── THE RULE, AS THE BUSINESS FIXED IT (OWNER, 19 OCTOBER 2026) ────────────
 * Over ST is owed by the SECOND leg of a pair in TIME: the Trip whose
 * planningDate is later than its partner's. It applies when all of these hold:
 *
 *   the Trip is a leg of a Combination identified by its PAIR of roads;
 *   both legs have a planningDate, and this Trip's is LATER than its
 *     partner's. On the same day neither leg owes it; the earlier leg never.
 *
 * The leg POSITION of the configuration plays no part: a pair configured with
 * its return road as Leg 1 still charges the leg driven on the later day. This
 * replaces the earlier rule (Leg 2 by configured position, and only when Over
 * ST was configured), under which the later leg could carry nothing.
 *
 * When it applies, the later leg's Tarief also carries the OVER_ST_SURCHARGE
 * Setting (70.00) once — ALWAYS, whether or not the Combination has Over ST
 * amounts configured. Its Tarief, Toll and Tunnel each carry the configured
 * Over ST amount on top of its own route price; an amount nobody filled in adds
 * nothing. All of it is produced by the calculation itself, from scratch every
 * time — never added to a stored snapshot — so a second calculation cannot add
 * it twice, and a calculation after the dates are equal again carries none of
 * it.
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
 *
 * It also says which END is the terminal — the destination of a collection,
 * the departure otherwise — because confirmed terminal aliases apply there and
 * only there (`route-matcher.ts`).
 */
export function pricingRoadOf(trip: TripReadView): TripRoad | null {
  const route = toTripRoute(trip);

  return route && route.from !== "" && route.to !== ""
    ? {
        departure: route.from,
        destination: route.to,
        terminalEnd: trip.direction === TripDirection.COLLECTION ? "destination" : "departure",
      }
    : null;
}

/** Why Over ST does or does not apply — what a log can say about it. */
export type OverStDecision =
  | { readonly applies: true; readonly amounts: PricingOverStInput }
  | {
      readonly applies: false;
      readonly reason: "DATE_MISSING" | "SAME_DAY" | "EARLIER_DAY";
    };

const ZERO = "0.00";

/** A stated amount, or zero for one nobody stated. Never null, never NaN. */
function amountOf(value: string | null): string {
  return value === null ? ZERO : new Prisma.Decimal(value).toFixed(2);
}

export function decideOverSt(
  trip: Pick<TripReadView, "planningDate">,
  partner: Pick<TripReadView, "planningDate">,
  configured: CombinationOverStDto,
): OverStDecision {
  // Both days must be known: guessing which leg is later would charge Over ST
  // on a Trip nobody scheduled.
  if (trip.planningDate === null || partner.planningDate === null) {
    return { applies: false, reason: "DATE_MISSING" };
  }

  if (trip.planningDate === partner.planningDate) {
    return { applies: false, reason: "SAME_DAY" };
  }

  // `YYYY-MM-DD` orders as text exactly as it orders as a calendar date.
  if (trip.planningDate < partner.planningDate) {
    return { applies: false, reason: "EARLIER_DAY" };
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
 * column reads the later leg's effective amount (its own + Over ST) while the
 * breakdown still shows where the addition came from. A zero adds nothing and
 * writes no line, exactly as an absent amount.
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
 * The fixed surcharge on the later leg's Tarief, once, when Over ST applies.
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
