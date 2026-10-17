import {
  CombinationVerdict,
  InvoiceRowStatus,
  type InvoiceRowMatch,
} from "../matching/invoice-row-match";
import {
  InvoicePricingStatus,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import {
  toCustomerRemarkParts,
  type RemarkFacts,
} from "./customer-remark-vocabulary";
import {
  isStated,
  toRemarkParts,
  toStatedCcNumbers,
  withRemarkParts,
} from "./remark-parts";

/** What one row's Remarks become. */
export interface RemarkChange {
  readonly rowNumber: number;
  readonly before: string;
  /** The text the cell will hold; equal to `before` when nothing is added. */
  readonly after: string;
  /** The parts added, in order. */
  readonly added: readonly string[];
  /** What a person should know: an unexpressed waiting time, a new word. */
  readonly notes: readonly string[];
}

/** The facts of a Trip, apart from its Combination, which the match decides. */
export type TripRemarkFacts = Omit<RemarkFacts, "geenCombi">;

/** Pricing outcomes on which a Trip's own facts may be written. */
const RELIABLE_PRICING: readonly InvoicePricingStatus[] = [
  InvoicePricingStatus.MATCHED_NO_CHANGES,
  InvoicePricingStatus.PRICING_CORRECTED,
  InvoicePricingStatus.INVOICE_HIGHER,
];

/**
 * What the Remarks of each Trip's own line should add.
 *
 * ── ONE ROW PER TRIP, AND ONLY ITS OWN ──────────────────────────────────────
 * The Trip's first transport line receives what is missing — never a Cost
 * Confirmation line, never a second split row, never another Trip's line. A
 * part the customer already wrote anywhere on that line counts as there, and a
 * confirmation counts as there when ANY row of the same Trip names it.
 *
 * ── ONLY WHAT IS RELIABLE ───────────────────────────────────────────────────
 * The Trip's own facts (properties, TAR, confirmations, waiting time) are only
 * written on a line whose match and price could be relied on. `GEEN COMBI`
 * depends only on the pair, which was itself established from two reliably
 * matched Trips, so it is written even on a line marked for its price.
 *
 * Running it twice changes nothing the second time: everything it added is then
 * stated.
 */
export function planRemarks(
  matches: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  factsByTrip: ReadonlyMap<string, TripRemarkFacts>,
): Map<number, RemarkChange> {
  const changes = new Map<number, RemarkChange>();

  for (const [tripId, rows] of rowsByTrip(matches)) {
    const own = rows.find(isOwnLine);

    if (own === undefined) {
      continue;
    }

    const change = planRow(own, rows, pricing.get(own.row.rowNumber), factsByTrip.get(tripId));

    if (change !== null) {
      changes.set(own.row.rowNumber, change);
    }
  }

  return changes;
}

function planRow(
  own: InvoiceRowMatch,
  tripRows: readonly InvoiceRowMatch[],
  outcome: InvoiceRowPricing | undefined,
  facts: TripRemarkFacts | undefined,
): RemarkChange | null {
  const reliable = outcome !== undefined && RELIABLE_PRICING.includes(outcome.status);
  const geenCombi = tripRows.some((match) => match.combination?.verdict === CombinationVerdict.GEEN_COMBI);
  const { parts, unexpressed } = toCustomerRemarkParts({
    propertyNames: reliable ? (facts?.propertyNames ?? []) : [],
    tarCharged: reliable && (facts?.tarCharged ?? false),
    ccNumbers: reliable ? (facts?.ccNumbers ?? []) : [],
    waiting: reliable ? (facts?.waiting ?? null) : null,
    geenCombi,
  });
  const stated = toRemarkParts(own.row.remarks);
  const ccNumbersOnTrip = new Set(tripRows.flatMap((match) => toStatedCcNumbers(match.row.remarks)));
  const missing = parts.filter((part) => !isStated(part, stated, ccNumbersOnTrip));
  /*
   * A property name is written whether or not this invoice has used the word
   * before: a Custom Property is valid without the customer having seen it, so
   * a new word is no reason for a note (owner, October 2026).
   */
  const notes = [...unexpressed];

  if (missing.length === 0 && notes.length === 0) {
    return null;
  }

  const added = missing.map((part) => part.text);

  return {
    rowNumber: own.row.rowNumber,
    before: own.row.remarks,
    after: withRemarkParts(own.row.remarks, added),
    added,
    notes,
  };
}

/** A Trip's own transport line: matched, or one this system added before. */
function isOwnLine(match: InvoiceRowMatch): boolean {
  return (
    match.row.costLine === null &&
    (match.status === InvoiceRowStatus.MATCHED || match.status === InvoiceRowStatus.ADDED_MISSING)
  );
}

function rowsByTrip(matches: readonly InvoiceRowMatch[]): Map<string, InvoiceRowMatch[]> {
  const byTrip = new Map<string, InvoiceRowMatch[]>();

  for (const match of matches) {
    if (match.trip !== null) {
      byTrip.set(match.trip.id, [...(byTrip.get(match.trip.id) ?? []), match]);
    }
  }

  return byTrip;
}
