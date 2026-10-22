import { TripStatus, type Trip } from "@prisma/client";

import { sheetRow, tripRecord } from "../__fixtures__/invoice-rows";
import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import { InvoicePricingStatus, type InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import { assessPayments } from "./payment-eligibility";

function match(
  rowNumber: number,
  status: InvoiceRowStatus,
  trip: Trip | null,
  candidates: Trip[] = [],
): InvoiceRowMatch {
  return {
    row: sheetRow({ rowNumber }),
    status,
    trip,
    candidates,
    sharedKeyRowNumbers: [],
    containerCorrection: null,
    bookingCorrection: null,
    dateCorrection: null,
    costConfirmation: null,
    combination: null,
    problem: null,
  };
}

function priced(...entries: [number, InvoicePricingStatus][]): Map<number, InvoiceRowPricing> {
  return new Map(
    entries.map(([rowNumber, status]) => [
      rowNumber,
      { rowNumber, status, differences: [], reliability: null },
    ]),
  );
}

const ONE = tripRecord({ id: "one" });

describe("assessPayments", () => {
  it("pays a transport whose own line came out unchanged", () => {
    const [payment] = assessPayments(
      [match(2, InvoiceRowStatus.MATCHED, ONE)],
      priced([2, InvoicePricingStatus.MATCHED_NO_CHANGES]),
      new Set(),
    );

    expect(payment).toMatchObject({ payable: true, category: "UNCHANGED", reasons: [], rowNumbers: [2] });
  });

  it("puts a higher invoice price above a raise, so it is shown apart", () => {
    const [payment] = assessPayments(
      [match(2, InvoiceRowStatus.MATCHED, ONE), match(3, InvoiceRowStatus.COST_LINE, ONE)],
      priced(
        [2, InvoicePricingStatus.PRICING_CORRECTED],
        [3, InvoicePricingStatus.INVOICE_HIGHER],
      ),
      new Set(),
    );

    expect(payment).toMatchObject({ payable: true, category: "INVOICE_HIGHER", rowNumbers: [2, 3] });
  });

  it("keeps a transport unpaid when one of its Cost Confirmation lines came out wrong", () => {
    const [payment] = assessPayments(
      [match(2, InvoiceRowStatus.MATCHED, ONE), match(3, InvoiceRowStatus.COST_LINE, ONE)],
      priced(
        [2, InvoicePricingStatus.MATCHED_NO_CHANGES],
        [3, InvoicePricingStatus.NOT_DISTRIBUTABLE],
      ),
      new Set([3]),
    );

    expect(payment.payable).toBe(false);
    expect(payment.reasons).toEqual(["LINE_MARKED", "PRICE_NOT_SETTLED"]);
  });

  it("keeps a transport unpaid that an unresolved line could also be", () => {
    const [payment] = assessPayments(
      [
        match(2, InvoiceRowStatus.MATCHED, ONE),
        match(3, InvoiceRowStatus.AMBIGUOUS, null, [ONE, tripRecord({ id: "two" })]),
      ],
      priced([2, InvoicePricingStatus.MATCHED_NO_CHANGES]),
      new Set([3]),
    );

    expect(payment).toMatchObject({ payable: false, reasons: ["AMBIGUOUS_MATCH"], blockingRowNumbers: [3] });
  });

  /**
   * An EC line whose booking does not match its confirmation's Trip names that
   * Trip, but it is never the transport's own line: only its EK is unchecked.
   */
  it("pays a transport whose EC line could not be linked", () => {
    const ecLine = {
      ...match(3, InvoiceRowStatus.COST_LINE_UNRESOLVED, null, [ONE]),
      row: sheetRow({ rowNumber: 3, costLine: { ccNumbers: ["4214683"] } }),
    };
    const [payment] = assessPayments(
      [match(2, InvoiceRowStatus.MATCHED, ONE), ecLine],
      priced([2, InvoicePricingStatus.MATCHED_NO_CHANGES]),
      new Set([3]),
    );

    expect(payment).toMatchObject({ payable: true, reasons: [], blockingRowNumbers: [] });
  });

  it("lists a transport only an ambiguous line names, with that row, never silently", () => {
    const payments = assessPayments(
      [match(9, InvoiceRowStatus.AMBIGUOUS, null, [ONE, tripRecord({ id: "two" })])],
      new Map(),
      new Set([9]),
    );

    expect(payments).toEqual([
      expect.objectContaining({ trip: ONE, payable: false, reasons: ["AMBIGUOUS_MATCH"], blockingRowNumbers: [9] }),
      expect.objectContaining({ payable: false, reasons: ["AMBIGUOUS_MATCH"], blockingRowNumbers: [9] }),
    ]);
  });

  it("names a conflict as a conflict, and an unfinished candidate as not closed", () => {
    const open = tripRecord({ id: "open", status: TripStatus.OPEN });
    const payments = assessPayments(
      [match(4, InvoiceRowStatus.CONFLICT, null, [ONE]), match(5, InvoiceRowStatus.NOT_FINISHED, null, [open])],
      new Map(),
      new Set([4, 5]),
    );

    expect(payments.map((payment) => [payment.trip.id, payment.reasons, payment.blockingRowNumbers])).toEqual([
      ["one", ["MATCH_CONFLICT"], [4]],
      ["open", ["NOT_CLOSED"], [5]],
    ]);
  });

  /** A line this check added earlier is the transport's own line. */
  it("pays a transport through the line this check added to the document earlier", () => {
    const [payment] = assessPayments(
      [match(4, InvoiceRowStatus.ADDED_MISSING, ONE)],
      priced([4, InvoicePricingStatus.MATCHED_NO_CHANGES]),
      new Set(),
    );

    expect(payment).toMatchObject({ payable: true, category: "UNCHANGED", reasons: [] });
  });

  it("keeps such a line unpaid when its price is a problem", () => {
    const [payment] = assessPayments(
      [match(4, InvoiceRowStatus.ADDED_MISSING, ONE)],
      priced([4, InvoicePricingStatus.PRICE_UNRELIABLE]),
      new Set([4]),
    );

    expect(payment).toMatchObject({ payable: false, reasons: ["LINE_MARKED", "PRICE_NOT_SETTLED"] });
  });

  it("never pays a Trip that is not CLOSED", () => {
    const [payment] = assessPayments(
      [match(2, InvoiceRowStatus.MATCHED, tripRecord({ id: "one", status: TripStatus.OPEN }))],
      priced([2, InvoicePricingStatus.MATCHED_NO_CHANGES]),
      new Set(),
    );

    expect(payment.reasons).toEqual(["NOT_CLOSED"]);
  });

  it("reports a re-invoiced transport as already paid", () => {
    const [payment] = assessPayments(
      [match(2, InvoiceRowStatus.MATCHED, tripRecord({ id: "one", isPaid: true }))],
      priced([2, InvoicePricingStatus.MATCHED_NO_CHANGES]),
      new Set(),
    );

    expect(payment).toMatchObject({ payable: true, alreadyPaid: true });
  });
});
