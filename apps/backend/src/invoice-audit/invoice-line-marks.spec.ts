import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { aTrip, day, invoiceWorld, type CheckedInvoice, type InvoiceWorld } from "./__fixtures__/invoice-world";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { isYellowFill } from "./workbook/cell-comparison";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * Lines the check still marks yellow after comparing them as usual (owner,
 * November 2026), through the whole check — matched, priced, written and read
 * back from the corrected file's bytes.
 *
 *   No Tarief and no Fuel stated (empty or `-`)  → neither filled from Trano
 *   Combination in the Excel only (situation A)  → everything as before
 *   Combination in Trano only (situation B)      → its €50 Backload not added,
 *                                                  no Combination remark
 *
 * Every Trip is priced at Tarief 200, Fuel 30 (`invoiceWorld`).
 */

const TUESDAY = "2026-10-06";
const COLUMN = { container: 6, startPoint: 7, endPoint: 11, tarief: 12, fuel: 13, backload: 14, remarks: 21 } as const;
const LAST_COLUMN = 21;

function line(booking: string, container: string, amounts: Partial<InvoiceFixtureLine> = {}): InvoiceFixtureLine {
  return {
    planningDate: day(TUESDAY),
    bookingNumber: booking,
    containerNumber: `${container.slice(0, 4)} ${container.slice(4)}`,
    tarief: 190,
    fuel: 30,
    ...amounts,
  };
}

/** The two rows of a Combination as the Excel marks it: out to it, back from it. */
function excelCombination(first: InvoiceFixtureLine, second: InvoiceFixtureLine): InvoiceFixtureLine[] {
  return [
    { ...first, endPoint: "COMBINATION" },
    { ...second, startPoint: "COMBINATION" },
  ];
}

const isRed = (cell: { font?: { color?: { argb?: string } } }) => cell.font?.color?.argb === CORRECTED_TEXT_ARGB;

/** Every cell of the row, up to the last column, carries the review yellow. */
function expectWholeRowYellow(checked: CheckedInvoice, rowNumber: number): void {
  for (let column = 1; column <= LAST_COLUMN; column += 1) {
    expect(isYellowFill(checked.cell(rowNumber, column).style.fill)).toBe(true);
  }
}

function expectNotYellow(checked: CheckedInvoice, rowNumber: number): void {
  expect(isYellowFill(checked.cell(rowNumber, COLUMN.tarief).style.fill)).toBe(false);
  expect(checked.result.markedRowNumbers).not.toContain(rowNumber);
}

