import { Trip, TripStatus } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import { toIsoDate } from "../../common/dates";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import {
  InvoiceRowStatus,
  type BookingCorrection,
  type ContainerCorrection,
  type DateCorrection,
} from "./invoice-row-match";

/**
 * Which Trip one transport line is about — the hierarchy, strongest evidence
 * first:
 *
 *   1. date + booking + container — `decideByContainer`;
 *   2. any TWO of the three — `decideByTwoValues`: date + booking (the
 *      container was misprinted), date + container (the booking was), or
 *      booking + container (the date was), judged together.
 *
 * The correcting step answers MATCHED only for exactly one CLOSED Trip that
 * states the value it corrects to. Never a fuzzy number, never two values at
 * once: a line sharing only one value with every Trip is NOT_FOUND.
 */

/** What one line was decided to be, before it is told where it came from. */
export interface RowDecision {
  readonly status: InvoiceRowStatus;
  readonly trip: Trip | null;
  readonly candidates: readonly Trip[];
  readonly containerCorrection: ContainerCorrection | null;
  readonly bookingCorrection: BookingCorrection | null;
  readonly dateCorrection: DateCorrection | null;
}

/**
 * STEP 1 — the Trips on the line's date and booking that hold its container.
 *
 * Null when none does. A Trip of ANY status holding the exact container ends
 * the search here: one CLOSED is MATCHED, several CLOSED are AMBIGUOUS, only
 * unfinished ones are NOT_FINISHED — handing the line on could settle it
 * against a different, closed Trip on the same booking.
 */
export function decideByContainer(
  row: InvoiceSheetRow,
  onDate: readonly Trip[],
): RowDecision | null {
  const holding = onDate.filter(
    (trip) => normalizeContainerNumber(trip.containerNumber) === row.normalizedContainerNumber,
  );

  if (holding.length === 0) {
    return null;
  }

  const closed = holding.filter((trip) => trip.status === TripStatus.CLOSED);

  return decided(toStatus(closed.length, holding.length), closed.length === 1 ? closed[0] : null, holding);
}

/**
 * The Trips that share exactly TWO of a line's three values — the evidence for
 * a line with one value misprinted. A Trip sharing all three is an exact match
 * and is decided by `decideByContainer`; one sharing a single value is never a
 * candidate at all.
 */
export interface PartialCandidates {
  /** The line's date and booking, another container: the container is wrong. */
  readonly dateAndBooking: readonly Trip[];
  /** The line's date and container, another booking: the booking is wrong. */
  readonly dateAndContainer: readonly Trip[];
  /** The line's booking and container, on another day: the date is wrong. */
  readonly bookingAndContainer: readonly Trip[];
}

/**
 * STEP 2 — a line no Trip matches on all three values, judged on the Trips that
 * share two of them, all three ways at once.
 *
 * ── A TRIP ANOTHER LINE ALREADY IS, IS NOT A CANDIDATE ──────────────────────
 * `claimedExactly` holds the Trips other lines of the document match on all
 * three values. Such a Trip is accounted for, so it cannot explain THIS line —
 * which is how a line with a misprinted date finds its own Trip instead of the
 * one its booking shares a day with. When ONLY such Trips share two values, the
 * line is a CONFLICT: it may be that same transport invoiced twice, and a
 * person decides.
 *
 * ── ONE TRIP OR NONE ────────────────────────────────────────────────────────
 * Exactly one remaining Trip answers MATCHED (CLOSED) or NOT_FINISHED, with the
 * one value that differs corrected to the Trip's own. Two or more are
 * AMBIGUOUS and nothing is chosen, whichever pairs of values they share.
 */
export function decideByTwoValues(
  row: InvoiceSheetRow,
  partial: PartialCandidates,
  claimedExactly: ReadonlySet<string>,
): RowDecision {
  const all = uniqueTrips([
    ...partial.dateAndBooking,
    ...partial.dateAndContainer,
    ...partial.bookingAndContainer,
  ]);
  const free = all.filter((trip) => !claimedExactly.has(trip.id));

  if (free.length > 1) {
    return decided(InvoiceRowStatus.AMBIGUOUS, null, free);
  }

  if (free.length === 0) {
    return all.length > 0 ? decided(InvoiceRowStatus.CONFLICT, null, all) : notFound();
  }

  const only = free[0];
  const correction = toCorrection(row, only, partial);

  // A sole Trip lacking the value the line would be corrected to answers nothing.
  if (correction === null) {
    return notFound();
  }

  if (only.status !== TripStatus.CLOSED) {
    return decided(InvoiceRowStatus.NOT_FINISHED, null, [only]);
  }

  return { ...decided(InvoiceRowStatus.MATCHED, only, [only]), ...correction };
}

/** The one value of the line that the Trip shows to be wrong, corrected to the Trip's. */
function toCorrection(
  row: InvoiceSheetRow,
  trip: Trip,
  partial: PartialCandidates,
): Pick<RowDecision, "containerCorrection" | "bookingCorrection" | "dateCorrection"> | null {
  const none = { containerCorrection: null, bookingCorrection: null, dateCorrection: null };

  if (partial.dateAndBooking.includes(trip)) {
    return trip.containerNumber?.trim()
      ? {
          ...none,
          containerCorrection: {
            invoiceContainerNumber: row.containerNumber,
            tripContainerNumber: trip.containerNumber,
          },
        }
      : null;
  }

  if (partial.dateAndContainer.includes(trip)) {
    return trip.bookingNumber?.trim()
      ? {
          ...none,
          bookingCorrection: { invoiceBookingNumber: row.bookingNumber, tripBookingNumber: trip.bookingNumber },
        }
      : null;
  }

  return trip.planningDate
    ? {
        ...none,
        dateCorrection: { invoicePlanningDate: row.planningDate, tripPlanningDate: toIsoDate(trip.planningDate) },
      }
    : null;
}

/** Each Trip once, in the order first given. */
function uniqueTrips(trips: readonly Trip[]): Trip[] {
  const seen = new Set<string>();

  return trips.filter((trip) => !seen.has(trip.id) && Boolean(seen.add(trip.id)));
}

/**
 * Whether the Trip is on the line's date: its planned day or the day it was
 * originally ordered for, exactly. Never a range.
 */
export function isOnInvoiceDate(trip: Trip, invoiceDate: string): boolean {
  return [trip.planningDate, trip.originalPlanningDate].some(
    (date) => date !== null && date !== undefined && toIsoDate(date) === invoiceDate,
  );
}

function toStatus(closedCount: number, candidateCount: number): InvoiceRowStatus {
  if (closedCount === 1) {
    return InvoiceRowStatus.MATCHED;
  }

  if (closedCount > 1) {
    return InvoiceRowStatus.AMBIGUOUS;
  }

  return candidateCount > 0 ? InvoiceRowStatus.NOT_FINISHED : InvoiceRowStatus.NOT_FOUND;
}

function decided(
  status: InvoiceRowStatus,
  trip: Trip | null,
  candidates: readonly Trip[],
): RowDecision {
  return { status, trip, candidates, containerCorrection: null, bookingCorrection: null, dateCorrection: null };
}

function notFound(): RowDecision {
  return decided(InvoiceRowStatus.NOT_FOUND, null, []);
}
