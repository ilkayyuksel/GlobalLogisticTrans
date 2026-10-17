import { Trip, TripStatus } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import { toIsoDate } from "../../common/dates";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import {
  InvoiceRowStatus,
  type BookingCorrection,
  type ContainerCorrection,
} from "./invoice-row-match";

/**
 * Which Trip one transport line is about — the hierarchy, strongest evidence
 * first:
 *
 *   1. date + booking + container — `decideByContainer`;
 *   2. date + booking alone — `decideByBookingAndDate`, reached only when no
 *      Trip of any status holds the line's container: the container was
 *      misprinted;
 *   3. date + container alone — `decideByContainerAndDate`, reached only when
 *      no Trip of any status holds the line's BOOKING on that day: the booking
 *      was misprinted.
 *
 * Each correcting step answers MATCHED only for exactly one CLOSED Trip that
 * states the value it corrects to. Never a fuzzy number, never two values at
 * once: a line whose booking AND container both match nothing is NOT_FOUND.
 */

/** What one line was decided to be, before it is told where it came from. */
export interface RowDecision {
  readonly status: InvoiceRowStatus;
  readonly trip: Trip | null;
  readonly candidates: readonly Trip[];
  readonly containerCorrection: ContainerCorrection | null;
  readonly bookingCorrection: BookingCorrection | null;
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
 * STEP 2 — the line's date and booking alone: the container was misprinted.
 *
 * Every Trip sharing the booking and either date is counted, of any status:
 * with the container gone, nothing says WHICH of them the line is, so only
 * exactly one Trip may answer. Null when NO Trip shares the booking on that
 * day — then step 3 is asked.
 */
export function decideByBookingAndDate(
  row: InvoiceSheetRow,
  onDate: readonly Trip[],
): RowDecision | null {
  if (onDate.length === 0) {
    return null;
  }

  if (onDate.length > 1) {
    return decided(InvoiceRowStatus.AMBIGUOUS, null, onDate);
  }

  const only = onDate[0];

  // A sole Trip without a container has nothing to correct the line to.
  if (!only.containerNumber?.trim()) {
    return notFound();
  }

  if (only.status !== TripStatus.CLOSED) {
    return decided(InvoiceRowStatus.NOT_FINISHED, null, [only]);
  }

  return {
    ...decided(InvoiceRowStatus.MATCHED, only, [only]),
    containerCorrection: {
      invoiceContainerNumber: row.containerNumber,
      tripContainerNumber: only.containerNumber,
    },
  };
}

/**
 * STEP 3 — the line's date and container alone: the booking was misprinted.
 *
 * Reached only when no Trip of any status holds the line's booking on its day.
 * Containers are reused — a Combination's two legs share one, often on one day
 * (week 41: PVDU 1112788 on R75 and R76) — so only exactly ONE Trip on that day
 * holding the container may answer, and it must state a booking of its own.
 */
export function decideByContainerAndDate(
  row: InvoiceSheetRow,
  tripsOnDate: readonly Trip[],
): RowDecision {
  const holding = tripsOnDate.filter(
    (trip) =>
      row.normalizedContainerNumber !== "" &&
      normalizeContainerNumber(trip.containerNumber) === row.normalizedContainerNumber,
  );

  if (holding.length > 1) {
    return decided(InvoiceRowStatus.AMBIGUOUS, null, holding);
  }

  const only = holding[0];

  if (only === undefined || !only.bookingNumber?.trim()) {
    return notFound();
  }

  if (only.status !== TripStatus.CLOSED) {
    return decided(InvoiceRowStatus.NOT_FINISHED, null, [only]);
  }

  return {
    ...decided(InvoiceRowStatus.MATCHED, only, [only]),
    bookingCorrection: {
      invoiceBookingNumber: row.bookingNumber,
      tripBookingNumber: only.bookingNumber,
    },
  };
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
  return { status, trip, candidates, containerCorrection: null, bookingCorrection: null };
}

function notFound(): RowDecision {
  return decided(InvoiceRowStatus.NOT_FOUND, null, []);
}
