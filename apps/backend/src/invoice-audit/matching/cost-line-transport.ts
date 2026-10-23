import type { Trip } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import type { BookingCorrection } from "./invoice-row-match";
import { decideByTwoValues, isOnInvoiceDate } from "./row-decisions";
import { toPartialCandidates, type PartialSources } from "./two-value-candidates";

/**
 * The Trips EC charge lines name by their own date and booking — lines stating
 * no container, which are never a transport's own line (`ec-transport-lines.ts`).
 *
 * ── A TRANSPORT ITS EC LINES NAME IS NOT ANOTHER LINE'S MISPRINT ───────────
 * Containers are shared: two transports on one day, one container. Week 41
 * R42 (ANRDUB2813293, to Laakdal) states PVDU 1106430, the container of the
 * transport R53-R54 charge EC costs for under their own booking ANRDUB2812770.
 * When R42 cannot find its own Trip, its date and container still reach that
 * other transport, and correcting R42's booking to it would make the one line
 * both transports. Such a Trip is therefore CLAIMED by its EC lines, as a Trip
 * another line matches exactly is: no free candidate for a correction, and a
 * line only it could be is a conflict naming those EC lines.
 */
export function toCostLineClaims(
  rows: readonly InvoiceSheetRow[],
  sources: PartialSources,
): Map<string, number[]> {
  const claims = new Map<string, number[]>();

  for (const row of rows.filter((each) => each.costLine !== null && each.normalizedContainerNumber === "")) {
    const transport = identifyCostLineTransport(row, sources);

    if (transport !== null) {
      claims.set(transport.trip.id, [...(claims.get(transport.trip.id) ?? []), row.rowNumber]);
    }
  }

  return claims;
}

/** The transport an EC line is about, found apart from its confirmation. */
export interface IdentifiedTransport {
  readonly trip: Trip;
  /** Set when the line's booking is misprinted and its other values name the Trip. */
  readonly bookingCorrection: BookingCorrection | null;
}

/**
 * Which transport an EC line is about when its confirmation could NOT be found
 * — so the report can say whether the transport itself is known, apart from
 * whether its confirmation is.
 *
 * The same evidence as a transport line: all three values, or any two of them
 * naming exactly one Trip (`decideByTwoValues`). An EC line states no container
 * more often than not; then only its date and booking can name the Trip.
 *
 * Only a misprinted BOOKING is corrected on an EC line. Its date may lawfully
 * differ — a confirmation is often invoiced after its transport ran — and a
 * container it does not state is nothing to correct.
 */
export function identifyCostLineTransport(row: InvoiceSheetRow, sources: PartialSources): IdentifiedTransport | null {
  const sameBookingOnDate = sources.tripsOnDates.filter(
    (trip) => trip.bookingNumber === row.bookingNumber && isOnInvoiceDate(trip, row.planningDate),
  );

  if (row.normalizedContainerNumber === "") {
    return sameBookingOnDate.length === 1 ? { trip: sameBookingOnDate[0], bookingCorrection: null } : null;
  }

  const exact = sameBookingOnDate.filter(
    (trip) => normalizeContainerNumber(trip.containerNumber) === row.normalizedContainerNumber,
  );

  if (exact.length > 0) {
    return exact.length === 1 ? { trip: exact[0], bookingCorrection: null } : null;
  }

  const decided = decideByTwoValues(row, toPartialCandidates(row, sameBookingOnDate, sources), new Set());

  return decided.candidates.length === 1 && decided.containerCorrection === null
    ? { trip: decided.candidates[0], bookingCorrection: decided.bookingCorrection }
    : null;
}
