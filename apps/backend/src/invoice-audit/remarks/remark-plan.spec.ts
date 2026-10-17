import { sheetRow, tripRecord } from "../__fixtures__/invoice-rows";
import {
  CombinationVerdict,
  InvoiceRowStatus,
  type InvoiceCombination,
  type InvoiceRowMatch,
} from "../matching/invoice-row-match";
import {
  InvoicePricingStatus,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { planRemarks, type TripRemarkFacts } from "./remark-plan";

const TRIP = tripRecord({ id: "trip-1" });

function match(
  row: Partial<InvoiceSheetRow>,
  status: InvoiceRowStatus = InvoiceRowStatus.MATCHED,
  combination: InvoiceCombination | null = null,
  trip = TRIP,
): InvoiceRowMatch {
  return {
    row: sheetRow(row),
    status,
    trip,
    candidates: [trip],
    sharedKeyRowNumbers: [],
    containerCorrection: null,
    bookingCorrection: null,
    costConfirmation: null,
    combination,
    problem: null,
  };
}

function priced(
  rows: readonly InvoiceRowMatch[],
  status: InvoicePricingStatus = InvoicePricingStatus.MATCHED_NO_CHANGES,
): Map<number, InvoiceRowPricing> {
  return new Map(
    rows.map((row) => [row.row.rowNumber, { rowNumber: row.row.rowNumber, status, differences: [], reliability: null }]),
  );
}

function facts(overrides: Partial<TripRemarkFacts> = {}): Map<string, TripRemarkFacts> {
  return new Map([
    [
      TRIP.id,
      { propertyNames: [], tarCharged: false, ccNumbers: [], waiting: null, ...overrides },
    ],
  ]);
}

const GEEN_COMBI: InvoiceCombination = {
  verdict: CombinationVerdict.GEEN_COMBI,
  partnerRowNumber: 24,
  reason: null,
};

describe("planRemarks", () => {
  it("completes the Trip's own line with what it does not say yet", () => {
    const rows = [match({ rowNumber: 5, remarks: "tar" })];

    expect(planRemarks(rows, priced(rows), facts({ tarCharged: true, ccNumbers: ["4220979"] })).get(5)).toEqual({
      rowNumber: 5,
      before: "tar",
      after: "tar,EC 4220979",
      added: ["EC 4220979"],
      notes: [],
    });
  });

  it("adds nothing when the line says it all", () => {
    const rows = [match({ rowNumber: 5, remarks: "flat,tar,EC 4220980" })];

    expect(
      planRemarks(rows, priced(rows), facts({ propertyNames: ["Flat"], tarCharged: true, ccNumbers: ["4220980"] })),
    ).toEqual(new Map());
  });

  /** Week 41 R41: Others 170 = flat + tar + 70, but only `flat,tar` written. */
  it("adds the property the customer charged without naming", () => {
    const rows = [
      match({ rowNumber: 41, remarks: "flat,tar,EC 4220980" }),
      match({ rowNumber: 99, remarks: "stop,tar" }, InvoiceRowStatus.MATCHED, null, tripRecord({ id: "other" })),
    ];

    expect(
      planRemarks(rows, priced(rows), facts({ propertyNames: ["Flat", "Stop"], tarCharged: true, ccNumbers: ["4220980"] }))
        .get(41),
    ).toMatchObject({ after: "flat,tar,EC 4220980,stop", notes: [] });
  });

  it("reports a property name the invoice never uses", () => {
    const rows = [match({ rowNumber: 5, remarks: "tar,AANKOPPELEN" })];

    expect(planRemarks(rows, priced(rows), facts({ propertyNames: ["Aan/Afkoppelen"] })).get(5)).toMatchObject({
      added: ["aan/afkoppelen"],
      notes: ['"aan/afkoppelen" is not a word this invoice uses yet'],
    });
  });

  it("writes only on the Trip's first own line, never on its EC lines", () => {
    const rows = [
      match({ rowNumber: 20, remarks: "tar" }),
      match({ rowNumber: 21, remarks: "" }),
      match({ rowNumber: 53, remarks: "EC 4220981", costLine: { ccNumbers: ["4220981"] } }, InvoiceRowStatus.COST_LINE),
    ];

    const changes = planRemarks(rows, priced(rows), facts({ ccNumbers: ["4220981", "4220982"] }));

    // EC 4220981 is on the Trip's EC line already; only 4220982 is missing.
    expect([...changes.keys()]).toEqual([20]);
    expect(changes.get(20)?.added).toEqual(["EC 4220982"]);
  });

  it("writes nothing of the Trip's own facts on a line whose price is not relied on", () => {
    const rows = [match({ rowNumber: 5, remarks: "" })];

    expect(
      planRemarks(rows, priced(rows, InvoicePricingStatus.PRICE_UNRELIABLE), facts({ tarCharged: true })),
    ).toEqual(new Map());
  });

  it("writes GEEN COMBI also on a line marked for its price", () => {
    const rows = [match({ rowNumber: 23, remarks: "" }, InvoiceRowStatus.MATCHED, GEEN_COMBI)];

    expect(
      planRemarks(rows, priced(rows, InvoicePricingStatus.PRICE_UNRELIABLE), facts({ tarCharged: true })).get(23)
        ?.added,
    ).toEqual(["GEEN COMBI"]);
  });

  it("writes nothing on a line that is not matched", () => {
    const rows = [match({ rowNumber: 5, remarks: "" }, InvoiceRowStatus.NOT_FOUND, null)];

    expect(planRemarks(rows, priced(rows), facts({ tarCharged: true }))).toEqual(new Map());
  });

  it("changes nothing the second time", () => {
    const rows = [match({ rowNumber: 23, remarks: "tar  " }, InvoiceRowStatus.MATCHED, GEEN_COMBI)];
    const tripFacts = facts({ propertyNames: ["Flat"], tarCharged: true, ccNumbers: ["1"] });
    const once = planRemarks(rows, priced(rows), tripFacts).get(23)!;
    const again = [match({ rowNumber: 23, remarks: once.after }, InvoiceRowStatus.MATCHED, GEEN_COMBI)];

    expect(once.after).toBe("tar,flat,EC 1,GEEN COMBI");
    expect(planRemarks(again, priced(again), tripFacts)).toEqual(new Map());
  });

  it("never takes another Trip's facts", () => {
    const other = tripRecord({ id: "other" });
    const rows = [match({ rowNumber: 5, remarks: "" }, InvoiceRowStatus.MATCHED, null, other)];

    expect(planRemarks(rows, priced(rows), facts({ tarCharged: true }))).toEqual(new Map());
  });
});
