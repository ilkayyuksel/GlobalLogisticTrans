import { sheetRow, tripRecord } from "../__fixtures__/invoice-rows";
import {
  CombinationVerdict,
  InvoiceRowStatus,
  type InvoiceCombination,
  type InvoiceRowMatch,
} from "../matching/invoice-row-match";
import {
  InvoiceLineMark,
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
    dateCorrection: null,
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

  /** A property is valid without the invoice having used its word before. */
  it("writes a property name the invoice never used, without a note", () => {
    const rows = [match({ rowNumber: 5, remarks: "tar,AANKOPPELEN" })];

    expect(planRemarks(rows, priced(rows), facts({ propertyNames: ["Aan/Afkoppelen"] })).get(5)).toEqual({
      rowNumber: 5,
      before: "tar,AANKOPPELEN",
      after: "tar,AANKOPPELEN,aan/afkoppelen",
      added: ["aan/afkoppelen"],
      notes: [],
    });
  });

  it("does not add a property name the line already states, in any case", () => {
    const rows = [match({ rowNumber: 5, remarks: "tar,STOP" })];

    expect(planRemarks(rows, priced(rows), facts({ propertyNames: ["Stop"] })).get(5)).toBeUndefined();
  });

  /** A Custom Property that costs nothing is still named. */
  it("names a property of €0, from the Trip's own properties", () => {
    const rows = [match({ rowNumber: 5, remarks: "tar" })];

    expect(
      planRemarks(rows, priced(rows), facts({ propertyNames: ["Stop 2e adres+2flat kosten"] })).get(5),
    ).toMatchObject({ added: ["stop 2e adres+2flat kosten"], notes: [] });
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

  /*
   * A Trip without a usable price leaves its line exactly as received (owner,
   * November 2026): not even GEEN COMBI, which used to be written there too.
   */
  it("writes not even GEEN COMBI on the line of a Trip without a usable price", () => {
    const rows = [match({ rowNumber: 23, remarks: "" }, InvoiceRowStatus.MATCHED, GEEN_COMBI)];

    expect(
      planRemarks(rows, priced(rows, InvoicePricingStatus.PRICE_UNRELIABLE), facts({ tarCharged: true })),
    ).toEqual(new Map());
  });

  it("still writes GEEN COMBI on a line marked for another reason", () => {
    const rows = [match({ rowNumber: 23, remarks: "" }, InvoiceRowStatus.MATCHED, GEEN_COMBI)];

    expect(
      planRemarks(rows, priced(rows, InvoicePricingStatus.AMOUNT_UNREADABLE), facts({ tarCharged: true })).get(23)
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

  /*
   * ── SITUATION B: A COMBINATION ONLY THIS SYSTEM KNOWS (owner, November 2026)
   * Every row of the Trip carries the mark; its Remarks stay as received.
   */
  describe("a line marked COMBINATION_ONLY_IN_TRANO", () => {
    const ALL_FACTS = facts({
      propertyNames: ["Flat", "Stop", "Chassis"],
      tarCharged: true,
      ccNumbers: ["4220981"],
      waiting: {
        start: new Date("1970-01-01T08:00:00.000Z"),
        end: new Date("1970-01-01T09:30:00.000Z"),
        endsNextDay: false,
        minutes: 90,
      },
      extraNotes: "klant belt vooraf",
    });

    function markedB(
      rows: readonly InvoiceRowMatch[],
      marks: readonly InvoiceLineMark[] = [InvoiceLineMark.COMBINATION_ONLY_IN_TRANO],
    ): Map<number, InvoiceRowPricing> {
      return new Map(
        [...priced(rows, InvoicePricingStatus.PRICING_CORRECTED)].map(([rowNumber, outcome]) => [
          rowNumber,
          { ...outcome, marks },
        ]),
      );
    }

    it("1. keeps the Excel's own Remarks exactly as received", () => {
      const rows = [match({ rowNumber: 5, remarks: "tar 869 , Kaai  " })];

      expect(planRemarks(rows, markedB(rows), ALL_FACTS)).toEqual(new Map());
    });

    it("2. adds none of the Trip's standard facts, nor its Extra notities", () => {
      const rows = [match({ rowNumber: 5, remarks: "" })];

      expect(
        planRemarks(rows, markedB(rows), facts({ tarCharged: true, ccNumbers: ["1"], extraNotes: "note" })),
      ).toEqual(new Map());
    });

    it("3. adds no Custom Property", () => {
      const rows = [match({ rowNumber: 5, remarks: "tar" })];

      expect(planRemarks(rows, markedB(rows), facts({ propertyNames: ["Flat"] }))).toEqual(new Map());
    });

    it("4. adds no Combination remark, even were the pair GEEN COMBI", () => {
      const rows = [match({ rowNumber: 23, remarks: "" }, InvoiceRowStatus.MATCHED, GEEN_COMBI)];

      expect(planRemarks(rows, markedB(rows), facts())).toEqual(new Map());
    });

    it("5. excludes every one of several Custom Properties", () => {
      const rows = [match({ rowNumber: 5, remarks: "" })];

      expect(
        planRemarks(rows, markedB(rows), facts({ propertyNames: ["Flat", "Stop", "Chassis", "Aan/Afkoppelen"] })),
      ).toEqual(new Map());
    });

    it("also with prices missing: marked for both reasons, nothing added", () => {
      const rows = [match({ rowNumber: 5, remarks: "" })];

      expect(
        planRemarks(rows, markedB(rows, [InvoiceLineMark.PRICES_MISSING, InvoiceLineMark.COMBINATION_ONLY_IN_TRANO]), ALL_FACTS),
      ).toEqual(new Map());
    });

    it("6. situation A (COMBINATION_ONLY_IN_EXCEL) completes the Remarks as before", () => {
      const rows = [match({ rowNumber: 23, remarks: "tar" }, InvoiceRowStatus.MATCHED, GEEN_COMBI)];

      expect(
        planRemarks(rows, markedB(rows, [InvoiceLineMark.COMBINATION_ONLY_IN_EXCEL]), facts({ propertyNames: ["Flat", "Stop"] }))
          .get(23)?.after,
      ).toBe("tar,flat,stop,GEEN COMBI");
    });

    it("7. an ordinary line, without a mark, completes the Remarks as before", () => {
      const rows = [match({ rowNumber: 5, remarks: "tar" })];

      expect(
        planRemarks(rows, priced(rows), facts({ propertyNames: ["Flat", "Stop"], extraNotes: "note" })).get(5)?.after,
      ).toBe("tar,flat,stop,note");
    });
  });
});
