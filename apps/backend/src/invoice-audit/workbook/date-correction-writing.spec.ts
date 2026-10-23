import ExcelJS from "exceljs";

import { writeDatesInRed } from "./cell-marking";
import { toPlanningDate } from "./invoice-sheet";

describe("a corrected date, written in the form the cell already holds", () => {
  async function written(value: ExcelJS.CellValue, numFmt: string) {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Sheet1");

    sheet.getCell("A2").value = value;
    sheet.getCell("A2").numFmt = numFmt;
    writeDatesInRed(sheet, 1, new Map([[2, "2026-10-07"]]));

    const back = new ExcelJS.Workbook();

    await back.xlsx.load((await book.xlsx.writeBuffer()) as ArrayBuffer);

    return back.worksheets[0].getCell("A2");
  }

  it.each([
    // A serial under a date format is read back by ExcelJS as a date, so the
    // bare serial is written under a number format.
    ["a date", new Date("2026-10-06T00:00:00.000Z"), "dd/mm/yyyy", "object"],
    ["an Excel serial", 46301, "0", "number"],
    ["text", "2026-10-06", "@", "string"],
  ])("keeps %s as that kind of value, reading back as the Trip's day, in red", async (_kind, value, numFmt, type) => {
    const cell = await written(value, numFmt);

    expect(typeof cell.value).toBe(type);
    expect(toPlanningDate(cell.value)).toBe("2026-10-07");
    expect(cell.numFmt).toBe(numFmt);
    expect(cell.font?.color?.argb).toBe("FFFF0000");
  });
});
