import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../../logger/app-logger.service";
import { InvoiceAuditReadRepository } from "../invoice-audit-read.repository";
import { InvoiceFuelRateReader } from "../pricing/invoice-fuel-rate.reader";
import { ManualRouteFactsReader } from "../pricing/manual-route-facts.reader";
import { InvoiceRemarksService } from "../remarks/invoice-remarks.service";
import { planAddedRows, type AddedRow } from "./added-rows";
import type { MissingTrip } from "./missing-trips.service";

/**
 * What each missing transport's line will say — see `added-rows.ts`.
 *
 * Reads, in a fixed number of queries, the facts its Remarks come from (the
 * same reads a completed line uses) and how many Trips each of their groups
 * holds. Decides nothing about money: the price is the stored one, written or
 * withheld according to whether it can be relied on.
 */
@Injectable()
export class AddedRowsService {
  constructor(
    private readonly reads: InvoiceAuditReadRepository,
    private readonly remarks: InvoiceRemarksService,
    private readonly manualRoutes: ManualRouteFactsReader,
    private readonly fuelRates: InvoiceFuelRateReader,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(AddedRowsService.name);
  }

  async plan(missing: readonly MissingTrip[]): Promise<AddedRow[]> {
    if (missing.length === 0) {
      return [];
    }

    const groupIds = [
      ...new Set(
        missing
          .map((trip) => trip.trip.tripGroupId)
          .filter((groupId): groupId is string => groupId !== null && groupId !== undefined),
      ),
    ];
    const pricingByTrip = new Map(
      missing.flatMap((trip) => (trip.pricing ? [[trip.trip.id, trip.pricing] as const] : [])),
    );
    const [facts, groupSizes, manualByTrip, fuelRates] = await Promise.all([
      this.remarks.factsFor(missing.map((trip) => trip.trip)),
      this.reads.countGroupMembers(groupIds),
      this.manualRoutes.findForTrips(
        missing.map((trip) => trip.trip),
        pricingByTrip,
      ),
      this.fuelRates.findForTrips(missing.map((trip) => trip.trip.id)),
    ]);
    const rows = planAddedRows(missing, facts, groupSizes, manualByTrip, fuelRates);

    this.logger.log("Lines for missing transports planned", {
      lines: rows.length,
      withoutReliablePrice: rows.filter((row) => !row.reliability.reliable).length,
      combinationLegs: rows.filter((row) => row.combinationEnd !== null).length,
    });

    return rows;
  }
}
