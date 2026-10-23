import { Prisma, TripDirection } from "@prisma/client";

import type { ManualRouteFacts } from "../pricing/manual-route-facts.reader";
import { assessPriceReliability, type PriceReliability } from "../pricing/price-reliability";
import { toCustomerRemarkParts } from "../remarks/customer-remark-vocabulary";
import type { TripRemarkFacts } from "../remarks/remark-plan";
import type { MissingTrip } from "./missing-trips.service";

/** Which of a line's two ends carries the `COMBINATION` marker. */
export type CombinationEnd = "startPoint" | "endPoint";

/**
 * A missing transport, as the line this check will add for it.
 *
 * ── LIKE ONE OF THE CUSTOMER'S OWN LINES ────────────────────────────────────
 *   Remarks         the customer's words (`tar,EC 4220981`), from the same
 *                   facts and vocabulary as a completed line
 *   COMBINATION     on the Endpoint of a leg out of the terminal, on the
 *                   Startpoint of a leg back to it — the convention of all 13
 *                   pairs of week 41 — and only for a Trip whose group holds
 *                   exactly two Trips
 *   amounts         this system's, written only when its stored price can be
 *                   relied on; otherwise the line is added EMPTY of amounts and
 *                   marked for review, never written as a price nobody stands
 *                   behind and never settled
 */
export interface AddedRow extends MissingTrip {
  /** The Remarks the line gets; empty when there is nothing to say. */
  readonly remarks: string;
  /** What could not be written in the customer's words, for the preview. */
  readonly remarkNotes: readonly string[];
  readonly combinationEnd: CombinationEnd | null;
  readonly reliability: PriceReliability;
  /**
   * The Fuel percentage the Trip's stored price was calculated at, or null for
   * a snapshot that recorded none — what its Fuel formula is written with.
   */
  readonly fuelRate: Prisma.Decimal | null;
}

export function planAddedRows(
  missing: readonly MissingTrip[],
  factsByTrip: ReadonlyMap<string, TripRemarkFacts>,
  groupSizes: ReadonlyMap<string, number>,
  manualByTrip: ReadonlyMap<string, ManualRouteFacts>,
  fuelRates: ReadonlyMap<string, Prisma.Decimal> = new Map(),
): AddedRow[] {
  const rows = missing.map((trip): AddedRow => {
    const reliability = assessPriceReliability(
      trip.trip,
      trip.pricing,
      manualByTrip.get(trip.trip.id) ?? null,
    );
    const facts = factsByTrip.get(trip.trip.id);
    const { parts, unexpressed } = toCustomerRemarkParts({
      propertyNames: reliability.reliable ? (facts?.propertyNames ?? []) : [],
      tarCharged: reliability.reliable && (facts?.tarCharged ?? false),
      ccNumbers: facts?.ccNumbers ?? [],
      waiting: facts?.waiting ?? null,
      geenCombi: false,
      extraNotes: facts?.extraNotes ?? null,
    });

    return {
      ...trip,
      remarks: parts.map((part) => part.text).join(","),
      remarkNotes: unexpressed,
      combinationEnd: combinationEndOf(trip, groupSizes),
      reliability,
      fuelRate: fuelRates.get(trip.trip.id) ?? null,
    };
  });

  return withPartnersTogether(rows);
}

/**
 * The marker a leg of an established Combination carries, or null.
 *
 * Established: the Trip's group holds exactly two Trips. A Trip without a
 * recorded direction says nothing about which leg it is, so it gets none.
 */
function combinationEndOf(
  missing: MissingTrip,
  groupSizes: ReadonlyMap<string, number>,
): CombinationEnd | null {
  const groupId = missing.trip.tripGroupId;

  if (!groupId || groupSizes.get(groupId) !== 2) {
    return null;
  }

  if (missing.trip.direction === TripDirection.DELIVERY) {
    return "endPoint";
  }

  return missing.trip.direction === TripDirection.COLLECTION ? "startPoint" : null;
}

/**
 * The two legs of a Combination that are BOTH missing go in one place, the leg
 * out of the terminal first — so the corrected document pairs them exactly as
 * the customer's own lines are paired: second leg directly below the first.
 */
function withPartnersTogether(rows: readonly AddedRow[]): AddedRow[] {
  const ordered: AddedRow[] = [];
  const placed = new Set<AddedRow>();

  for (const row of rows) {
    if (placed.has(row)) {
      continue;
    }

    const partner = row.combinationEnd
      ? rows.find(
          (other) =>
            other !== row &&
            !placed.has(other) &&
            other.combinationEnd !== null &&
            other.combinationEnd !== row.combinationEnd &&
            other.trip.tripGroupId === row.trip.tripGroupId,
        )
      : undefined;
    const legs =
      partner === undefined
        ? [row]
        : row.combinationEnd === "endPoint"
          ? [row, partner]
          : [partner, row];

    for (const leg of legs) {
      ordered.push(leg);
      placed.add(leg);
    }
  }

  return ordered;
}
