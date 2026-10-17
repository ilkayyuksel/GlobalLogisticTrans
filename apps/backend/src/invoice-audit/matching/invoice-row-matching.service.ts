import { Injectable } from "@nestjs/common";
import { Trip, TripStatus } from "@prisma/client";

import { toUtcDate } from "../../common/dates";
import { AppLoggerService } from "../../logger/app-logger.service";
import { TripRepository } from "../../trips/trip.repository";
import { judgeCombinations, groupIdsOf } from "../combination/combination-verdict";
import { findExcelCombinations } from "../combination/excel-combination-pairs";
import {
  InvoiceAuditReadRepository,
  type InvoiceCostConfirmation,
} from "../invoice-audit-read.repository";
import type { AuditMarkedRow } from "../workbook/invoice-audit-marker";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { decideCostLine } from "./cost-line-matching";
import { withIdentityConflicts } from "./identity-conflicts";
import { InvoiceRowStatus, type InvoiceRowMatch } from "./invoice-row-match";
import {
  decideByBookingAndDate,
  decideByContainer,
  decideByContainerAndDate,
  isOnInvoiceDate,
} from "./row-decisions";

export {
  CombinationVerdict,
  InvoiceRowStatus,
  type BookingCorrection,
  type ContainerCorrection,
  type InvoiceCombination,
  type InvoiceRowMatch,
} from "./invoice-row-match";

/**
 * Statuses a Trip may hold and still be a candidate.
 *
 * DELETED is absent deliberately: a deleted Trip is a record that should not
 * have existed, and reporting a line as "found, but deleted" would offer an
 * answer nobody can act on. Such a line is NOT_FOUND, which is what it is.
 */
const CANDIDATE_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
  TripStatus.CANCELLED,
];

/**
 * Which Trip each invoice line is about — and only that.
 *
 * ── A LINE IS MATCHED TO A TRIP, NOT A TRIP TO A ROUTE ──────────────────────
 * This service answers which transport a row of the Excel is. How that
 * transport's ROUTE was matched for pricing is a different question, read from
 * its stored snapshot by the price check (`price-reliability.ts`).
 *
 * ── THREE KINDS OF ROW ──────────────────────────────────────────────────────
 *   a transport line   by its date, booking and container — see
 *                      `row-decisions.ts` for the hierarchy, including the two
 *                      single-number corrections;
 *   a Cost Confirmation line   by its `EC <nr>` — `cost-line-matching.ts`;
 *   a line this system added   resolved like a transport line, never settled.
 *
 * Then two checks over the whole document: no correction may reach a Trip
 * another line already is (`identity-conflicts.ts`), and every pair the Excel
 * marks as a Combination is judged against the system's own grouping
 * (`combination-verdict.ts`).
 *
 * ── A FIXED NUMBER OF QUERIES FOR THE WHOLE DOCUMENT ────────────────────────
 * The days and bookings go to the database together; every other read —
 * the day's Trips for a misprinted booking, the confirmations, the group sizes
 * — is one query too, and only made when a line needs it.
 */
