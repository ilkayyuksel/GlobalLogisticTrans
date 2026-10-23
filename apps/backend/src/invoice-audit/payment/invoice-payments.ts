import type { ExaminedInvoice } from "../invoice-examination.service";
import { assessMissingTripPayments } from "./missing-trip-payments";
import { NotPayableReason, PaymentCategory, assessPayments, type TripPayment } from "./payment-eligibility";

/**
 * Every transport one examined invoice may settle, and why not where it may not.
 *
 * ONE answer for the preview and for the payment confirmation, so the two can
 * never disagree: the transports the document's lines charge
 * (`payment-eligibility.ts`), then the ones this system holds that the invoice
 * did not state (`missing-trip-payments.ts`).
 *
 * ── A TRANSPORT ITS EC LINES CHARGE, ADDED FOR ITS OWN LINE ─────────────────
 * Its EC lines are on the invoice but are never its own line, so it is added.
 * It is then ONE transport over those rows and the added one: the EC lines'
 * outcome and the added line's together decide, as one entry.
 */
export function assessInvoicePayments(
  examined: Pick<
    ExaminedInvoice,
    "matches" | "pricing" | "missing" | "added" | "blocked" | "firstAddedRowNumber"
  >,
  markedRowNumbers: ReadonlySet<number>,
): TripPayment[] {
  const charged = assessPayments(examined.matches, examined.pricing, markedRowNumbers);
  const addedIds = new Set(examined.added.map((row) => row.trip.id));
  const missing = assessMissingTripPayments(
    {
      added: examined.added,
      firstAddedRowNumber: examined.firstAddedRowNumber,
      notAdded: examined.missing.filter((row) => !addedIds.has(row.trip.id)),
      blocked: examined.blocked,
    },
    new Set(),
  );
  const missingById = new Map(missing.map((payment) => [payment.trip.id, payment]));
  const chargedIds = new Set(charged.map((payment) => payment.trip.id));

  return [
    ...charged.map((payment) => {
      const own = missingById.get(payment.trip.id);

      return own === undefined ? payment : withOwnLine(payment, own);
    }),
    ...missing.filter((payment) => !chargedIds.has(payment.trip.id)),
  ];
}

/** The EC lines' outcome and the added line's, as one transport. */
function withOwnLine(onCostLines: TripPayment, own: TripPayment): TripPayment {
  const reasons = [
    ...new Set([
      ...onCostLines.reasons.filter((reason) => reason !== NotPayableReason.NO_OWN_LINE),
      ...own.reasons,
    ]),
  ];
  const payable = reasons.length === 0;

  return {
    trip: onCostLines.trip,
    rowNumbers: [...new Set([...onCostLines.rowNumbers, ...own.rowNumbers])].sort((left, right) => left - right),
    payable,
    category: payable ? PaymentCategory.ADDED : null,
    reasons,
    blockingRowNumbers: [...new Set([...onCostLines.blockingRowNumbers, ...own.blockingRowNumbers])],
    alreadyPaid: onCostLines.alreadyPaid,
  };
}
