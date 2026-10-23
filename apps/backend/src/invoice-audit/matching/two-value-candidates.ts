import type { Trip } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { isOnInvoiceDate, type PartialCandidates, type RowDecision } from "./row-decisions";
import { describeTrip } from "./trip-words";

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
export function claimedByOthers(
  claims: ReadonlyMap<string, readonly number[]>,
  row: InvoiceSheetRow,
  /** Each row's date, booking and container as one key: rows sharing it are one transport. */
  keyByRow: ReadonlyMap<number, string> = new Map(),
): Set<string> {
  const ownKey = keyByRow.get(row.rowNumber);
  const isOwn = (rowNumber: number) =>
    rowNumber === row.rowNumber || (ownKey !== undefined && keyByRow.get(rowNumber) === ownKey);

  return new Set([...claims].filter(([, rowNumbers]) => !rowNumbers.some(isOwn)).map(([tripId]) => tripId));
}

/** Why a line whose only candidates are other lines' Trips stays unresolved. */
export function toClaimedProblem(
  candidates: readonly Trip[],
  claims: ReadonlyMap<string, readonly number[]>,
  /** The Trips EC charge lines name by their date and booking (`toCostLineClaims`). */
  costLineClaims: ReadonlyMap<string, readonly number[]> = new Map(),
): string {
  const rowsOf = (byTrip: ReadonlyMap<string, readonly number[]>) =>
    [...new Set(candidates.flatMap((trip) => byTrip.get(trip.id) ?? []))].sort((left, right) => left - right);
  const exact = rowsOf(claims);
  const charged = rowsOf(costLineClaims);

  return [
    ...(exact.length > 0
      ? [`Twee van de drie waarden van deze regel wijzen naar een rit die rij ${exact.join(", ")} al exact vermeldt.`]
      : []),
    ...(charged.length > 0
      ? [
          `Datum en container van deze regel wijzen naar rit ${candidates.map(describeTrip).join("; ")}, waarvoor rij ${charged.join(", ")} EC-kosten aanrekent onder zijn eigen boekingsnummer; de container wordt door twee transporten gedeeld of een waarde is fout.`,
        ]
      : []),
  ].join(" ");
}

/** Both kinds of claim on a Trip, by Trip. */
export function withCostLineClaims(
  claims: ReadonlyMap<string, readonly number[]>,
  costLineClaims: ReadonlyMap<string, readonly number[]>,
): Map<string, number[]> {
  const merged = new Map([...claims].map(([tripId, rowNumbers]) => [tripId, [...rowNumbers]]));

  for (const [tripId, rowNumbers] of costLineClaims) {
    merged.set(tripId, [...(merged.get(tripId) ?? []), ...rowNumbers]);
  }

  return merged;
}