@Injectable()
export class InvoiceRowMatchingService {
  constructor(
    private readonly trips: TripRepository,
    private readonly reads: InvoiceAuditReadRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoiceRowMatchingService.name);
  }

  async match(
    rows: readonly InvoiceSheetRow[],
    addedByAudit: ReadonlyMap<number, AuditMarkedRow> = new Map(),
  ): Promise<readonly InvoiceRowMatch[]> {
    const transports = await this.matchTransports(
      rows.filter((row) => row.costLine === null),
      addedByAudit,
    );
    const costLines = await this.matchCostLines(rows.filter((row) => row.costLine !== null));
    const resolved = new Map(
      withIdentityConflicts([...transports, ...costLines]).map((match) => [match.row.rowNumber, match]),
    );
    const sharedKeys = rowNumbersByIdentity(rows);
    const inOrder = rows.map((row) => ({
      ...resolved.get(row.rowNumber)!,
      sharedKeyRowNumbers: (sharedKeys.get(identityKey(row)) ?? []).filter(
        (rowNumber) => rowNumber !== row.rowNumber,
      ),
    }));
    const matches = await this.withCombinations(rows, inOrder);

    this.logMatched(matches);

    return matches;
  }

  private async matchTransports(
    rows: readonly InvoiceSheetRow[],
    addedByAudit: ReadonlyMap<number, AuditMarkedRow>,
  ): Promise<InvoiceRowMatch[]> {
    const byBooking = groupByBooking(await this.loadCandidates(rows));
    let tripsOnDates: Trip[] | null = null;
    const matches: InvoiceRowMatch[] = [];

    for (const row of rows) {
      const onDate = (byBooking.get(row.bookingNumber) ?? []).filter((trip) =>
        isOnInvoiceDate(trip, row.planningDate),
      );
      let decided = decideByContainer(row, onDate) ?? decideByBookingAndDate(row, onDate);

      if (decided === null) {
        // No Trip holds this booking on this day: the booking may be misprinted.
        tripsOnDates ??= await this.reads.findTripsOnDates(toDays(rows));
        decided = decideByContainerAndDate(
          row,
          tripsOnDates.filter((trip) => isOnInvoiceDate(trip, row.planningDate)),
        );
      }

      /*
       * A line this system added keeps its own answer, and its numbers are
       * never rewritten: the document's record of it holds the identity it was
       * written with, and a changed number would stop it being recognised.
       */
      const added = wasAddedByAudit(row, addedByAudit);

      matches.push({
        row,
        ...decided,
        status: added ? InvoiceRowStatus.ADDED_MISSING : decided.status,
        containerCorrection: added ? null : decided.containerCorrection,
        bookingCorrection: added ? null : decided.bookingCorrection,
        sharedKeyRowNumbers: [],
        costConfirmation: null,
        combination: null,
        problem: null,
      });
    }

    return matches;
  }

  /** Every Cost Confirmation line, resolved through the confirmation it names. */
  private async matchCostLines(rows: readonly InvoiceSheetRow[]): Promise<InvoiceRowMatch[]> {
    if (rows.length === 0) {
      return [];
    }

    const numbers = [...new Set(rows.flatMap((row) => row.costLine!.ccNumbers))];
    const confirmations = await this.reads.findCostConfirmationsByNumbers(numbers);
    const trips = await this.reads.findTripsByIds([
      ...new Set(confirmations.map((confirmation) => confirmation.tripId)),
    ]);
    const confirmationsByNumber = new Map<string, InvoiceCostConfirmation[]>();

    for (const confirmation of confirmations) {
      confirmationsByNumber.set(confirmation.ccNumber, [
        ...(confirmationsByNumber.get(confirmation.ccNumber) ?? []),
        confirmation,
      ]);
    }

    const tripsById = new Map(trips.map((trip) => [trip.id, trip]));

    return rows.map((row) => ({
      row,
      ...decideCostLine(row, confirmationsByNumber, tripsById),
      sharedKeyRowNumbers: [],
      containerCorrection: null,
      bookingCorrection: null,
      combination: null,
    }));
  }

  /** Every pair the Excel marks as a Combination, judged against the system. */
  private async withCombinations(
    rows: readonly InvoiceSheetRow[],
    matches: readonly InvoiceRowMatch[],
  ): Promise<InvoiceRowMatch[]> {
    const excel = findExcelCombinations(rows);

    if (excel.pairs.length === 0 && excel.unpaired.length === 0) {
      return [...matches];
    }

    const groupSizes = await this.reads.countGroupMembers(groupIdsOf(matches, excel.pairs));
    const verdicts = judgeCombinations(matches, excel, groupSizes);

    return matches.map((match) => ({
      ...match,
      combination: verdicts.get(match.row.rowNumber) ?? null,
    }));
  }

  /** Every Trip the document's transport lines could be about, in one query. */
  private loadCandidates(rows: readonly InvoiceSheetRow[]): Promise<Trip[]> {
    return this.trips.findManyForInvoice({
      invoiceDates: toDays(rows),
      bookingNumbers: [...new Set(rows.map((row) => row.bookingNumber))],
      statuses: CANDIDATE_STATUSES,
    });
  }

  private logMatched(matches: readonly InvoiceRowMatch[]): void {
    const count = (status: InvoiceRowStatus) =>
      matches.filter((match) => match.status === status).length;

    // Counts only. What any of it COSTS is commercial data and is not logged.
    this.logger.log("Invoice lines matched", {
      lineCount: matches.length,
      matched: count(InvoiceRowStatus.MATCHED),
      containerCorrected: matches.filter((match) => match.containerCorrection).length,
      bookingCorrected: matches.filter((match) => match.bookingCorrection).length,
      notFound: count(InvoiceRowStatus.NOT_FOUND),
      notFinished: count(InvoiceRowStatus.NOT_FINISHED),
      ambiguous: count(InvoiceRowStatus.AMBIGUOUS),
      conflicts: count(InvoiceRowStatus.CONFLICT),
      costLines: count(InvoiceRowStatus.COST_LINE),
      costLinesUnresolved: count(InvoiceRowStatus.COST_LINE_UNRESOLVED),
      combinationRows: matches.filter((match) => match.combination).length,
      addedByThisSystem: count(InvoiceRowStatus.ADDED_MISSING),
    });
  }
}

/** The days the rows state, as the database stores a calendar date. */
function toDays(rows: readonly InvoiceSheetRow[]): Date[] {
  return [...new Set(rows.map((row) => row.planningDate))].map(toUtcDate);
}

/**
 * The Trips holding each booking number, each Trip once — so every count of
 * "one, several, none" counts transports and never rows of a result.
 */
function groupByBooking(trips: readonly Trip[]): Map<string, Trip[]> {
  const byBooking = new Map<string, Trip[]>();
  const seen = new Set<string>();

  for (const trip of trips) {
    if (trip.bookingNumber === null || seen.has(trip.id)) {
      continue;
    }

    seen.add(trip.id);
    byBooking.set(trip.bookingNumber, [...(byBooking.get(trip.bookingNumber) ?? []), trip]);
  }

  return byBooking;
}

function rowNumbersByIdentity(rows: readonly InvoiceSheetRow[]): Map<string, number[]> {
  const byKey = new Map<string, number[]>();

  for (const row of rows) {
    byKey.set(identityKey(row), [...(byKey.get(identityKey(row)) ?? []), row.rowNumber]);
  }

  return byKey;
}

/**
 * The line's three values as one comparable string — used only to find the
 * other lines of the same document stating exactly the same three.
 */
function identityKey(row: InvoiceSheetRow): string {
  return `${row.planningDate}|${row.bookingNumber}|${row.normalizedContainerNumber}`;
}

/**
 * Whether THIS row is one this system wrote into THIS document.
 *
 * The record names the row and the transport written on it. A customer who
 * types another transport over that row has written their own line, so the
 * identity on the row must still be the recorded one, or the mark does not
 * apply. The container is compared in its normalised form.
 */
function wasAddedByAudit(
  row: InvoiceSheetRow,
  addedByAudit: ReadonlyMap<number, AuditMarkedRow>,
): boolean {
  const marker = addedByAudit.get(row.rowNumber);

  return (
    marker !== undefined &&
    marker.planningDate === row.planningDate &&
    marker.bookingNumber === row.bookingNumber &&
    marker.normalizedContainerNumber === row.normalizedContainerNumber
  );
}
