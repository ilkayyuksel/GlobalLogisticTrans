import { Prisma } from "@prisma/client";

import type { CombinationOverStDto } from "../route-pricing/dto/route-pricing-response.dto";
import { isSameRoad, type RoadEndpoints } from "../route-pricing/route-identity";
import type { TripReadView } from "../trips/trip-read.service";
import type { PricingOverStInput } from "./pricing-calculation-context";
import type { PricingComponentCode, PricingLine } from "./pricing-line";
import { toStorableAmount } from "./pricing-money";

/**
 * Over ST: which Combination a Trip belongs to, and whether it owes Over ST.
 *
 * ── THE RULE, AS THE BUSINESS FIXED IT ──────────────────────────────────────
 * A Combination configuration carries Over ST — a Tarief, a Toll and a Tunnel
 * of its own. It is charged on LEG 2 only, and only when Leg 2's planning date
 * differs from Leg 1's:
 *
 *   same planningDate       → no Over ST, whatever is configured
 *   different planningDate  → Over ST added to Leg 2, component by component
 *
 * `planningDate` and nothing else: not the original planning date, not a
 * document date. Leg 1 is never charged Over ST.
 *
 * ── WHICH COMBINATION ───────────────────────────────────────────────────────
 * Over ST belongs to ONE configuration, so it can only be read once the Trip's
 * Combination is known exactly: by the PAIR of roads its two Trips drive — the
 * same identity (`isSameCombination`) that keeps a pair from being configured
 * twice. A road alone may be a leg of many Combinations and cannot say which.
 *
 * Pure: it reads Trips and a configuration and returns a value. No query.
 */

/** The road a Trip drives, as configurations are matched: terminal → city. */
export function roadOf(trip: TripReadView): RoadEndpoints | null {
  return trip.terminal && trip.destinationCity
    ? { departure: trip.terminal, destination: trip.destinationCity }
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

/** The configured leg this Trip's road is, among the Combination's two. */
export function legFor<TLeg extends RoadEndpoints>(
  road: RoadEndpoints,
  legs: readonly TLeg[],
): TLeg | null {
  return legs.find((leg) => isSameRoad(leg, road)) ?? null;
}

/**
 * Whether the two planning dates differ.
 *
 * Both must be known: a Trip with no planning date has no day to compare, and
 * guessing that it "differs" would charge Over ST on a Trip nobody scheduled.
 */
export function isOnDifferentDay(
  trip: TripReadView,
  partner: TripReadView,
): boolean {
  return (
    trip.planningDate !== null &&
    partner.planningDate !== null &&
    trip.planningDate !== partner.planningDate
  );
}

const ZERO = "0.00";

/** A stated amount, or zero for one nobody stated. Never null, never NaN. */
function amountOf(value: string | null): string {
  return value === null ? ZERO : new Prisma.Decimal(value).toFixed(2);
}

/**
 * The Over ST this Trip owes, or null when it owes none.
 *
 * Null for Leg 1, and for Leg 2 on the same day as Leg 1. Otherwise the three
 * configured amounts, an unstated one as zero.
 */
export function overStOwed(
  legPosition: number | null,
  trip: TripReadView,
  partner: TripReadView,
  configured: CombinationOverStDto,
): PricingOverStInput | null {
  if (legPosition !== 2 || !isOnDifferentDay(trip, partner)) {
    return null;
  }

  return {
    tarief: amountOf(configured.tarief),
    toll: amountOf(configured.toll),
    tunnel: amountOf(configured.tunnel),
  };
}

/** How an Over ST line names itself in a breakdown, whatever its component. */
export const OVER_ST_DESCRIPTION = "Over ST";

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
      description: OVER_ST_DESCRIPTION,
      amount: toStorableAmount(value),
      calculationOrder,
      quantity: null,
      unitPrice: null,
      customPropertyId: null,
    },
  ];
}
