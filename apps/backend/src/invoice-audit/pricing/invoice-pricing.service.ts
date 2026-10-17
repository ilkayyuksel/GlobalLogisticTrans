import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../../logger/app-logger.service";
import { EffectivePricingService } from "../../trip-pricing/effective-pricing.service";
import type { InvoiceRowMatch } from "../matching/invoice-row-matching.service";
import type { InvoiceColumnPositions } from "../workbook/invoice-columns";
import { toColumnLetter } from "../workbook/invoice-columns";
import { InvoiceFuelRateReader } from "./invoice-fuel-rate.reader";
import { InvoicePricingStatus, type InvoiceRowPricing } from "./invoice-reconciliation";
import { assessPriceReliability } from "./price-reliability";
import { reconcileTripRows } from "./trip-reconciliation";

/**
 * What the invoice charges, against what this system holds.
 *
 * ── THE PRICING IS NEVER RECOMPUTED HERE ────────────────────────────────────
 * It is read, once, from `EffectivePricingService` — the same figures the
 * Ritten list, the Trip panel and both Excel exports show, with the Engine's
 * amounts and an operator's corrections already resolved into one answer. This
 * module has no pricing rule of its own and must never grow one: a second
 * calculation would eventually disagree with the first, and the invoice would
 * be corrected towards a figure nothing else in the system states.
 *
 * ── AND ONLY A PRICE THAT CAN BE RELIED ON IS USED ──────────────────────────
 * Before a line is compared, the Trip's stored price is judged from what was
 * stored with it — see `price-reliability.ts`. A Trip never priced, priced on
 * no route, on an unconfirmed route or under a group it no longer has is
 * PRICE_UNRELIABLE: nothing on its lines is written, and it is never settled.
 *
 * ── ONE CALL FOR THE WHOLE DOCUMENT ─────────────────────────────────────────
 * Every matched Trip id goes to the reads together, exactly as the match itself
 * asks the database once. A hundred-line invoice costs a fixed number of reads.
 *
 * ── AND ONLY MATCHED LINES ARE COMPARED ─────────────────────────────────────
 * A line with no CLOSED Trip, one whose Trip is unfinished and one that matched
 * several are all left alone — there is nothing to compare them against, and a
 * correction towards a Trip we are not sure of would be worse than no answer.
 */
@Injectable()
export class InvoicePricingService {
  constructor(
    private readonly effectivePricing: EffectivePricingService,
    private readonly fuelRates: InvoiceFuelRateReader,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoicePricingService.name);
  }

  async reconcile(
    matches: readonly InvoiceRowMatch[],
    columns: InvoiceColumnPositions,
  ): Promise<ReadonlyMap<number, InvoiceRowPricing>> {
    const matched = matches.filter((match) => match.trip !== null);
    const tripIds = [...new Set(matched.map((match) => match.trip!.id))];
    const [pricingByTrip, ratesByTrip] = await Promise.all([
      this.effectivePricing.findForTrips(tripIds),
      this.fuelRates.findForTrips(tripIds),
    ]);

    const byRow = new Map<number, InvoiceRowPricing>();
    const tariefColumnLetter = toColumnLetter(columns.tarief ?? 0);
    const tripOfRow = new Map(matched.map((match) => [match.row.rowNumber, match.trip!.id]));
    const pricingOfRow = (rowNumber: number) => {
      const tripId = tripOfRow.get(rowNumber);

      return tripId === undefined ? null : (pricingByTrip.get(tripId) ?? null);
    };

    for (const [tripId, rows] of this.groupByTrip(matched)) {
      const pricing = pricingByTrip.get(tripId) ?? null;
      const outcomes = reconcileTripRows({
        rows,
        pricing,
        reliability: assessPriceReliability(rows[0].trip!, pricing),
        tariefColumnLetter,
        fuelRate: ratesByTrip.get(tripId) ?? null,
        pricingOfRow,
      });

      for (const outcome of outcomes) {
        byRow.set(outcome.rowNumber, outcome);
      }
    }

    // Every line that was not compared says so, rather than saying nothing.
    for (const match of matches) {
      if (!byRow.has(match.row.rowNumber)) {
        byRow.set(match.row.rowNumber, {
          rowNumber: match.row.rowNumber,
          status: InvoicePricingStatus.NOT_COMPARED,
          differences: [],
          reliability: null,
        });
      }
    }

    this.logReconciled(matched.length, pricingByTrip.size, byRow);

    return byRow;
  }

  private logReconciled(
    comparedLines: number,
    pricedTrips: number,
    byRow: ReadonlyMap<number, InvoiceRowPricing>,
  ): void {
    const count = (status: InvoicePricingStatus) =>
      [...byRow.values()].filter((row) => row.status === status).length;

    this.logger.log("Invoice pricing reconciled", {
      comparedLines,
      pricedTrips,
      // Counts only: what a transport costs is commercial data and is not logged.
      correctedRows: count(InvoicePricingStatus.PRICING_CORRECTED),
      invoiceHigherRows: count(InvoicePricingStatus.INVOICE_HIGHER),
      notDistributableRows: count(InvoicePricingStatus.NOT_DISTRIBUTABLE),
      priceUnreliableRows: count(InvoicePricingStatus.PRICE_UNRELIABLE),
      amountUnreadableRows: count(InvoicePricingStatus.AMOUNT_UNREADABLE),
      combinationReviewRows: count(InvoicePricingStatus.COMBINATION_REVIEW),
    });
  }

  /**
   * The rows of one transport, together.
   *
   * Keyed by the Trip rather than by the invoice's three values: they are the
   * same thing for a matched line, and the Trip is what the pricing belongs to.
   * The rows keep the order the document states them in, so "the line's first
   * row" means what it says.
   */
  private groupByTrip(
    matches: readonly InvoiceRowMatch[],
  ): Map<string, InvoiceRowMatch[]> {
    const byTrip = new Map<string, InvoiceRowMatch[]>();

    for (const match of matches) {
      const tripId = match.trip!.id;

      byTrip.set(tripId, [...(byTrip.get(tripId) ?? []), match]);
    }

    return byTrip;
  }
}