describe("lines marked yellow although compared as usual", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
  });

  describe("no Tarief and no Fuel stated", () => {
    beforeEach(() => world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY)));

    it("1. both empty: neither filled from Trano, the whole row yellow", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: null, fuel: null })]);

      expect(checked.result.rows[0]).toMatchObject({ status: "MATCHED", marks: ["PRICES_MISSING"], transportPricesFilled: false });
      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(2, COLUMN.fuel).value]).toEqual([null, null]);
      expectWholeRowYellow(checked, 2);
    });

    it("2. both a dash: kept exactly as written, the whole row yellow", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: "-", fuel: "-" })]);

      expect(checked.result.rows[0]).toMatchObject({ status: "MATCHED", marks: ["PRICES_MISSING"] });
      expect(checked.result.rows[0].pricingStatus).not.toBe("AMOUNT_UNREADABLE");
      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(2, COLUMN.fuel).value]).toEqual(["-", "-"]);
      expectWholeRowYellow(checked, 2);
    });

    it("2. one empty and one a dash is missing too", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: null, fuel: "-" })]);

      expect(checked.result.rows[0].marks).toEqual(["PRICES_MISSING"]);
      expect(checked.cell(2, COLUMN.tarief).value).toBeNull();
    });

    it("3. both 0,00: valid prices, compared and raised as ever, not marked", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: 0, fuel: 0 })]);

      expect(checked.result.rows[0].marks).toEqual([]);
      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(2, COLUMN.fuel).value]).toEqual([200, 30]);
      expectNotYellow(checked, 2);
    });

    it("4. only the Tarief missing: the component checks as before", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: null, fuel: 30 })]);

      expect(checked.result.rows[0].marks).toEqual([]);
      expect(checked.cell(2, COLUMN.tarief).value).toBe(200);
      expect(isRed(checked.cell(2, COLUMN.tarief))).toBe(true);
      expectNotYellow(checked, 2);
    });

    it("5. only the Fuel missing: the component checks as before", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: 200, fuel: null })]);

      expect(checked.result.rows[0].marks).toEqual([]);
      expect(checked.cell(2, COLUMN.fuel).value).toBe(30);
      expectNotYellow(checked, 2);
    });

    it("a word in one of them keeps the line unreadable, as before", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: "n.v.t." as never, fuel: null })]);

      expect(checked.result.rows[0]).toMatchObject({ pricingStatus: "AMOUNT_UNREADABLE", marks: [] });
    });
  });

  /*
   * ── A: COMBINATION IN THE EXCEL ONLY ─────────────────────────────────────
   * Both rows of the Excel's Combination match a Trip in no group: the existing
   * GEEN COMBI — remark written, Backload removed — exactly as before, and the
   * rows marked yellow besides.
   */
  describe("A. the Excel marks a Combination, the Trips are in no group", () => {
    const LINES = excelCombination(
      line("ANRDUB2810001", "EUCU1000001", { tarief: 190, backload: 50 }),
      line("ANRDUB2810002", "EUCU1000001", { tarief: 190, backload: 50 }),
    );

    beforeEach(() => {
      world.trips.push(aTrip("out", "ANRDUB2810001", "EUCU1000001", TUESDAY));
      world.trips.push(aTrip("back", "ANRDUB2810002", "EUCU1000001", TUESDAY));
    });

    it("6. prices as before: the Tarief raised in red", async () => {
      const checked = await world.check(LINES);

      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(3, COLUMN.tarief).value]).toEqual([200, 200]);
      expect(isRed(checked.cell(2, COLUMN.tarief))).toBe(true);
    });

    it("7. the Backload as before: GEEN COMBI removes it", async () => {
      const checked = await world.check(LINES);

      expect(checked.result.rows.map((row) => row.combination?.verdict)).toEqual(["GEEN_COMBI", "GEEN_COMBI"]);
      expect([checked.cell(2, COLUMN.backload).value, checked.cell(3, COLUMN.backload).value]).toEqual([null, null]);
    });

    it("8. the remarks as before: GEEN COMBI written", async () => {
      const checked = await world.check(LINES);

      expect([checked.cell(2, COLUMN.remarks).value, checked.cell(3, COLUMN.remarks).value]).toEqual(["GEEN COMBI", "GEEN COMBI"]);
    });

    it("9. both rows wholly yellow, and no Trano-Combination warning", async () => {
      const checked = await world.check(LINES);

      expect(checked.result.rows.map((row) => row.marks)).toEqual([["COMBINATION_ONLY_IN_EXCEL"], ["COMBINATION_ONLY_IN_EXCEL"]]);
      expectWholeRowYellow(checked, 2);
      expectWholeRowYellow(checked, 3);
    });

    it("writes exactly what it wrote before the mark existed", async () => {
      const checked = await world.check(LINES);

      expect(checked.result.rows.map((row) => row.differences.map((difference) => [difference.component, difference.kind]))).toEqual([
        [["Tarief", "RAISE"], ["Backload", "REMOVE"]],
        [["Tarief", "RAISE"], ["Backload", "REMOVE"]],
      ]);
    });
  });

  /*
   * ── B: COMBINATION IN TRANO ONLY ─────────────────────────────────────────
   * The Trip is grouped — priced with its €50 Backload — and the Excel marks no
   * Combination on its line: everything compared as ever, except that the €50
   * is not added; no Combination remark; the row yellow.
   */
  describe("B. the Trip is in a group, the Excel marks no Combination", () => {
    beforeEach(() => {
      world.trips.push(aTrip("grouped", "ANRDUB2810001", "EUCU1000001", TUESDAY, { tripGroupId: "group-1" }));
      world.backloadOf.set("grouped", "50");
    });

    it("10. the whole row yellow", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001")]);

      expect(checked.result.rows[0].marks).toEqual(["COMBINATION_ONLY_IN_TRANO"]);
      expectWholeRowYellow(checked, 2);
    });

    it("11. no €50 Backload added, nor shown as agreeing", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001")]);

      expect(checked.cell(2, COLUMN.backload).value).toBeNull();
      expect(checked.result.rows[0].comparisons.map((comparison) => comparison.component)).not.toContain("Backload");
      expect(checked.result.totals.columns.find((each) => each.column.startsWith("Backload"))).toMatchObject({
        before: expect.any(String),
      });
    });

    it("12/13. every other component compared as ever, and no Combination remark", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { remarks: "tar 869" })]);

      expect(checked.cell(2, COLUMN.tarief).value).toBe(200);
      expect(isRed(checked.cell(2, COLUMN.tarief))).toBe(true);
      expect(checked.result.rows[0].differences.map((difference) => difference.component)).toEqual(["Tarief"]);
      expect(checked.cell(2, COLUMN.remarks).value).toBe("tar 869");
      expect(String(checked.cell(2, COLUMN.remarks).value)).not.toMatch(/COMBI/i);
    });

    it("a Backload the invoice already states is compared as ever", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { backload: 50 })]);

      expect(checked.cell(2, COLUMN.backload).value).toBe(50);
      expect(checked.result.rows[0].comparisons.find((comparison) => comparison.component === "Backload")).toMatchObject({
        outcome: "UNCHANGED",
      });
      expect(checked.result.rows[0].marks).toEqual(["COMBINATION_ONLY_IN_TRANO"]);
    });

    it("17. missing prices too: neither filled, no Backload, marked once for both reasons", async () => {
      const checked = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: null, fuel: null })]);

      expect(checked.result.rows[0].marks).toEqual(["PRICES_MISSING", "COMBINATION_ONLY_IN_TRANO"]);
      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(2, COLUMN.fuel).value, checked.cell(2, COLUMN.backload).value]).toEqual([
        null,
        null,
        null,
      ]);
      expect(checked.result.markedRowNumbers.filter((rowNumber) => rowNumber === 2)).toHaveLength(1);
      expectWholeRowYellow(checked, 2);
    });

    it("18. marks every row the transport is charged on, its EC line included", async () => {
      world.confirmations.push({ tripId: "grouped", ccNumber: "4220981", amount: new Prisma.Decimal(110) });
      world.ekOf.set("grouped", "110");

      const checked = await world.check([
        line("ANRDUB2810001", "EUCU1000001"),
        { ...line("ANRDUB2810001", "EUCU1000001"), tarief: null, fuel: null, ek: 110, remarks: "EC 4220981", containerType: null, startPoint: null, endPoint: null },
      ]);

      expect(checked.result.rows.map((row) => row.trip?.id)).toEqual(["grouped", "grouped"]);
      expect(checked.result.rows.map((row) => row.marks)).toEqual([["COMBINATION_ONLY_IN_TRANO"], ["COMBINATION_ONLY_IN_TRANO"]]);
      expectWholeRowYellow(checked, 2);
      expectWholeRowYellow(checked, 3);
    });
  });

  it("15. both a Combination: the existing Combination handling, nothing marked", async () => {
    world.trips.push(aTrip("out", "ANRDUB2810001", "EUCU1000001", TUESDAY, { tripGroupId: "group-1" }));
    world.trips.push(aTrip("back", "ANRDUB2810002", "EUCU1000001", TUESDAY, { tripGroupId: "group-1" }));
    world.backloadOf.set("out", "50");
    world.backloadOf.set("back", "50");

    const checked = await world.check(
      excelCombination(line("ANRDUB2810001", "EUCU1000001"), line("ANRDUB2810002", "EUCU1000001")),
    );

    expect(checked.result.rows.map((row) => [row.combination?.verdict, row.marks])).toEqual([
      ["RECOGNISED", []],
      ["RECOGNISED", []],
    ]);
    // The Backload a recognised Combination owes is raised as before.
    expect([checked.cell(2, COLUMN.backload).value, checked.cell(3, COLUMN.backload).value]).toEqual([50, 50]);
    expectNotYellow(checked, 2);
    expectNotYellow(checked, 3);
  });

  it("16. neither a Combination: the existing handling, nothing marked", async () => {
    world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY));

    const checked = await world.check([line("ANRDUB2810001", "EUCU1000001")]);

    expect(checked.result.rows[0]).toMatchObject({ pricingStatus: "PRICING_CORRECTED", marks: [], combination: null });
    expect(checked.cell(2, COLUMN.tarief).value).toBe(200);
    expectNotYellow(checked, 2);
  });

  it("19. the marks survive in the corrected file, and again when it is checked again", async () => {
    world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY));
    const first = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: null, fuel: null })]);

    expectWholeRowYellow(first, 2);

    const again = await world.checkFile(first.written);

    expect(again.result.rows[0].marks).toEqual(["PRICES_MISSING"]);
    expectWholeRowYellow(again, 2);
    expect([again.cell(2, COLUMN.tarief).value, again.cell(2, COLUMN.fuel).value]).toEqual([null, null]);
  });

  /*
   * ── A TRIP WITHOUT A USABLE PRICE: ITS LINES UNTOUCHED (owner, November 2026)
   * Never priced, or a stored price nobody can rely on: no amount, no corrected
   * number or date, no Remarks — only the yellow. A reliable 0,00 is a price.
   */
  describe("a matched Trip without a usable price", () => {
    /** Every cell of the row as the customer sent it. */
    async function receivedValues(lines: readonly InvoiceFixtureLine[], rowNumber: number): Promise<unknown[]> {
      const book = new ExcelJS.Workbook();

      await book.xlsx.load((await buildInvoiceWorkbook({ lines, fuelPercentage: 15 })) as unknown as ArrayBuffer);

      return Array.from({ length: LAST_COLUMN }, (_, index) => book.worksheets[0].getRow(rowNumber).getCell(index + 1).value);
    }

    async function expectUntouched(checked: CheckedInvoice, lines: readonly InvoiceFixtureLine[], rowNumber: number) {
      const written = Array.from({ length: LAST_COLUMN }, (_, index) => checked.cell(rowNumber, index + 1).value);

      expect(written).toEqual(await receivedValues(lines, rowNumber));
      for (let column = 1; column <= LAST_COLUMN; column += 1) {
        expect(isRed(checked.cell(rowNumber, column))).toBe(false);
      }
      expectWholeRowYellow(checked, rowNumber);
    }

    /** Misprinted container and booking, a raise owed, and Remarks the check would complete. */
    const MISPRINTED = (amounts: Partial<InvoiceFixtureLine> = {}) =>
      line("ANRDUB2810001", "EUCU9999999", { tarief: 150, fuel: 15, remarks: "tar 869", ...amounts });

    beforeEach(() => {
      world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY));
    });

    it("1. never priced: the line exactly as received, the whole row yellow", async () => {
      world.unpriced.add("t1");
      const lines = [MISPRINTED()];

      const checked = await world.check(lines);

      expect(checked.result.rows[0]).toMatchObject({
        status: "MATCHED",
        trip: { id: "t1" },
        pricingStatus: "PRICE_UNRELIABLE",
        differences: [],
        containerCorrection: null,
        remarks: null,
      });
      await expectUntouched(checked, lines, 2);
    });

    it("2. a stored price nobody can rely on: every amount the Excel states kept", async () => {
      world.unreliable.add("t1");
      const lines = [MISPRINTED({ backload: 50, tolB: 12, tunnel: 8, others: 20, ek: 55 })];

      const checked = await world.check(lines);

      expect(checked.result.rows[0].pricingStatus).toBe("PRICE_UNRELIABLE");
      await expectUntouched(checked, lines, 2);
    });

    // Each found by the other two values, so each would be corrected in red for a priced Trip.
    it.each([
      ["a misprinted booking", { bookingNumber: "ANRDUB2819999", containerNumber: "EUCU 1000001" }],
      ["a misprinted date", { planningDate: day("2026-10-07"), containerNumber: "EUCU 1000001" }],
    ])("3. no identifier, date or Remarks corrected either: %s", async (_label, misprint) => {
      world.unpriced.add("t1");
      const lines = [{ ...MISPRINTED(), ...misprint }];

      const checked = await world.check(lines);

      expect(checked.result.rows[0]).toMatchObject({
        status: "MATCHED",
        trip: { id: "t1" },
        bookingCorrection: null,
        dateCorrection: null,
        containerCorrection: null,
        remarks: null,
      });
      await expectUntouched(checked, lines, 2);
    });

    it("4. a reliable price of 0,00 is a price: compared and corrected as ever, not marked", async () => {
      world.zeroPriced.add("t1");

      const checked = await world.check([MISPRINTED()]);

      expect(checked.result.rows[0]).toMatchObject({ pricingStatus: "INVOICE_HIGHER", marks: [] });
      expect(checked.result.rows[0].containerCorrection).toMatchObject({ tripContainerNumber: "EUCU1000001" });
      expect(checked.cell(2, COLUMN.container).value).toBe("EUCU1000001");
      expect(isRed(checked.cell(2, COLUMN.container))).toBe(true);
      expect(checked.cell(2, COLUMN.tarief).value).toBe(150);
      expectNotYellow(checked, 2);
    });

    it("5. with a Combination deviation too: nothing written, the row yellow once", async () => {
      world.trips[0] = aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY, { tripGroupId: "group-1" });
      world.backloadOf.set("t1", "50");
      world.unpriced.add("t1");
      const lines = [MISPRINTED({ tarief: null, fuel: null })];

      const checked = await world.check(lines);

      expect(checked.result.rows[0].pricingStatus).toBe("PRICE_UNRELIABLE");
      expect(checked.result.markedRowNumbers.filter((rowNumber) => rowNumber === 2)).toHaveLength(1);
      await expectUntouched(checked, lines, 2);
    });

    it("5. an Excel Combination on unpriced Trips: no GEEN COMBI, no Backload removed", async () => {
      world.trips.push(aTrip("back", "ANRDUB2810002", "EUCU1000001", TUESDAY));
      world.unpriced.add("t1");
      world.unpriced.add("back");
      const lines = excelCombination(
        line("ANRDUB2810001", "EUCU1000001", { backload: 50 }),
        line("ANRDUB2810002", "EUCU1000001", { backload: 50 }),
      );

      const checked = await world.check(lines);

      expect(checked.result.rows.map((row) => row.combination?.verdict)).toEqual(["GEEN_COMBI", "GEEN_COMBI"]);
      await expectUntouched(checked, lines, 2);
      await expectUntouched(checked, lines, 3);
    });
  });
});
