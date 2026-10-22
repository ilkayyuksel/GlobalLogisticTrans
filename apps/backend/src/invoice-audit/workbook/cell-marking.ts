import ExcelJS from "exceljs";

/**
 * How the corrected document SHOWS what this check did.
 *
 *   felgeel, the whole row   a line somebody has to look at
 *   red text, one cell       a value this check changed — an amount it raised
 *                            or removed, a number it corrected, Remarks it
 *                            completed (as the owner's own corrections of week
 *                            36 colour them)
 *
 * The two are different properties of a cell's style — its fill and its font —
 * so a red value on a yellow row keeps both.
 *
 * ── ONE CELL'S STYLE, NEVER ANOTHER'S ───────────────────────────────────────
 * ExcelJS hands every cell that shares a style in the file ONE style object;
 * editing it in place recoloured 1,543 of the 1,690 cells of the real week 13
 * invoice. Every change below assigns a NEW style object to the one cell.
 */

/**
 * The fluorescent yellow a problem line is marked with: the colour the
 * customer's own sheets already use to make a cell stand out.
 */
const PROBLEM_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};

/** The red of a value this check changed. */
export const CORRECTED_TEXT_ARGB = "FFFF0000";

/**
 * Paints whole rows yellow: every cell from the first column to the last
 * column of the header — the row as the customer lays it out, also where its
 * cells are empty, and over any fill the customer gave a cell of that row.
 * Values, formulas, fonts and borders are left exactly as they are.
 */
export function markRowsYellow(
  worksheet: ExcelJS.Worksheet,
  rowNumbers: Iterable<number>,
  lastColumnNumber: number,
): number {
  let count = 0;

  for (const rowNumber of new Set(rowNumbers)) {
    const row = worksheet.getRow(rowNumber);

    for (let column = 1; column <= lastColumnNumber; column += 1) {
      const cell = row.getCell(column);

      cell.style = { ...cell.style, fill: { ...PROBLEM_FILL } };
    }

    count += 1;
  }

  return count;
}

/** Turns one cell's text red, and changes nothing else about it. */
export function markTextRed(cell: ExcelJS.Cell): void {
  cell.style = {
    ...cell.style,
    font: { ...cell.style.font, color: { argb: CORRECTED_TEXT_ARGB } },
  };
}

/** Excel counts days from 1899-12-30. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Writes a corrected day (`YYYY-MM-DD`) into one column of each given row, in
 * red, in the FORM the cell already holds a day: a date stays a date, an Excel
 * serial a serial, text text. So the cell keeps the customer's own number
 * format and reads back as the same day — never a different kind of value.
 */
export function writeDatesInRed(
  worksheet: ExcelJS.Worksheet,
  columnNumber: number | undefined,
  daysByRow: ReadonlyMap<number, string>,
): number {
  if (columnNumber === undefined) {
    return 0;
  }

  for (const [rowNumber, day] of daysByRow) {
    const cell = worksheet.getRow(rowNumber).getCell(columnNumber);
    const midnight = new Date(`${day}T00:00:00.000Z`);

    if (cell.value instanceof Date) {
      cell.value = midnight;
    } else if (typeof cell.value === "number") {
      cell.value = (midnight.getTime() - EXCEL_EPOCH_MS) / MILLISECONDS_PER_DAY;
    } else {
      cell.value = day;
    }

    markTextRed(cell);
  }

  return daysByRow.size;
}

/**
 * Writes a text value into one column of each given row, in red: a corrected
 * container or booking number, completed Remarks.
 */
export function writeTextInRed(
  worksheet: ExcelJS.Worksheet,
  columnNumber: number | undefined,
  valuesByRow: ReadonlyMap<number, string>,
): number {
  if (columnNumber === undefined) {
    return 0;
  }

  for (const [rowNumber, value] of valuesByRow) {
    const cell = worksheet.getRow(rowNumber).getCell(columnNumber);

    cell.value = value;
    markTextRed(cell);
  }

  return valuesByRow.size;
}
