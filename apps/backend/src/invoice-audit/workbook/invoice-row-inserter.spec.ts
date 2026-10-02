import ExcelJS from "exceljs";

import { openRowsAt, shiftReferences } from "./invoice-row-inserter";

/**
 * Opening rows inside a worksheet without `spliceRows`.
 *
 * The rewrite rule is Excel's own for inserted rows, with one deliberate
 * addition: a range that ENDS on the row directly above the opening grows over
 * it, because the opened rows are data belonging to that range — the added
 * lines above a totals row.
 */
describe("shiftReferences", () => {
  /** Two rows opened at row 100 (the totals row of the real invoice). */
  const shift = (formula: string) => shiftReferences(formula, 100, 2);

  it("moves a reference at or below the opening", () => {
    expect(shift("L100")).toBe("L102");
    expect(shift("U111")).toBe("U113");
  });

  it("leaves a reference above the opening alone", () => {
    expect(shift("13%*L99")).toBe("13%*L99");
    expect(shift("L2")).toBe("L2");
  });

  /** The totals: their range ends on the last line, directly above. */
  it("grows a range ending directly above the opening over the opened rows", () => {
    expect(shift("SUM(L2:L99)")).toBe("SUM(L2:L101)");
  });

  it("moves a range entirely below the opening", () => {
    expect(shift("SUM(L100:T100)")).toBe("SUM(L102:T102)");
  });

  it("grows a range spanning the opening", () => {
    expect(shift("SUM(L50:L120)")).toBe("SUM(L50:L122)");
  });

  it("leaves a range ending further above alone", () => {
    expect(shift("SUM(L2:L50)")).toBe("SUM(L2:L50)");
  });

  it("keeps absolute markers while moving the row", () => {
    expect(shift("$L$100+$L99")).toBe("$L$102+$L99");
  });

  it("never rewrites text inside quotes", () => {
    expect(shift('IF(L100>0,"L100","")')).toBe('IF(L102>0,"L100","")');
  });

  it("never rewrites a reference to another sheet", () => {
    expect(shift("Other!L100+L100")).toBe("Other!L100+L102");
  });

  it("never mistakes a function name for a cell", () => {
    expect(shift("LOG10(L100)")).toBe("LOG10(L102)");
  });
});

describe("openRowsAt", () => {
  /** A small invoice: lines 2–3, totals on 4 as one shared formula, summary on 6. */
  function invoice(): ExcelJS.Worksheet {
    const sheet = new ExcelJS.Workbook().addWorksheet("Sheet1");

    sheet.getCell("L2").value = 100;
    sheet.getCell("L3").value = 50;
    sheet.getCell("M2").value = 10;
    sheet.getCell("M3").value = 5;
    sheet.getCell("L4").value = { formula: "SUM(L2:L3)", result: 150 };
    sheet.getCell("M4").value = {
      formula: "SUM(M2:M3)",
      shareType: "shared",
      ref: "M4:N4",
      result: 15,
    } as unknown as ExcelJS.CellFormulaValue;
    sheet.getCell("N4").value = {
      sharedFormula: "M4",
      result: 0,
    } as unknown as ExcelJS.CellSharedFormulaValue;
    sheet.getCell("K6").value = "Total";
    sheet.getCell("L6").value = { formula: "L4", result: 150 };
    sheet.getRow(4).height = 24;
    sheet.getCell("L4").style = { font: { bold: true } };

    return sheet;
  }

  const formulaOf = (sheet: ExcelJS.Worksheet, address: string) =>
    (sheet.getCell(address).value as { formula?: string } | null)?.formula ?? null;

  it("moves the totals and the summary down, values and formulas rewritten", () => {
    const sheet = invoice();

    openRowsAt(sheet, 4, 2);

    expect(formulaOf(sheet, "L6")).toBe("SUM(L2:L5)");
    expect(formulaOf(sheet, "L8")).toBe("L6");
    expect(sheet.getCell("K8").value).toBe("Total");
  });

  /** A borrower of a shared formula is given its own, translated, before moving. */
  it("gives every member of a moved shared formula its own formula", () => {
    const sheet = invoice();

    openRowsAt(sheet, 4, 2);

    expect(formulaOf(sheet, "M6")).toBe("SUM(M2:M5)");
    expect(formulaOf(sheet, "N6")).toBe("SUM(N2:N5)");
    expect((sheet.getCell("M6").value as { shareType?: string }).shareType).toBeUndefined();
  });

  it("carries the row's height and the cells' styles along", () => {
    const sheet = invoice();

    openRowsAt(sheet, 4, 2);

    expect(sheet.getRow(6).height).toBe(24);
    expect(sheet.getCell("L6").font).toMatchObject({ bold: true });
  });

  /** Moved cells never share a style object with another cell. */
  it("gives every moved cell a style object of its own", () => {
    const sheet = invoice();

    openRowsAt(sheet, 4, 2);
    sheet.getCell("L6").style.font = { bold: false };

    expect(sheet.getCell("M6").font?.bold).not.toBe(false);
  });

  it("leaves the opened rows empty and unstyled", () => {
    const sheet = invoice();

    openRowsAt(sheet, 4, 2);

    for (const address of ["L4", "M4", "N4", "L5"]) {
      expect(sheet.getCell(address).value).toBeNull();
    }
    expect(sheet.getCell("L4").font).toBeUndefined();
  });

  it("leaves every line above the opening exactly where it was", () => {
    const sheet = invoice();

    openRowsAt(sheet, 4, 2);

    expect(sheet.getCell("L2").value).toBe(100);
    expect(sheet.getCell("L3").value).toBe(50);
  });

  it("moves a merged range below the opening with its rows", () => {
    const sheet = invoice();
    sheet.mergeCells("K6:K7");

    openRowsAt(sheet, 4, 2);

    expect((sheet.model as { merges?: string[] }).merges).toContain("K8:K9");
  });

  it("opens nothing for a count of zero", () => {
    const sheet = invoice();

    openRowsAt(sheet, 4, 0);

    expect(formulaOf(sheet, "L4")).toBe("SUM(L2:L3)");
  });

  /** The output is a valid workbook: written, read back, formulas intact. */
  it("survives being written and read back", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.getCell("L2").value = 100;
    sheet.getCell("L3").value = { formula: "SUM(L2:L2)", result: 100 };
    sheet.getCell("L5").value = { formula: "L3", result: 100 };

    openRowsAt(sheet, 3, 1);

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(
      Buffer.from(await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    );

    expect(formulaOf(back.worksheets[0], "L4")).toBe("SUM(L2:L3)");
    expect(formulaOf(back.worksheets[0], "L6")).toBe("L4");
  });
});
