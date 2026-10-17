import ExcelJS from "exceljs";

import { CORRECTED_TEXT_ARGB, markRowsYellow, markTextRed, writeTextInRed } from "./cell-marking";

const YELLOW = "FFFFFF00";
const ORANGE = "FFFFC000";

/** A sheet whose cells SHARE one style object, as a loaded file's do. */
function aSheet() {
  const sheet = new ExcelJS.Workbook().addWorksheet("Sheet1");
  const shared: Partial<ExcelJS.Style> = { font: { name: "Aptos Narrow", size: 11 } };

  for (const rowNumber of [2, 3]) {
    const row = sheet.getRow(rowNumber);

    for (const column of [1, 5, 6, 12]) {
      row.getCell(column).value = `${rowNumber}-${column}`;
      row.getCell(column).style = shared;
    }
  }

  // The customer's own orange on a Combination's booking — on that cell alone
  // (assigning `cell.fill` would write it into the style all cells share).
  const booking = sheet.getRow(2).getCell(5);
  booking.style = {
    ...booking.style,
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } },
  };

  return sheet;
}

const fillOf = (cell: ExcelJS.Cell) => (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;

describe("marking the corrected document", () => {
  it("paints the whole row yellow, to the header's last column, empty cells included", () => {
    const sheet = aSheet();

    expect(markRowsYellow(sheet, [2], 21)).toBe(1);

    for (let column = 1; column <= 21; column += 1) {
      expect(fillOf(sheet.getRow(2).getCell(column))).toBe(YELLOW);
    }
    expect(fillOf(sheet.getRow(2).getCell(22))).toBeUndefined();
  });

  it("paints over the customer's own fill on that row, and nowhere else", () => {
    const sheet = aSheet();

    markRowsYellow(sheet, [2], 21);

    expect(fillOf(sheet.getRow(2).getCell(5))).toBe(YELLOW);
    expect(fillOf(sheet.getRow(3).getCell(5))).toBeUndefined();
    expect(fillOf(sheet.getRow(3).getCell(1))).toBeUndefined();
  });

  it("turns one cell red and leaves its neighbours' shared style alone", () => {
    const sheet = aSheet();

    markTextRed(sheet.getRow(2).getCell(12));

    expect(sheet.getRow(2).getCell(12).font?.color?.argb).toBe(CORRECTED_TEXT_ARGB);
    expect(sheet.getRow(2).getCell(12).font?.name).toBe("Aptos Narrow");
    expect(sheet.getRow(2).getCell(1).font?.color).toBeUndefined();
    expect(sheet.getRow(3).getCell(12).font?.color).toBeUndefined();
  });

  it("keeps red text red and yellow fill yellow on one cell", () => {
    const sheet = aSheet();

    writeTextInRed(sheet, 6, new Map([[2, "EUCU4581604"]]));
    markRowsYellow(sheet, [2], 21);

    const cell = sheet.getRow(2).getCell(6);
    expect(cell.value).toBe("EUCU4581604");
    expect(cell.font?.color?.argb).toBe(CORRECTED_TEXT_ARGB);
    expect(fillOf(cell)).toBe(YELLOW);
  });
});
