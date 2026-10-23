import { Injectable } from "@nestjs/common";
import type { Trip } from "@prisma/client";

import { AppLoggerService } from "../../logger/app-logger.service";
import { TripExportLabelsService } from "../../trip-export/trip-export-labels.service";
import { InvoiceAuditReadRepository } from "../invoice-audit-read.repository";
import type { InvoiceRowMatch } from "../matching/invoice-row-match";
import type { InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import { planRemarks, type RemarkChange, type TripRemarkFacts } from "./remark-plan";

/**
 * What each Trip's own line should add to its Remarks — see `remark-plan.ts`.
 *
 * ── READ, NEVER DECIDED AGAIN ───────────────────────────────────────────────
 * Every fact comes from where the system already keeps it: the Trip's assigned
 * Custom Properties and Cost Confirmations (read here, in one query each), its
 * waiting window (on the Trip itself), and whether the Engine charged TAR —
 * which `TripExportLabelsService` owns and which is never worked out again
 * here. Only the WORDS are the customer's.
 */
@Injectable()
export class InvoiceRemarksService {
  constructor(
    private readonly reads: InvoiceAuditReadRepository,
    private readonly exportLabels: TripExportLabelsService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoiceRemarksService.name);
  }

  async plan(
    matches: readonly InvoiceRowMatch[],
    pricing: ReadonlyMap<number, InvoiceRowPricing>,
  ): Promise<Map<number, RemarkChange>> {
    const trips = new Map(
      matches.flatMap((match) => (match.trip === null ? [] : [[match.trip.id, match.trip] as const])),
    );

    if (trips.size === 0) {
      return new Map();
    }

    const changes = planRemarks(matches, pricing, await this.factsFor([...trips.values()]));

    this.logger.log("Invoice remarks planned", {
      linesCompleted: [...changes.values()].filter((change) => change.added.length > 0).length,
      partsAdded: [...changes.values()].reduce((total, change) => total + change.added.length, 0),
      linesWithNotes: [...changes.values()].filter((change) => change.notes.length > 0).length,
    });

    return changes;
  }

  /** What each Trip's Remarks can say, read in a fixed number of queries. */
  async factsFor(trips: readonly Trip[]): Promise<Map<string, TripRemarkFacts>> {
    const tripIds = trips.map((trip) => trip.id);

    if (tripIds.length === 0) {
      return new Map();
    }

    const [propertyNames, ccNumbers, labels] = await Promise.all([
      this.reads.findCustomPropertyNames(tripIds),
      this.reads.findCostConfirmationNumbers(tripIds),
      this.exportLabels.findForTrips(tripIds),
    ]);

    return new Map(
      trips.map((trip) => [
        trip.id,
        {
          propertyNames: propertyNames.get(trip.id) ?? [],
          tarCharged: labels.get(trip.id)?.tarCharged ?? false,
          ccNumbers: ccNumbers.get(trip.id) ?? [],
          waiting: {
            start: trip.waitingTimeStart ?? null,
            end: trip.waitingTimeEnd ?? null,
            endsNextDay: trip.waitingTimeEndsNextDay ?? false,
            minutes: trip.waitingTimeMinutes ?? null,
          },
          extraNotes: trip.internalNotes ?? null,
        },
      ]),
    );
  }
}
