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

/**
 * The invoice named the right transport with the wrong container.
 *
 * Present only on a line matched by booking and date ALONE — see the hierarchy
 * on `InvoiceRowMatchingService` — and only when the Trip states a container of
 * its own to correct it to. The line is an ordinary MATCHED line in every other
 * respect: priced, payable, never marked as a problem.
 */
export interface ContainerCorrection {
  /** Exactly as the sheet spells it — the value that was wrong. */
  readonly invoiceContainerNumber: string;
  /** The Trip's own container, exactly as this system stores it. */
  readonly tripContainerNumber: string;
}

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
  /** Null unless the invoice's container was wrong and is to be corrected. */
  readonly containerCorrection: ContainerCorrection | null;
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
 * ── THE DATE IS EITHER OF THE TRIP'S TWO DATES ──────────────────────────────
 * A Trip states two days: `originalPlanningDate`, the day the order was placed
 * for and fixed when the Trip was created, and `planningDate`, the day the
 * transport is actually on — moved by an operator or a revised order. The
 * customer invoices whichever their own system holds, so a line answers to a
 * Trip when its date EXACTLY equals either one. There is no range and no
 * nearest day: a date that equals neither is not that transport.
 *
 * A Trip answering by both dates is still one Trip. Candidates are Trips, not
 * date matches, so it is counted once.
 *
 * ── THE HIERARCHY, STRONGEST EVIDENCE FIRST ─────────────────────────────────
 *   1. date + booking + container — `decideByContainer`. Whatever else shares
 *      the booking and the day, a Trip holding the invoice's own container
 *      answers. This is the rule the module always had.
 *   2. date + booking alone — `decideByBookingAndDate` — reached ONLY when no
 *      Trip of any status holds the invoice's container. The invoice is then
 *      taken to have misprinted it, but only when exactly ONE Trip shares the
 *      booking and the day; anything else is an ambiguity a person resolves.
 *   3. nothing — NOT_FOUND.
 *
 * The booking number is always required, compared as it is written, and never
 * relaxed: no line is ever matched on its container or its date alone.
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
    const byBooking = this.groupByBooking(candidates);
    const rowNumbersByKey = this.rowNumbersByIdentity(rows);

    const matches = rows.map((row): InvoiceRowMatch => {
      const onDate = (byBooking.get(row.bookingNumber) ?? []).filter((trip) =>
        isOnInvoiceDate(trip, row.planningDate),
      );
      const decided =
        decideByContainer(row, onDate) ?? decideByBookingAndDate(row, onDate);
      const key = toIdentityKey(
        row.planningDate,
        row.bookingNumber,
        row.normalizedContainerNumber,
      );

      /*
       * A line this system added to this document keeps its own answer. It
       * still resolves to its Trip — the prices are compared and corrected
       * exactly as any other line's — but it can never be settled.
       *
       * And its container is never rewritten. The document's record of that
       * line holds the identity it was written with; changing the container
       * would make the record stop recognising it, and the next upload would
       * then settle a transport nobody invoiced.
       */
      const added = wasAddedByAudit(row, addedByAudit);

      return {
        row,
        status: added ? InvoiceRowStatus.ADDED_MISSING : decided.status,
        trip: decided.trip,
        candidates: decided.candidates,
        sharedKeyRowNumbers: (rowNumbersByKey.get(key) ?? []).filter(
          (rowNumber) => rowNumber !== row.rowNumber,
        ),
        containerCorrection: added ? null : decided.containerCorrection,
      };
    });

    this.logger.log("Invoice lines matched", {
      lineCount: rows.length,
      candidateTripCount: candidates.length,
      // Counts only. A booking number is an identifier and may be logged; what
      // any of it COSTS is commercial data and is not logged anywhere.
      matched: matches.filter((match) => match.status === "MATCHED").length,
      containerCorrected: matches.filter(
        (match) => match.containerCorrection !== null,
      ).length,
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
    const invoiceDates = [...new Set(rows.map((row) => row.planningDate))].map(
      toUtcDate,
    );
    const bookingNumbers = [...new Set(rows.map((row) => row.bookingNumber))];

    return this.trips.findManyForInvoice({
      invoiceDates,
      bookingNumbers,
      statuses: CANDIDATE_STATUSES,
    });
  }

  /**
   * The Trips holding each booking number, each Trip once.
   *
   * Deduplicated by id here, whatever the query returned, so that every count
   * below — one, several, none — counts transports and never rows of a result.
   */
  private groupByBooking(trips: readonly Trip[]): Map<string, Trip[]> {
    const byBooking = new Map<string, Trip[]>();
    const seen = new Set<string>();

    for (const trip of trips) {
      if (trip.bookingNumber === null || seen.has(trip.id)) {
        continue;
      }

      seen.add(trip.id);
      byBooking.set(trip.bookingNumber, [
        ...(byBooking.get(trip.bookingNumber) ?? []),
        trip,
      ]);
    }

    return byBooking;
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

/** What one line was decided to be, before it is told where it came from. */
interface Decision {
  readonly status: InvoiceRowStatus;
  readonly trip: Trip | null;
  readonly candidates: readonly Trip[];
  readonly containerCorrection: ContainerCorrection | null;
}

/**
 * STEP 1 — the Trips on the line's date and booking that hold its container.
 *
 * Null when none does, which is the only way step 2 is ever reached. A Trip of
 * ANY status holding the invoice's exact container ends the search here:
 *
 *   one CLOSED Trip        MATCHED, whatever else shares the booking and day
 *   several CLOSED Trips   AMBIGUOUS
 *   only unfinished ones   NOT_FINISHED — the invoice named this very
 *                          transport, it simply is not closed yet, and
 *                          handing the line to step 2 could settle it against
 *                          a DIFFERENT, closed Trip on the same booking
 */
function decideByContainer(
  row: InvoiceSheetRow,
  onDate: readonly Trip[],
): Decision | null {
  const holding = onDate.filter(
    (trip) =>
      normalizeContainerNumber(trip.containerNumber) ===
      row.normalizedContainerNumber,
  );

  if (holding.length === 0) {
    return null;
  }

  const closed = holding.filter((trip) => trip.status === TripStatus.CLOSED);

  return {
    status: toStatus(closed.length, holding.length),
    trip: closed.length === 1 ? closed[0] : null,
    candidates: holding,
    containerCorrection: null,
  };
}

/**
 * STEP 2 — the line's date and booking alone: the invoice misprinted the
 * container.
 *
 * ── EXACTLY ONE TRIP, OF ANY STATUS ─────────────────────────────────────────
 * Every Trip sharing the booking and either date is counted — OPEN and
 * CANCELLED ones too, not only CLOSED. With the container gone, nothing on the
 * line says WHICH of them it is: a booking carrying a closed Trip and an open
 * one could be invoicing either, and settling the closed one because the open
 * one "cannot be invoiced yet" would pay a transport on a guess. So:
 *
 *   no Trip                    NOT_FOUND
 *   several Trips              AMBIGUOUS — nothing corrected, nothing paid
 *   one Trip, not CLOSED       NOT_FINISHED
 *   one CLOSED Trip            MATCHED, with the container corrected to the
 *                              Trip's own
 *
 * A sole CLOSED Trip that states no container has nothing to correct the line
 * to, and a correction that blanked the customer's value would destroy the one
 * container the line does state. It is left NOT_FOUND, as it always was.
 */
function decideByBookingAndDate(
  row: InvoiceSheetRow,
  onDate: readonly Trip[],
): Decision {
  if (onDate.length > 1) {
    return {
      status: InvoiceRowStatus.AMBIGUOUS,
      trip: null,
      candidates: onDate,
      containerCorrection: null,
    };
  }

  const only = onDate[0];

  if (only === undefined || !only.containerNumber?.trim()) {
    return {
      status: InvoiceRowStatus.NOT_FOUND,
      trip: null,
      candidates: [],
      containerCorrection: null,
    };
  }

  if (only.status !== TripStatus.CLOSED) {
    return {
      status: InvoiceRowStatus.NOT_FINISHED,
      trip: null,
      candidates: [only],
      containerCorrection: null,
    };
  }

  return {
    status: InvoiceRowStatus.MATCHED,
    trip: only,
    candidates: [only],
    containerCorrection: {
      invoiceContainerNumber: row.containerNumber,
      tripContainerNumber: only.containerNumber,
    },
  };
}

/**
 * Whether the Trip is on the line's date: its planned day or the day it was
 * originally ordered for, exactly. Never a range.
 */
function isOnInvoiceDate(trip: Trip, invoiceDate: string): boolean {
  return [trip.planningDate, trip.originalPlanningDate].some(
    (date) =>
      date !== null && date !== undefined && toIsoDate(date) === invoiceDate,
  );
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
 * The line's three values, as one comparable string — used only to find the
 * other lines of the same document stating exactly the same three.
 */
function toIdentityKey(
  planningDate: string,
  bookingNumber: string,
  normalizedContainerNumber: string,
): string {
  return `${planningDate}|${bookingNumber}|${normalizedContainerNumber}`;
}
