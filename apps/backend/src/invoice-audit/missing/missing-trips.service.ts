import { Injectable } from "@nestjs/common";
import { Trip } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import { toIsoDate, toUtcDate } from "../../common/dates";
import { AppLoggerService } from "../../logger/app-logger.service";
import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import { EffectivePricingService } from "../../trip-pricing/effective-pricing.service";
import { TripExportLabelsService } from "../../trip-export/trip-export-labels.service";
import { TripRepository } from "../../trips/trip.repository";
import { toTripRoute } from "../../trips/trip-route";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";

/**
 * A finished transport the invoice does not mention.
 *
 * It carries the Trip, what this system holds it is worth, and the route as the
 * Trip domain itself derives it — nothing is assembled here that already has an
 * answer elsewhere.
 */
export interface MissingTrip {
  readonly trip: Trip;
  /** The effective pricing, or null when the Trip has never been priced. */
  readonly pricing: EffectivePricing | null;
  /** `Quay 869 -> ZEMST`, as `toTripRoute` derives it. */
  readonly route: string;
  /**
   * What the Remarks column says about it — its Custom Properties, TAR when
   * charged, its waiting window, every Cost Confirmation — in the exports' own
   * vocabulary. Empty when there is nothing to say.
   */
  readonly remarks: string;
}

/**
 * The finished transports of the invoiced week that are not on the invoice.
 *
 * ── WHAT MAKES A TRANSPORT "MISSING" ────────────────────────────────────────
 * Three conditions, and the document itself:
 *
 *   * CLOSED — an unfinished transport is not owed yet, and an OPEN, CANCELLED
 *     or DELETED one is never added;
 *   * not paid — a transport already settled belongs to a week that was
 *     invoiced before;
 *   * planned inside the days the invoice covers, which come from the Planning
 *     date values in the document and never from its file name;
 *   * and its identity appears on NO line of the document.
 *
 * ── WHY EVERY LINE COUNTS, NOT ONLY THE MATCHED ONES ────────────────────────
 * A line that found no Trip, one whose Trip is unfinished and one that matched
 * several all still NAME a transport. Adding a row for a Trip those lines are
 * about would put the same transport on the invoice twice — so the comparison
 * is against every line the document states, whatever the check made of it.
 *
 * ── AND BY WHAT THE MATCH FOUND, NOT ONLY BY WHAT THE LINE SAYS ─────────────
 * A line can name its Trip without stating its exact values: it may carry the
 * day the transport was ORIGINALLY ordered for, or a misprinted container. The
 * match still resolves it, so comparing the line's text alone would call that
 * Trip missing and append it a second time. Every Trip the match resolved a line
 * to — or named as one of several a line could mean — is therefore on the
 * invoice too, alongside every Trip whose values a line states outright.
 *
 * ── AND WHY THIS IS IDEMPOTENT ──────────────────────────────────────────────
 * Nothing is remembered. A corrected document that already carries the added
 * rows states those identities, so on the next check they are no longer missing
 * — the answer comes from the file in hand and the database as it is now.
 */
@Injectable()
export class MissingTripsService {
  constructor(
    private readonly trips: TripRepository,
    private readonly effectivePricing: EffectivePricingService,
    private readonly exportLabels: TripExportLabelsService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(MissingTripsService.name);
  }

  async find(
    period: { readonly from: string; readonly to: string } | null,
    rows: readonly InvoiceSheetRow[],
    /** Every Trip the match resolved a line to, or named as a candidate. */
    namedTripIds: ReadonlySet<string> = new Set(),
  ): Promise<readonly MissingTrip[]> {
    // No line, no period, nothing to be missing FROM: an empty document is not
    // a claim that a week went uninvoiced.
    if (period === null) {
      return [];
    }

    const candidates = await this.trips.findClosedUnpaidBetween({
      from: toUtcDate(period.from),
      to: toUtcDate(period.to),
    });

    const stated = new Set(rows.map((row) => toRowIdentity(row)));
    const missing = candidates.filter((trip) => {
      const identity = toTripIdentity(trip);

      return (
        identity !== null &&
        !stated.has(identity) &&
        !namedTripIds.has(trip.id)
      );
    });

    // One pricing read and one label read for all of them, as the rest of this
    // module does. The invoice is Dutch, so the documents' own waiting word.
    const missingIds = missing.map((trip) => trip.id);
    const [pricingByTrip, labelsByTrip] = await Promise.all([
      this.effectivePricing.findForTrips(missingIds),
      this.exportLabels.findForTrips(missingIds),
    ]);

    this.logger.log("Missing finished transports found", {
      periodFrom: period.from,
      periodTo: period.to,
      closedUnpaidInPeriod: candidates.length,
      statedByTheInvoice: candidates.length - missing.length,
      missing: missing.length,
      // Counts only: what a transport is worth is commercial data.
      pricedMissing: pricingByTrip.size,
    });

    return missing.map((trip) => ({
      trip,
      pricing: pricingByTrip.get(trip.id) ?? null,
      route: toRouteLabel(trip),
      remarks: labelsByTrip.get(trip.id)?.remarks ?? "",
    }));
  }
}

/**
 * The three values that decide whether a transport is already on the invoice.
 *
 * Exactly the identity the match uses, with the container compared in its
 * normalised form — `PVDU 1123118` on the invoice and `PVDU1123118` in this
 * system are one container. There is no fallback to fewer values.
 */
function toRowIdentity(row: InvoiceSheetRow): string {
  return `${row.planningDate}|${row.bookingNumber}|${row.normalizedContainerNumber}`;
}

function toTripIdentity(trip: Trip): string | null {
  const container = normalizeContainerNumber(trip.containerNumber);

  if (!trip.planningDate || !trip.bookingNumber || container === null) {
    return null;
  }

  return `${toIsoDate(trip.planningDate)}|${trip.bookingNumber}|${container}`;
}

/**
 * The route as the invoice's Trip column says it.
 *
 * `toTripRoute` is the Trip domain's own derivation — direction-aware, with the
 * canonical terminal — and it is what the Ritten list and the existing Excel
 * exports already print. Nothing is assembled here beyond putting its two ends
 * either side of the arrow the documents use.
 */
function toRouteLabel(trip: Trip): string {
  const route = toTripRoute(trip);

  return route === null ? "" : `${route.from} -> ${route.to}`;
}
