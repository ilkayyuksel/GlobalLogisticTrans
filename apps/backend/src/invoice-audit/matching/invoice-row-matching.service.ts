import { Injectable } from "@nestjs/common";
import { Trip, TripStatus } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import { toIsoDate, toUtcDate } from "../../common/dates";
import { AppLoggerService } from "../../logger/app-logger.service";
import { TripRepository } from "../../trips/trip.repository";
import type { AuditMarkedRow } from "../workbook/invoice-audit-marker";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";

/**
 * What became of one invoice line.
 *
 * ── FOUR ANSWERS, AND NEVER A GUESS ─────────────────────────────────────────
 * MATCHED is exactly one CLOSED Trip. AMBIGUOUS is more than one, and it stays
 * ambiguous: not the first, not the newest, not the one that happens to sort
 * first — nothing is chosen, because there is no honest way to choose and a
 * wrong choice would later mark the wrong transport paid. NOT_FINISHED is the
 * diagnosis an operator can act on: the transport is there, it simply has not
 * been closed yet. NOT_FOUND is everything else.
 *
 * ── AND ONE ANSWER ABOUT WHERE THE LINE CAME FROM ───────────────────────────
 * ADDED_MISSING is a line this system wrote into the document itself, because
 * the customer's invoice had forgotten the transport. It resolves to its Trip
 * exactly like a matched line — its prices are compared and corrected — but it
 * is never settled: nobody has paid for a line the customer never sent. The
 * document remembers which rows those are; see `invoice-audit-marker.ts`.
 */
export const InvoiceRowStatus = {
  MATCHED: "MATCHED",
  NOT_FOUND: "NOT_FOUND",
  NOT_FINISHED: "NOT_FINISHED",
  AMBIGUOUS: "AMBIGUOUS",
  ADDED_MISSING: "ADDED_MISSING",
} as const;

export type InvoiceRowStatus =
  (typeof InvoiceRowStatus)[keyof typeof InvoiceRowStatus];

export interface InvoiceRowMatch {
  readonly row: InvoiceSheetRow;
  readonly status: InvoiceRowStatus;
  /** The one CLOSED Trip, when there is exactly one. */
  readonly trip: Trip | null;
  /**
   * Every Trip sharing this line's identity, whatever its status.
   *
   * Carried for the ambiguous case, which must be able to name what it could
   * not choose between, and for NOT_FINISHED, which names the Trip that is not
   * closed yet.
   */
  readonly candidates: readonly Trip[];
  /**
   * The other rows of this same document stating the same three values.
   *
   * ── WHY THEY ARE MARKED RATHER THAN MERGED ────────────────────────────────
   * A weekly invoice legitimately prints one line per Cost Confirmation, each
   * carrying only an EK amount under the booking and container of a transport
   * that already has a line of its own. Those lines are not duplicates to be
   * removed — each is a charge the customer states — so every one keeps its own
   * row, and the shared key is recorded so the pricing phase can add them up
   * instead of comparing each against the whole.
   */
  readonly sharedKeyRowNumbers: readonly number[];
}

/**
 * Statuses a Trip may hold and still be a candidate.
 *
 * DELETED is absent deliberately: a deleted Trip is a record that should not
 * have existed, and reporting an invoice line as "found, but deleted" would
 * offer an answer nobody can act on. Such a line is NOT_FOUND, which is what it
 * is.
 */
const CANDIDATE_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
  TripStatus.CANCELLED,
];

/**
 * Which Trip each invoice line is about.
 *
 * ── THE IDENTITY IS EXACTLY THREE VALUES ────────────────────────────────────
 * The planning date, the booking number and the container number — the last one
 * compared in its normalised form, because the customer's sheet writes
 * `PVDU 1123118` where this system stores `PVDU1123118`. There is deliberately
 * NO fallback: not the booking alone, not the booking with the date, not a
 * fuzzy comparison of anything. A line that does not match on all three does
 * not match, and says so.
 *
 * ── ONE QUERY FOR THE WHOLE DOCUMENT ────────────────────────────────────────
 * The days and the bookings the invoice names go to the database together and
 * the lines are matched against the result in memory. A hundred-line invoice
 * therefore costs ONE query rather than a hundred — see `findManyForInvoice`.
 */
