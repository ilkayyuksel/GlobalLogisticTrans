import { Trip } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import type { IncompleteInvoiceRow } from "../workbook/invoice-sheet";

/**
 * ── A LINE THAT COULD BE THE TRANSPORT BLOCKS ADDING IT ─────────────────────
 * A finished transport is only added to the invoice when nothing on it could
 * already be that transport. A line that found no Trip, several, one in
 * conflict, a Cost Confirmation line that could not be resolved, a row too
 * incomplete to be a line — each still NAMES a booking or a container. When a
 * candidate transport shares either with such a line, the line may simply be
 * that transport with a typo in its date or booking, and adding it would put it
 * on the invoice twice. So it is NOT added: it is reported beside the line that
 * blocks it, and a person decides.
 *
 * A booking or container stated only by lines that WERE resolved — to other
 * Trips — blocks nothing: week 41 invoices four containers under booking
 * ANRDUB2814746, and a fifth, really missing one must still be found.
 */
const UNRESOLVED: readonly InvoiceRowStatus[] = [
  InvoiceRowStatus.NOT_FOUND,
  InvoiceRowStatus.AMBIGUOUS,
  InvoiceRowStatus.CONFLICT,
  InvoiceRowStatus.COST_LINE_UNRESOLVED,
];

export interface BlockingIdentities {
  /** Booking number → the unresolved rows stating it. */
  readonly bookings: ReadonlyMap<string, readonly number[]>;
  /** Normalised container → the unresolved rows stating it. */
  readonly containers: ReadonlyMap<string, readonly number[]>;
}

export const NO_BLOCKING: BlockingIdentities = { bookings: new Map(), containers: new Map() };

export function toBlockingIdentities(
  matches: readonly InvoiceRowMatch[],
  incompleteRows: readonly IncompleteInvoiceRow[],
): BlockingIdentities {
  const bookings = new Map<string, number[]>();
  const containers = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string | null, rowNumber: number) => {
    if (key) {
      map.set(key, [...(map.get(key) ?? []), rowNumber]);
    }
  };

  for (const match of matches.filter((candidate) => UNRESOLVED.includes(candidate.status))) {
    add(bookings, match.row.bookingNumber, match.row.rowNumber);
    add(containers, match.row.normalizedContainerNumber, match.row.rowNumber);
  }

  for (const row of incompleteRows) {
    add(bookings, row.bookingNumber, row.rowNumber);
    add(containers, row.normalizedContainerNumber, row.rowNumber);
  }

  return { bookings, containers };
}

/** The unresolved rows that could be this transport, in row order; empty when none. */
export function blockingRowsFor(trip: Trip, identities: BlockingIdentities): number[] {
  const container = normalizeContainerNumber(trip.containerNumber);
  const rows = [
    ...(trip.bookingNumber ? (identities.bookings.get(trip.bookingNumber) ?? []) : []),
    ...(container ? (identities.containers.get(container) ?? []) : []),
  ];

  return [...new Set(rows)].sort((left, right) => left - right);
}
