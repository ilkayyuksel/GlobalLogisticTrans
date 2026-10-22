import { TripStatus, type Trip } from "@prisma/client";

import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import { InvoicePricingStatus, type InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import { UnresolvedClaim, claimsByTrip, type TripClaims } from "./unresolved-line-claims";

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
  /**
   * A transport the invoice did not state, added to the corrected document
   * with a price this system relies on — see `missing-trip-payments.ts`.
   */
  ADDED: "ADDED",
} as const;

export type PaymentCategory = (typeof PaymentCategory)[keyof typeof PaymentCategory];

/** Why a transport the invoice charges is not payable on it. */
export const NotPayableReason = {
  /** The Trip is not CLOSED. */
  NOT_CLOSED: "NOT_CLOSED",
  /** Only Cost Confirmation lines charge it: they never settle a transport. */
  NO_OWN_LINE: "NO_OWN_LINE",
  /**
   * Not on the invoice, and not added to the corrected one either: the
   * document's totals could not take a line, so the customer does not pay it.
   */
  NOT_ADDED: "NOT_ADDED",
  /** One of its lines is marked yellow. */
  LINE_MARKED: "LINE_MARKED",
  /** One of its lines was not priced reliably and completely. */
  PRICE_NOT_SETTLED: "PRICE_NOT_SETTLED",
  /** A line could be this transport or another one; nothing was chosen. */
  AMBIGUOUS_MATCH: "AMBIGUOUS_MATCH",
  /** Two lines lead to this transport; neither was corrected. */
  MATCH_CONFLICT: "MATCH_CONFLICT",
  /**
   * Not on the invoice and not added: an unresolved line states its booking or
   * container and may be this very transport with a typo.
   */
  BLOCKED_BY_UNRESOLVED_LINE: "BLOCKED_BY_UNRESOLVED_LINE",
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
  /**
   * The rows a person has to look at for it to become payable: the unresolved
   * lines that name it, or that block adding it. Empty when none do.
   */
  readonly blockingRowNumbers: readonly number[];
  /** Already paid: re-invoiced, and never paid a second time. */
  readonly alreadyPaid: boolean;
}

/** The pricing outcomes a line may be settled on. */
const SETTLED_PRICING_STATUSES: readonly InvoicePricingStatus[] = [
  InvoicePricingStatus.MATCHED_NO_CHANGES,
  InvoicePricingStatus.PRICING_CORRECTED,
  InvoicePricingStatus.INVOICE_HIGHER,
];

/**
 * The lines that are a transport's own: the customer's, or one this check added
 * to the document earlier because the invoice had not stated it. The corrected
 * document the customer pays carries both (owner, October 2026).
 */
const OWN_LINE_STATUSES: readonly InvoiceRowStatus[] = [
  InvoiceRowStatus.MATCHED,
  InvoiceRowStatus.ADDED_MISSING,
];

/**
 * Which transports this invoice may settle — see `invoice_audit.md`, "When a
 * transport is payable".
 *
 * ── THE WHOLE RULE, IN ONE PLACE ────────────────────────────────────────────
 * A transport is payable only when ALL of these hold:
 *
 *   * it has a line of its OWN — matched, or added by this check to an earlier
 *     correction of the document; a Cost Confirmation line alone is never a
 *     ground;
 *   * every line charging it is resolved;
 *   * the Trip is CLOSED;
 *   * every line came out UNCHANGED, RAISED or INVOICE_HIGHER — which already
 *     requires a reliable price, route evidence included;
 *   * none of its lines is marked yellow;
 *   * no unresolved TRANSPORT line names it as a candidate — an ambiguous
 *     line or a conflict (`unresolved-line-claims.ts`); an EC line that could
 *     not be linked never holds its transport back.
 *
 * A transport that NO line resolved to, but that an unresolved line names as a
 * candidate, is listed too — not payable, with the reason and the rows to fix —
 * so no transport stays unpaid without the check saying why.
 *
 * The transports the invoice did not state at all are judged beside these —
 * see `invoice-payments.ts`. Deciding is all this does. Paying is a separate,
 * confirmed step.
 */
export function assessPayments(
  matches: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  markedRowNumbers: ReadonlySet<number>,
): TripPayment[] {
  const claims = claimsByTrip(matches);
  const charged = [...linesByTrip(matches).values()].map(({ trip, lines }): TripPayment => {
    const reasons = reasonsAgainst(trip, lines, pricing, markedRowNumbers, claims.get(trip.id));
    const payable = reasons.length === 0;

    return {
      trip,
      rowNumbers: lines.map((line) => line.row.rowNumber),
      payable,
      category: payable ? categoryOf(lines, pricing) : null,
      reasons,
      blockingRowNumbers: claims.get(trip.id)?.rowNumbers ?? [],
      alreadyPaid: trip.isPaid,
    };
  });
  const chargedIds = new Set(charged.map((payment) => payment.trip.id));
  const onlyClaimed = [...claims.values()]
    .filter((claimed) => !chargedIds.has(claimed.trip.id))
    .map(toClaimedOnlyPayment);

  return [...charged, ...onlyClaimed];
}

/** A transport only unresolved lines name: never payable until they are fixed. */
function toClaimedOnlyPayment({ trip, claims, rowNumbers }: TripClaims): TripPayment {
  return {
    trip,
    rowNumbers: [],
    payable: false,
    category: null,
    reasons: [
      ...(trip.status !== TripStatus.CLOSED ? [NotPayableReason.NOT_CLOSED] : []),
      ...toClaimReasons(claims),
    ],
    blockingRowNumbers: rowNumbers,
    alreadyPaid: trip.isPaid,
  };
}

/** The match problems among the claims; an unfinished Trip is NOT_CLOSED already. */
function toClaimReasons(claims: ReadonlySet<UnresolvedClaim>): NotPayableReason[] {
  return [
    ...(claims.has(UnresolvedClaim.AMBIGUOUS_MATCH) ? [NotPayableReason.AMBIGUOUS_MATCH] : []),
    ...(claims.has(UnresolvedClaim.MATCH_CONFLICT) ? [NotPayableReason.MATCH_CONFLICT] : []),
  ];
}

function reasonsAgainst(
  trip: Trip,
  lines: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  markedRowNumbers: ReadonlySet<number>,
  claimed: TripClaims | undefined,
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
    !lines.some((line) => OWN_LINE_STATUSES.includes(line.status)),
  );
  add(
    NotPayableReason.LINE_MARKED,
    lines.some((line) => markedRowNumbers.has(line.row.rowNumber)),
  );
  add(
    NotPayableReason.PRICE_NOT_SETTLED,
    lines.some((line) => !isSettled(pricing.get(line.row.rowNumber))),
  );

  // Every line that names a Trip is resolved (MATCHED, COST_LINE, ADDED_MISSING);
  // what can still hold it back is an unresolved line naming it as a candidate.
  return [...reasons, ...toClaimReasons(claimed?.claims ?? new Set())];
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