@Injectable()
export class InvoiceRowMatchingService {
  constructor(
    private readonly trips: TripRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoiceRowMatchingService.name);
  }

  async match(
    rows: readonly InvoiceSheetRow[],
    addedByAudit: ReadonlyMap<number, AuditMarkedRow> = new Map(),
  ): Promise<readonly InvoiceRowMatch[]> {
    const candidates = await this.loadCandidates(rows);
    const byKey = this.groupByIdentity(candidates);
    const rowNumbersByKey = this.rowNumbersByIdentity(rows);

    const matches = rows.map((row) => {
      const key = toIdentityKey(
        row.planningDate,
        row.bookingNumber,
        row.normalizedContainerNumber,
      );
      const forRow = byKey.get(key) ?? [];
      const closed = forRow.filter((trip) => trip.status === TripStatus.CLOSED);
      const matched = toStatus(closed.length, forRow.length);

      return {
        row,
        /*
         * A line this system added to this document keeps its own answer. It
         * still resolves to its Trip — the prices below are compared and
         * corrected exactly as any other line's — but it can never be settled.
         */
        status: wasAddedByAudit(row, addedByAudit)
          ? InvoiceRowStatus.ADDED_MISSING
          : matched,
        trip: closed.length === 1 ? closed[0] : null,
        candidates: forRow,
        sharedKeyRowNumbers: (rowNumbersByKey.get(key) ?? []).filter(
          (rowNumber) => rowNumber !== row.rowNumber,
        ),
      };
    });

    this.logger.log("Invoice lines matched", {
      lineCount: rows.length,
      candidateTripCount: candidates.length,
      // Counts only. A booking number is an identifier and may be logged; what
      // any of it COSTS is commercial data and is not logged anywhere.
      matched: matches.filter((match) => match.status === "MATCHED").length,
      notFound: matches.filter((match) => match.status === "NOT_FOUND").length,
      notFinished: matches.filter((match) => match.status === "NOT_FINISHED").length,
      ambiguous: matches.filter((match) => match.status === "AMBIGUOUS").length,
      addedByThisSystem: matches.filter(
        (match) => match.status === "ADDED_MISSING",
      ).length,
    });

    return matches;
  }

  /** Every Trip the document could be talking about, in one query. */
  private loadCandidates(rows: readonly InvoiceSheetRow[]): Promise<Trip[]> {
    const planningDates = [...new Set(rows.map((row) => row.planningDate))].map(
      toUtcDate,
    );
    const bookingNumbers = [...new Set(rows.map((row) => row.bookingNumber))];

    return this.trips.findManyForInvoice({
      planningDates,
      bookingNumbers,
      statuses: CANDIDATE_STATUSES,
    });
  }

  private groupByIdentity(trips: readonly Trip[]): Map<string, Trip[]> {
    const byKey = new Map<string, Trip[]>();

    for (const trip of trips) {
      const key = toTripIdentityKey(trip);

      if (key === null) {
        continue;
      }

      byKey.set(key, [...(byKey.get(key) ?? []), trip]);
    }

    return byKey;
  }

  private rowNumbersByIdentity(
    rows: readonly InvoiceSheetRow[],
  ): Map<string, number[]> {
    const byKey = new Map<string, number[]>();

    for (const row of rows) {
      const key = toIdentityKey(
        row.planningDate,
        row.bookingNumber,
        row.normalizedContainerNumber,
      );

      byKey.set(key, [...(byKey.get(key) ?? []), row.rowNumber]);
    }

    return byKey;
  }
}

/**
 * Whether THIS row is one this system wrote into THIS document.
 *
 * ── THE ROW NUMBER ALONE IS NOT ENOUGH ──────────────────────────────────────
 * The record names the row and the transport that was written on it. A customer
 * who types another transport over that row has written their own line, and it
 * must be treated as one — so the identity on the row now has to be the identity
 * that was recorded, or the mark simply does not apply.
 *
 * The container is compared in its normalised form, as every other comparison
 * in this module is.
 */
function wasAddedByAudit(
  row: InvoiceSheetRow,
  addedByAudit: ReadonlyMap<number, AuditMarkedRow>,
): boolean {
  const marker = addedByAudit.get(row.rowNumber);

  if (!marker) {
    return false;
  }

  return (
    marker.planningDate === row.planningDate &&
    marker.bookingNumber === row.bookingNumber &&
    marker.normalizedContainerNumber === row.normalizedContainerNumber
  );
}

function toStatus(closedCount: number, candidateCount: number): InvoiceRowStatus {
  if (closedCount === 1) {
    return InvoiceRowStatus.MATCHED;
  }

  if (closedCount > 1) {
    return InvoiceRowStatus.AMBIGUOUS;
  }

  return candidateCount > 0
    ? InvoiceRowStatus.NOT_FINISHED
    : InvoiceRowStatus.NOT_FOUND;
}

/**
 * The three values, as one comparable string.
 *
 * The booking number is compared as it is written — it is an identifier this
 * system stores exactly as the document printed it — while the container is
 * already normalised by both sides before it arrives here.
 */
function toIdentityKey(
  planningDate: string,
  bookingNumber: string,
  normalizedContainerNumber: string,
): string {
  return `${planningDate}|${bookingNumber}|${normalizedContainerNumber}`;
}

/** A stored Trip's identity, or null when it states too little to have one. */
function toTripIdentityKey(trip: Trip): string | null {
  const container = normalizeContainerNumber(trip.containerNumber);

  if (!trip.planningDate || !trip.bookingNumber || container === null) {
    return null;
  }

  return toIdentityKey(toIsoDate(trip.planningDate), trip.bookingNumber, container);
}
