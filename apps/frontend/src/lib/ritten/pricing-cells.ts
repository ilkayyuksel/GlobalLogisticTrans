import type { PricingSnapshot } from "@/lib/api/types";
import { toPricedTripLines } from "./pricing-lines";

/**
 * The pricing columns of one Ritten row.
 *
 * ── NOTHING HERE CALCULATES A PRICE ─────────────────────────────────────────
 * Every value is one the Pricing Engine already calculated and stored. This
 * module CLASSIFIES the stored lines into the columns the operator reads —
 * reusing `pricing-lines.ts`, which the Excel export already classifies with,
 * so the table and the spreadsheet can never disagree about what "Others"
 * means.
 *
 * The total is the stored `totalPrice`, passed through as the backend spelled
 * it. It is never summed from the columns beside it: the backend's total is
 * authoritative, and a total added up in the browser would quietly become a
 * second opinion.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── EMPTY IS NOT ZERO ───────────────────────────────────────────────────────
 * A Trip with no snapshot has every cell null, and a component that did not
 * apply is null too. Only a component that was priced at zero shows `0.00`. An
 * unpriced Trip showing 0.00 would state that it costs nothing, which is a
 * different — and wrong — claim.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface PricingCells {
  /** BASE_PRICE. */
  readonly tarief: string | null;
  /** FUEL_SURCHARGE, as the amount charged rather than the percentage. */
  readonly brandstof: string | null;
  /** COMBINATION — the surcharge the operator calls Backload. */
  readonly backload: string | null;
  readonly tol: string | null;
  readonly tunnel: string | null;
  /**
   * The fixed Custom Properties, summed — TAR among them.
   *
   * TAR has no column of its own because it has no separate treatment in
   * pricing: it is one fixed property like the others, and giving it a column
   * while it is also inside this sum would show one amount twice.
   */
  readonly others: string | null;
  /** WAITING_TIME. */
  readonly ek: string | null;
  /** The stored total, verbatim. */
  readonly totaal: string | null;
}

export const NO_PRICING_CELLS: PricingCells = {
  tarief: null,
  brandstof: null,
  backload: null,
  tol: null,
  tunnel: null,
  others: null,
  ek: null,
  totaal: null,
};

/** Money as the operator reads it. Null stays null — see "empty is not zero". */
function toMoney(amount: number | null): string | null {
  return amount === null ? null : amount.toFixed(2);
}

export function toPricingCells(
  snapshot: PricingSnapshot | null | undefined,
): PricingCells {
  if (!snapshot) {
    return NO_PRICING_CELLS;
  }

  const lines = toPricedTripLines(snapshot);

  return {
    tarief: toMoney(lines.basePrice),
    brandstof: toMoney(lines.fuel),
    backload: toMoney(lines.combination),
    tol: toMoney(lines.toll),
    tunnel: toMoney(lines.tunnel),
    others: toMoney(lines.others),
    ek: toMoney(lines.waitingTime),
    // Straight from the backend. Never recomputed, never reformatted.
    totaal: snapshot.pricing.totalPrice,
  };
}

/** The snapshots of a page, by Trip id, for a table that renders many rows. */
export function toSnapshotsByTripId(
  snapshots: readonly PricingSnapshot[],
): ReadonlyMap<string, PricingSnapshot> {
  return new Map(
    snapshots.map((snapshot) => [snapshot.pricing.tripId, snapshot]),
  );
}
