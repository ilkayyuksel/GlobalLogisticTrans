import type { ExaminedInvoice } from "../invoice-examination.service";
import { assessMissingTripPayments } from "./missing-trip-payments";
import { assessPayments, type TripPayment } from "./payment-eligibility";

/**
 * Every transport one examined invoice may settle, and why not where it may not.
 *
 * ONE answer for the preview and for the payment confirmation, so the two can
 * never disagree: the transports the document's lines charge
 * (`payment-eligibility.ts`), then the ones this system holds that the invoice
 * did not state (`missing-trip-payments.ts`).
 */
export function assessInvoicePayments(
  examined: Pick<
    ExaminedInvoice,
    "matches" | "pricing" | "missing" | "added" | "blocked" | "firstAddedRowNumber"
  >,
  markedRowNumbers: ReadonlySet<number>,
): TripPayment[] {
  const charged = assessPayments(examined.matches, examined.pricing, markedRowNumbers);
  const added = new Set(examined.added.map((row) => row.trip.id));

  return [
    ...charged,
    ...assessMissingTripPayments(
      {
        added: examined.added,
        firstAddedRowNumber: examined.firstAddedRowNumber,
        notAdded: examined.missing.filter((row) => !added.has(row.trip.id)),
        blocked: examined.blocked,
      },
      new Set(charged.map((payment) => payment.trip.id)),
    ),
  ];
}
