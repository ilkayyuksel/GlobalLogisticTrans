import { Prisma } from "@prisma/client";

import { EffectiveComponent, EkSource, ekSourceOf } from "../../trip-pricing/effective-pricing";
import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import {
  CombinationVerdict,
  type InvoiceRowMatch,
} from "../matching/invoice-row-match";
import { carriesCombinationSurcharge } from "../../pricing-engine/combination-leg";
import {
  InvoiceLineMark,
  InvoicePricingStatus,
  reconcileCostLine,
  reconcileLine,
  withMark,
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
  const mismatch = combinationMismatchOf(input.rows);
  const outcomes = reconcileTrip(input, mismatch);

  // Every row the transport is charged on is marked, its EC lines included.
  return mismatch === null ? outcomes : outcomes.map((outcome) => withMark(outcome, mismatch));
}

/**
 * Whether the Excel and this system disagree about the transport being a
 * Combination (owner, November 2026), or null when they agree.
 *
 *   Excel: one of its own lines carries the COMBINATION marking the Excel pairs
 *          by (`excel-combination-pairs.ts`) — a pair, or a line under review;
 *   Trano: the Trip belongs to a group, which is what carries the Combination
 *          Backload (`carriesCombinationSurcharge`).
 *
 * Only Excel        → COMBINATION_ONLY_IN_EXCEL: marked, nothing else changes —
 *                     a GEEN COMBI is still written and its Backload removed.
 * Only this system  → COMBINATION_ONLY_IN_TRANO: marked, and its €50 Backload is
 *                     not added (`backloadRaiseAllowed`). No Combination remark
 *                     can arise: GEEN COMBI needs the Excel's own marking.
 */
function combinationMismatchOf(rows: readonly InvoiceRowMatch[]): InvoiceLineMark | null {
  const transportRows = rows.filter((match) => match.row.costLine === null);
  const trip = transportRows.find((match) => match.trip !== null)?.trip ?? null;

  if (trip === null || transportRows.length === 0) {
    return null;
  }

  const inExcel = transportRows.some((match) => match.combination !== null);
  const inTrano = carriesCombinationSurcharge({ tripGroupId: trip.tripGroupId ?? null });

  if (inExcel === inTrano) {
    return null;
  }

  return inExcel ? InvoiceLineMark.COMBINATION_ONLY_IN_EXCEL : InvoiceLineMark.COMBINATION_ONLY_IN_TRANO;
}

function reconcileTrip(input: TripRowsInput, mismatch: InvoiceLineMark | null): InvoiceRowPricing[] {
  const { rows, pricing, reliability } = input;

  if (!reliability.reliable || pricing === null) {
    return withStatus(rows, InvoicePricingStatus.PRICE_UNRELIABLE, reliability);
  }

  if (!isCombinationConfirmed(rows, pricing, input.pricingOfRow)) {
    return withStatus(rows, InvoicePricingStatus.COMBINATION_REVIEW, reliability);
  }

  const costRows = rows.filter((match) => match.row.costLine !== null);
  const transportRows = rows.filter((match) => match.row.costLine === null);
  const owedFor = (match: InvoiceRowMatch) => owedOnCostLine(pricing, match);
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
          backloadRaiseAllowed: mismatch !== InvoiceLineMark.COMBINATION_ONLY_IN_TRANO,
          ekIsTripTotalWhenPricesMissing: isNormalTransportLine(transportRows, mismatch),
        },
      ),
    );
  }

  return outcomes.map((outcome) => ({ ...outcome, reliability }));
}

/**
 * A Combination on neither side — both agree, and no line of the Excel marks
 * one — charged on a transport line of its own. An EK line standing in as the
 * transport's line (`ekLineAsTransport`) never states a Tarief or Fuel and
 * keeps the EK rules it has (owner, November 2026).
 */
function isNormalTransportLine(transportRows: readonly InvoiceRowMatch[], mismatch: InvoiceLineMark | null): boolean {
  return (
    mismatch === null &&
    transportRows.every((match) => match.combination === null && match.row.ekLineAsTransport !== true)
  );
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

/**
 * What a Cost Confirmation line is owed: its own confirmation — or nothing when
 * the Trip's EK is its waiting time (one EK source, see `resolveEk`).
 */
export function owedOnCostLine(pricing: CurrentTripPricing, match: InvoiceRowMatch): Prisma.Decimal {
  return areConfirmationsSuperseded(pricing) || match.costConfirmation === null
    ? new Prisma.Decimal(0)
    : match.costConfirmation.amount;
}

/**
 * The Trip's EK is its waiting time rather than its confirmations, as the
 * stored snapshot says — the higher of the two (`ekSourceOf`, owner, November
 * 2026). The Engine stores the confirmation line at €0 when the waiting time
 * is as high or higher; a snapshot from an earlier rule may carry both in
 * full, and the same comparison decides it. No confirmation line at all: the
 * waiting time is the EK when it charges anything.
 */
function areConfirmationsSuperseded(pricing: CurrentTripPricing): boolean {
  const amountOf = (componentCode: string) =>
    pricing.components.find((component) => component.componentCode === componentCode)
      ?.effectiveAmount ?? null;
  const waitingTime = amountOf(EffectiveComponent.WAITING_TIME) ?? new Prisma.Decimal(0);
  const confirmations = amountOf(EffectiveComponent.COST_CONFIRMATION);

  if (confirmations === null) {
    return waitingTime.greaterThan(0);
  }

  return confirmations.isZero() || ekSourceOf(waitingTime, confirmations) === EkSource.WAITING_TIME;
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
