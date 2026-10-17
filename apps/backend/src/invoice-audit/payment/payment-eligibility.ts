import { TripStatus, type Trip } from "@prisma/client";

import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import { InvoicePricingStatus, type InvoiceRowPricing } from "../pricing/invoice-reconciliation";

/** How the invoice's amounts for a payable transport compared with this system's. */
export const PaymentCategory = {
  /** Every amount already agreed. */
  UNCHANGED: "UNCHANGED",
  /** At least one amount was raised in the corrected document. */
  RAISED: "RAISED",
  /**
   * The invoice states more than this system holds for at least one amount.
   * Payable — everything the transport is owed is on the invoice — but shown
   * apart, because a higher figure can point at an outdated price.
   */
  INVOICE_HIGHER: "INVOICE_HIGHER",
} as const;

export type PaymentCategory = (typeof PaymentCategory)[keyof typeof PaymentCategory];

/** Why a transport the invoice charges is not payable on it. */
export const NotPayableReason = {
  /** The Trip is not CLOSED. */
  NOT_CLOSED: "NOT_CLOSED",
  /** Only Cost Confirmation lines charge it: they never settle a transport. */
  NO_OWN_LINE: "NO_OWN_LINE",
  /** A line of it was added by this check, not stated by the customer. */
  ADDED_BY_CHECK: "ADDED_BY_CHECK",
  /** One of its lines is marked yellow. */
  LINE_MARKED: "LINE_MARKED",
  /** One of its lines was not priced reliably and completely. */
  PRICE_NOT_SETTLED: "PRICE_NOT_SETTLED",
  /** An unresolved line could be this very transport. */
  OPEN_CONFLICT: "OPEN_CONFLICT",
} as const;

export type NotPayableReason = (typeof NotPayableReason)[keyof typeof NotPayableReason];

/** One transport the invoice charges, and whether this invoice may settle it. */
export interface TripPayment {
  readonly trip: Trip;
  /** Every line of the document charging it. */
  readonly rowNumbers: readonly number[];
  readonly payable: boolean;
  /** Null when not payable. */
  readonly category: PaymentCategory | null;
  /** Empty when payable. */
  readonly reasons: readonly NotPayableReason[];
  /** Already paid: re-invoiced, and never paid a second time. */
  readonly alreadyPaid: boolean;
}

/** The pricing outcomes a line may be settled on. */
const SETTLED_PRICING_STATUSES: readonly InvoicePricingStatus[] = [
  InvoicePricingStatus.MATCHED_NO_CHANGES,
  InvoicePricingStatus.PRICING_CORRECTED,
  InvoicePricingStatus.INVOICE_HIGHER,
];

/** The line statuses that name one transport for certain. */
const RESOLVED_LINE_STATUSES: readonly InvoiceRowStatus[] = [
  InvoiceRowStatus.MATCHED,
  InvoiceRowStatus.COST_LINE,
  InvoiceRowStatus.ADDED_MISSING,
];

/**
 * Which transports this invoice may settle — see `invoice_audit.md`, "When a
 * transport is payable".
 *
 * ── THE WHOLE RULE, IN ONE PLACE ────────────────────────────────────────────
 * A transport is payable only when ALL of these hold:
 *
 *   * it has a line of the customer's OWN (MATCHED) — a Cost Confirmation line
 *     alone, or a line this check added, is never a ground;
 *   * every line charging it is resolved and of the customer's own;
 *   * the Trip is CLOSED;
 *   * every line came out UNCHANGED, RAISED or INVOICE_HIGHER — which already
 *     requires a reliable price, route evidence included;
 *   * none of its lines is marked yellow;
 *   * no unresolved line names it as a candidate.
 *
 * Deciding is all this does. Paying is a separate, confirmed step.
 */
export function assessPayments(
  matches: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  markedRowNumbers: ReadonlySet<number>,
): TripPayment[] {
  const contested = contestedTripIds(matches);

  return [...linesByTrip(matches).values()].map(({ trip, lines }) => {
    const reasons = reasonsAgainst(trip, lines, pricing, markedRowNumbers, contested);
    const payable = reasons.length === 0;

    return {
      trip,
      rowNumbers: lines.map((line) => line.row.rowNumber),
      payable,
      category: payable ? categoryOf(lines, pricing) : null,
      reasons,
      alreadyPaid: trip.isPaid,
    };
  });
}

function reasonsAgainst(
  trip: Trip,
  lines: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  markedRowNumbers: ReadonlySet<number>,
  contested: ReadonlySet<string>,
): NotPayableReason[] {
  const reasons: NotPayableReason[] = [];
  const add = (reason: NotPayableReason, applies: boolean) => {
    if (applies) {
      reasons.push(reason);
    }
  };

  add(NotPayableReason.NOT_CLOSED, trip.status !== TripStatus.CLOSED);
  add(
    NotPayableReason.NO_OWN_LINE,
    !lines.some((line) => line.status === InvoiceRowStatus.MATCHED),
  );
  add(
    NotPayableReason.ADDED_BY_CHECK,
    lines.some((line) => line.status === InvoiceRowStatus.ADDED_MISSING),
  );
  add(
    NotPayableReason.LINE_MARKED,
    lines.some((line) => markedRowNumbers.has(line.row.rowNumber)),
  );
  add(
    NotPayableReason.PRICE_NOT_SETTLED,
    lines.some((line) => !isSettled(pricing.get(line.row.rowNumber))),
  );
  add(
    NotPayableReason.OPEN_CONFLICT,
    contested.has(trip.id) || lines.some((line) => !RESOLVED_LINE_STATUSES.includes(line.status)),
  );

  return reasons;
}

function categoryOf(
  lines: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
): PaymentCategory {
  const statuses = lines.map((line) => pricing.get(line.row.rowNumber)?.status);

  if (statuses.includes(InvoicePricingStatus.INVOICE_HIGHER)) {
    return PaymentCategory.INVOICE_HIGHER;
  }

  return statuses.includes(InvoicePricingStatus.PRICING_CORRECTED)
    ? PaymentCategory.RAISED
    : PaymentCategory.UNCHANGED;
}

function isSettled(outcome: InvoiceRowPricing | undefined): boolean {
  return outcome !== undefined && SETTLED_PRICING_STATUSES.includes(outcome.status);
}

/** Every line naming a Trip, grouped per Trip, in document order. */
function linesByTrip(
  matches: readonly InvoiceRowMatch[],
): Map<string, { trip: Trip; lines: InvoiceRowMatch[] }> {
  const byTrip = new Map<string, { trip: Trip; lines: InvoiceRowMatch[] }>();

  for (const match of matches) {
    if (match.trip === null) {
      continue;
    }

    const entry = byTrip.get(match.trip.id) ?? { trip: match.trip, lines: [] };

    entry.lines.push(match);
    byTrip.set(match.trip.id, entry);
  }

  return byTrip;
}

/**
 * The Trips an unresolved line could be — the candidates of a line that found
 * several, or whose correction would reach a Trip another line already is.
 */
function contestedTripIds(matches: readonly InvoiceRowMatch[]): Set<string> {
  return new Set(
    matches
      .filter((match) => !RESOLVED_LINE_STATUSES.includes(match.status))
      .flatMap((match) => match.candidates.map((candidate) => candidate.id)),
  );
}
