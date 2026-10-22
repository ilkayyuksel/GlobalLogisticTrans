import type { Trip } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { isOnInvoiceDate, type PartialCandidates, type RowDecision } from "./row-decisions";

/**
 * Where the Trips sharing two of a line's values come from — read once for the
 * whole document, and only when some line matched nothing exactly.
 */
export interface PartialSources {
  /** Every Trip (not DELETED) planned or originally ordered on the document's days. */
  readonly tripsOnDates: readonly Trip[];
  /** Every Trip (not DELETED) holding one of the unmatched lines' bookings, on any day. */
  readonly tripsByBooking: readonly Trip[];
}

/**
 * The Trips sharing exactly two of this line's values, by which two.
 *
 * `onDate` are the Trips on the line's day under its own booking. None of them
 * holds its container — the line would have matched exactly — so all of them
 * share the date and the booking and nothing else.
 */
export function toPartialCandidates(
  row: InvoiceSheetRow,
  onDate: readonly Trip[],
  sources: PartialSources,
): PartialCandidates {
  const holdsContainer = (trip: Trip) =>
    row.normalizedContainerNumber !== "" &&
    normalizeContainerNumber(trip.containerNumber) === row.normalizedContainerNumber;

  return {
    dateAndBooking: onDate,
    dateAndContainer: sources.tripsOnDates.filter(
      (trip) =>
        isOnInvoiceDate(trip, row.planningDate) && holdsContainer(trip) && trip.bookingNumber !== row.bookingNumber,
    ),
    bookingAndContainer: sources.tripsByBooking.filter(
      (trip) =>
        trip.bookingNumber === row.bookingNumber && holdsContainer(trip) && !isOnInvoiceDate(trip, row.planningDate),
    ),
  };
}

/**
 * Which rows of the document match each Trip on all three values — every Trip
 * such a line names, whatever its status, so a line that found an unfinished
 * Trip still accounts for it.
 */
export function toExactClaims(
  rows: readonly InvoiceSheetRow[],
  exact: ReadonlyMap<number, RowDecision | null>,
): Map<string, number[]> {
  const claims = new Map<string, number[]>();

  for (const row of rows) {
    for (const trip of exact.get(row.rowNumber)?.candidates ?? []) {
      claims.set(trip.id, [...(claims.get(trip.id) ?? []), row.rowNumber]);
    }
  }

  return claims;
}

/**
 * The Trips other lines already are. A line asking this matched nothing
 * exactly itself, so every exact claim is another line's.
 */
export function claimedByOthers(claims: ReadonlyMap<string, readonly number[]>, row: InvoiceSheetRow): Set<string> {
  return new Set([...claims].filter(([, rowNumbers]) => !rowNumbers.includes(row.rowNumber)).map(([tripId]) => tripId));
}

/** Why a line whose only candidates are other lines' Trips stays unresolved. */
export function toClaimedProblem(
  candidates: readonly Trip[],
  claims: ReadonlyMap<string, readonly number[]>,
): string {
  const rowNumbers = [...new Set(candidates.flatMap((trip) => claims.get(trip.id) ?? []))].sort(
    (left, right) => left - right,
  );

  return `Twee van de drie waarden van deze regel wijzen naar een rit die rij ${rowNumbers.join(", ")} al exact vermeldt.`;
}
