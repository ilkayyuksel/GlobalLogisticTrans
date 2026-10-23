import type { Trip } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import type { BookingCorrection } from "./invoice-row-match";
import { decideByTwoValues, isOnInvoiceDate } from "./row-decisions";
import { toPartialCandidates, type PartialSources } from "./two-value-candidates";

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
