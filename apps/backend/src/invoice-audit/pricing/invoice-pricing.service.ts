import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../../logger/app-logger.service";
import { EffectivePricingService } from "../../trip-pricing/effective-pricing.service";
import type { InvoiceRowMatch } from "../matching/invoice-row-matching.service";
import type { InvoiceColumnPositions } from "../workbook/invoice-columns";
import { toColumnLetter } from "../workbook/invoice-columns";
import {
  InvoicePricingStatus,
  reconcileLine,
  type InvoiceRowPricing,
} from "./invoice-reconciliation";

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
 * ── ONE CALL FOR THE WHOLE DOCUMENT ─────────────────────────────────────────
 * Every matched Trip id goes to `findForTrips` together, exactly as the match
 * itself asks the database once. A hundred-line invoice costs one pricing read.
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
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoicePricingService.name);
  }

  async reconcile(
    matches: readonly InvoiceRowMatch[],
    columns: InvoiceColumnPositions,
  ): Promise<ReadonlyMap<number, InvoiceRowPricing>> {
    const matched = matches.filter((match) => match.trip !== null);
    const pricingByTrip = await this.effectivePricing.findForTrips([
      ...new Set(matched.map((match) => match.trip!.id)),
    ]);

    const byRow = new Map<number, InvoiceRowPricing>();
    const context = {
      tariefColumnLetter: toColumnLetter(columns.tarief ?? 0),
    };

    for (const [, line] of this.groupByTrip(matched)) {
      const pricing = pricingByTrip.get(line[0].trip!.id);

      /*
       * A Trip that has never been priced has no figures to compare against.
       * That is an ordinary state — a Trip is priced when it is closed, and a
       * snapshot can be absent — so the line is left uncompared rather than
       * corrected towards zeros nobody calculated.
       */
      if (!pricing) {
        for (const match of line) {
          byRow.set(match.row.rowNumber, {
            rowNumber: match.row.rowNumber,
            status: InvoicePricingStatus.NOT_COMPARED,
            differences: [],
          });
        }

        continue;
      }

      for (const row of reconcileLine(
        line.map((match) => match.row),
        pricing,
        context,
      )) {
        byRow.set(row.rowNumber, row);
      }
    }

    // Every line that was not compared says so, rather than saying nothing.
    for (const match of matches) {
      if (!byRow.has(match.row.rowNumber)) {
        byRow.set(match.row.rowNumber, {
          rowNumber: match.row.rowNumber,
          status: InvoicePricingStatus.NOT_COMPARED,
          differences: [],
        });
      }
    }

    this.logger.log("Invoice pricing reconciled", {
      comparedLines: matched.length,
      pricedTrips: pricingByTrip.size,
      // Counts only: what a transport costs is commercial data and is not logged.
      correctedRows: [...byRow.values()].filter(
        (row) => row.status === InvoicePricingStatus.PRICING_CORRECTED,
      ).length,
      notDistributableRows: [...byRow.values()].filter(
        (row) => row.status === InvoicePricingStatus.NOT_DISTRIBUTABLE,
      ).length,
    });

    return byRow;
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
