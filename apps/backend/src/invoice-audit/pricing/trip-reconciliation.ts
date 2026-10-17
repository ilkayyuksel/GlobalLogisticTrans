import { Prisma } from "@prisma/client";

import { EffectiveComponent } from "../../trip-pricing/effective-pricing";
import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import {
  CombinationVerdict,
  type InvoiceRowMatch,
} from "../matching/invoice-row-match";
import {
  InvoicePricingStatus,
  reconcileCostLine,
  reconcileLine,
  type InvoiceRowPricing,
} from "./invoice-reconciliation";
import type { PriceReliability } from "./price-reliability";

/**
 * Every row one Trip is charged on, compared at once.
 *
 * ── ONE TRANSPORT, CORRECTED COMPLETELY OR NOT AT ALL ───────────────────────
 * A price nobody can stand behind, or a Combination nobody can confirm, leaves
 * EVERY row of the Trip unwritten: its own line and its Cost Confirmation lines
 * alike.
 *
 * ── A COST CONFIRMATION IS CHARGED ONCE ─────────────────────────────────────
 * A Cost Confirmation line is compared with its own confirmation. What those
 * lines charge is then taken OFF the EK the Trip's own line is compared with —
 * otherwise the line would be raised to the full EK and the confirmation would
 * be on the invoice twice. When the Trip's EK is its charged waiting time,
 * no confirmation is owed separately (`resolveEk`): each is compared with zero.
 */
export interface TripRowsInput {
  /** Every row of the invoice resolved to this Trip, in document order. */
  readonly rows: readonly InvoiceRowMatch[];
  readonly pricing: CurrentTripPricing | null;
  readonly reliability: PriceReliability;
  readonly tariefColumnLetter: string;
  readonly fuelRate: Prisma.Decimal | null;
  /** The stored pricing of the Trip on another row of the invoice. */
  readonly pricingOfRow: (rowNumber: number) => CurrentTripPricing | null;
}

export function reconcileTripRows(input: TripRowsInput): InvoiceRowPricing[] {
  const { rows, pricing, reliability } = input;

  if (!reliability.reliable || pricing === null) {
    return withStatus(rows, InvoicePricingStatus.PRICE_UNRELIABLE, reliability);
  }

  if (!isCombinationConfirmed(rows, pricing, input.pricingOfRow)) {
    return withStatus(rows, InvoicePricingStatus.COMBINATION_REVIEW, reliability);
  }

  const costRows = rows.filter((match) => match.row.costLine !== null);
  const transportRows = rows.filter((match) => match.row.costLine === null);
  const waitingCharged = chargesWaitingTime(pricing);
  const owedFor = (match: InvoiceRowMatch) =>
    waitingCharged || match.costConfirmation === null
      ? new Prisma.Decimal(0)
      : match.costConfirmation.amount;
  const covered = costRows.reduce((total, match) => total.plus(owedFor(match)), new Prisma.Decimal(0));

  const outcomes: InvoiceRowPricing[] = costRows.map((match) =>
    reconcileCostLine(match.row, owedFor(match)),
  );

  if (transportRows.length > 0) {
    const remainingEk = Prisma.Decimal.max(pricing.ek.minus(covered), 0);

    outcomes.push(
      ...reconcileLine(
        transportRows.map((match) => match.row),
        { ...pricing, ek: remainingEk },
        {
          tariefColumnLetter: input.tariefColumnLetter,
          fuelRate: input.fuelRate,
          backloadRemovalAllowed: transportRows.some(
            (match) => match.combination?.verdict === CombinationVerdict.GEEN_COMBI,
          ),
        },
      ),
    );
  }

  return outcomes.map((outcome) => ({ ...outcome, reliability }));
}

/**
 * Whether every Combination the Excel marks on this Trip is confirmed: none
 * under review, and a recognised pair priced on ONE Combination — both halves
 * carrying the same `combinationRouteGroupId`.
 */
function isCombinationConfirmed(
  rows: readonly InvoiceRowMatch[],
  pricing: CurrentTripPricing,
  pricingOfRow: (rowNumber: number) => CurrentTripPricing | null,
): boolean {
  return rows.every((match) => {
    const combination = match.combination;

    if (combination === null || combination.verdict === CombinationVerdict.GEEN_COMBI) {
      return true;
    }

    if (combination.verdict === CombinationVerdict.REVIEW || combination.partnerRowNumber === null) {
      return false;
    }

    const own = pricing.routeMatch.combinationRouteGroupId;
    const partner = pricingOfRow(combination.partnerRowNumber)?.routeMatch.combinationRouteGroupId;

    return own !== null && own === partner;
  });
}

/** The Trip's EK is its charged waiting time rather than its confirmations. */
function chargesWaitingTime(pricing: CurrentTripPricing): boolean {
  return pricing.components.some(
    (component) =>
      component.componentCode === EffectiveComponent.WAITING_TIME &&
      component.effectiveAmount.greaterThan(0),
  );
}

function withStatus(
  rows: readonly InvoiceRowMatch[],
  status: InvoicePricingStatus,
  reliability: PriceReliability,
): InvoiceRowPricing[] {
  return rows.map((match) => ({
    rowNumber: match.row.rowNumber,
    status,
    differences: [],
    reliability,
  }));
}
