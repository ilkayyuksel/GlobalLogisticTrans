import { Prisma, TripStatus } from "@prisma/client";

import { reliablyPriced } from "../__fixtures__/invoice-pricing";
import { tripRecord } from "../__fixtures__/invoice-rows";
import type { AddedRow } from "../missing/added-rows";
import { PriceProblem } from "../pricing/price-reliability";
import { assessMissingTripPayments, type MissingTripsForPayment } from "./missing-trip-payments";

/**
 * Whether a transport this system holds and the customer's invoice did not
 * state is settled by the corrected invoice — only its price can stop it.
 */

const zero = new Prisma.Decimal(0);
const PRICED = reliablyPriced({
  components: [],
  tarief: new Prisma.Decimal("200"),
  brandstof: new Prisma.Decimal("20"),
  backload: zero,
  tol: zero,
  tunnel: zero,
  others: zero,
  ek: zero,
  totaal: new Prisma.Decimal("220"),
});

function added(id: string, reliable = true): AddedRow {
  return {
    trip: tripRecord({ id, status: TripStatus.CLOSED, isPaid: false }),
    pricing: reliable ? PRICED : null,
    route: "Quay 869 -> MELSELE",
    remarks: "",
    remarkNotes: [],
    combinationEnd: null,
    reliability: reliable
      ? { reliable: true, problem: null, explanation: null, route: null }
      : { reliable: false, problem: PriceProblem.NO_SNAPSHOT, explanation: "De rit is nooit geprijsd.", route: null },
  };
}

function missing(overrides: Partial<MissingTripsForPayment>): MissingTripsForPayment {
  return { added: [], firstAddedRowNumber: 128, notAdded: [], blocked: [], ...overrides };
}

describe("assessMissingTripPayments", () => {
  it("settles a transport added with a price this system relies on", () => {
    expect(assessMissingTripPayments(missing({ added: [added("a")] }), new Set())).toEqual([
      expect.objectContaining({
        payable: true,
        category: "ADDED",
        reasons: [],
        rowNumbers: [128],
        alreadyPaid: false,
      }),
    ]);
  });

  it("gives each added transport the row it was written on", () => {
    const payments = assessMissingTripPayments(missing({ added: [added("a"), added("b")] }), new Set());

    expect(payments.map((payment) => payment.rowNumbers)).toEqual([[128], [129]]);
  });

  /** The one reason that keeps it unpaid: its price. */
  it("leaves a transport added without a reliable price unpaid", () => {
    expect(assessMissingTripPayments(missing({ added: [added("a", false)] }), new Set())).toEqual([
      expect.objectContaining({ payable: false, category: null, reasons: ["PRICE_NOT_SETTLED"] }),
    ]);
  });

  it("leaves a transport the corrected invoice does not carry unpaid", () => {
    expect(assessMissingTripPayments(missing({ notAdded: [added("a")] }), new Set())).toEqual([
      expect.objectContaining({ payable: false, reasons: ["NOT_ADDED"], rowNumbers: [] }),
    ]);
  });

  it("leaves a transport an unresolved line could be unpaid", () => {
    const blocked = { trip: tripRecord({ id: "a" }), blockingRowNumbers: [7] };

    expect(assessMissingTripPayments(missing({ blocked: [blocked] }), new Set())).toEqual([
      expect.objectContaining({ payable: false, reasons: ["OPEN_CONFLICT"] }),
    ]);
  });

  it("never lists a Trip a line of the invoice already charges", () => {
    expect(assessMissingTripPayments(missing({ added: [added("a")] }), new Set(["a"]))).toEqual([]);
  });
});
