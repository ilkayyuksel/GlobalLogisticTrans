import { TripStatus } from "@prisma/client";

import type { AddedRow } from "../missing/added-rows";
import type { BlockedMissingTrip } from "../missing/missing-trips.service";
import {
  NotPayableReason,
  PaymentCategory,
  type TripPayment,
} from "./payment-eligibility";

/**
 * The finished transports this system holds that the customer's invoice did not
 * state — see `missing/` — as the payment rule sees them.
 */
export interface MissingTripsForPayment {
  /** Written into the corrected document, directly above its totals. */
  readonly added: readonly AddedRow[];
  /** The row the first of `added` was written on; null when none was. */
  readonly firstAddedRowNumber: number | null;
  /** Found, but not written: the document's totals could not take a line. */
  readonly notAdded: readonly AddedRow[];
  /** Not written, because an unresolved line of the document could be them. */
  readonly blocked: readonly BlockedMissingTrip[];
}

/**
 * Whether each transport the invoice did not state is settled by it.
 *
 * ── PAID LIKE ANY OTHER, UNLESS ITS PRICE IS A PROBLEM (OWNER, OCTOBER 2026) ─
 * The corrected document the customer pays carries these transports as lines
 * of their own. So a transport added with a price this system relies on is
 * paid with the rest; one added WITHOUT amounts — its price could not be
 * relied on, the line is yellow — stays unpaid. Not being on the customer's
 * original document is no longer a reason on its own.
 *
 * Two kinds stay unpaid for a reason that is not about money, because the
 * customer does not pay for them on this document:
 *   * not added — the document's totals would have left the line out, so the
 *     corrected invoice does not carry it;
 *   * blocked — an unresolved line may be this very transport, an open conflict
 *     like any other.
 */
export function assessMissingTripPayments(
  missing: MissingTripsForPayment,
  tripIdsOnInvoice: ReadonlySet<string>,
): TripPayment[] {
  const added = missing.added.map((row, index) =>
    toAddedPayment(row, missing.firstAddedRowNumber === null ? [] : [missing.firstAddedRowNumber + index]),
  );
  const notAdded = missing.notAdded.map((row) =>
    notPayable(row.trip, [], [NotPayableReason.NOT_ADDED]),
  );
  const blocked = missing.blocked.map((row) =>
    notPayable(row.trip, [], [NotPayableReason.OPEN_CONFLICT]),
  );

  // Never a second entry for a Trip a line of the document already charges.
  return [...added, ...notAdded, ...blocked].filter(
    (payment) => !tripIdsOnInvoice.has(payment.trip.id),
  );
}

function toAddedPayment(row: AddedRow, rowNumbers: number[]): TripPayment {
  const reasons: NotPayableReason[] = [];

  if (row.trip.status !== TripStatus.CLOSED) {
    reasons.push(NotPayableReason.NOT_CLOSED);
  }

  // The line was written without amounts, and marked yellow.
  if (!row.reliability.reliable || row.pricing === null) {
    reasons.push(NotPayableReason.PRICE_NOT_SETTLED);
  }

  return reasons.length > 0
    ? notPayable(row.trip, rowNumbers, reasons)
    : {
        trip: row.trip,
        rowNumbers,
        payable: true,
        category: PaymentCategory.ADDED,
        reasons: [],
        alreadyPaid: row.trip.isPaid,
      };
}

function notPayable(
  trip: TripPayment["trip"],
  rowNumbers: number[],
  reasons: NotPayableReason[],
): TripPayment {
  return { trip, rowNumbers, payable: false, category: null, reasons, alreadyPaid: trip.isPaid };
}
