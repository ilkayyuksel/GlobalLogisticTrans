import type { Worksheet } from "exceljs";

/**
 * The look of the operational day sheet, taken from the reference workbook.
 *
 * ── WHERE THESE NUMBERS COME FROM ───────────────────────────────────────────
 * `docs/07-excels/29-06-2026.xlsx`, read cell by cell rather than eyeballed.
 * Every constant below is a value that workbook actually carries: the column
 * widths, the two point sizes, the four colours, the row heights and the page
 * setup. Nothing here is a modern-spreadsheet default or a designer's guess,
 * because the point of this file is that a printed TRANO sheet is
 * indistinguishable from the sheet the office has used for years.
 *
 * ── WHY A SEPARATE MODULE ───────────────────────────────────────────────────
 * The workbook builders decide WHICH value goes in WHICH column. This decides
 * what a column LOOKS like. Keeping them apart means a styling change cannot
 * quietly alter a value, and the reference can be re-read and re-checked
 * against one small file.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The table's typeface.
 *
 * Microsoft Sans Serif at 8pt is what the reference uses everywhere in the
 * grid, and it is why the sheet is dense enough to print a full day on one
 * landscape page. A larger or friendlier font would not fit.
 */
export const TABLE_FONT = { name: "Microsoft Sans Serif", family: 2, size: 8 };

/** The date above the table is the one place the reference changes typeface. */
export const HEADING_FONT = {
  name: "Calibri",
  family: 2,
  size: 12,
  bold: true,
  underline: true,
  color: { argb: "FFFF0000" },
};

/**
 * The four colours the sheet is written in.
 *
 * This is a reading aid, not decoration: an operator scanning a printed sheet
 * finds the plate by its red, the times by their green and the booking by its
 * blue without reading a single header. Which column gets which colour is
 * therefore a fixed convention and not a free choice — see the column tables in
 * `export-workbooks.ts`.
 */
export const INK = {
  red: "FFFF0000",
  green: "FF00B050",
  blue: "FF0070C0",
  black: "FF000000",
} as const;

/** The header band. A pale grey, not a brand colour. */
export const HEADER_FILL_COLOR = "FFF0F0F0";

/**
 * Thin and black, on every cell of the grid.
 *
 * The reference borders the whole table rather than using banding or a table
 * style, which is what makes it legible in black and white on a dashboard.
 */
const THIN_BLACK = { style: "thin" as const, color: { argb: INK.black } };

export const GRID_BORDER = {
  top: THIN_BLACK,
  left: THIN_BLACK,
  bottom: THIN_BLACK,
  right: THIN_BLACK,
};

/** Compact and uniform: the reference gives every row the same 20 points. */
export const HEADING_ROW_HEIGHT = 19;
export const TABLE_ROW_HEIGHT = 20;
export const DEFAULT_ROW_HEIGHT = 14.5;

/**
 * Real times, shown as a clock.
 *
 * `h:mm;@` is the reference's own format. The cells hold real Excel time
 * values, so they sort and subtract; without a format they would read as
 * `0.333333333`.
 */
export const REFERENCE_TIME_FORMAT = "h:mm;@";

/**
 * How the sheet prints.
 *
 * ── DELIBERATE: NO MARGINS ──────────────────────────────────────────────────
 * The reference prints edge to edge on A4 landscape with gridlines and row
 * headers switched off, so the paper carries the table and nothing else.
 *
 * ── ONE DEVIATION: fitToPage ────────────────────────────────────────────────
 * The reference has `fitToPage: false` at 100%, which happens to fit because it
 * has exactly nine columns. TRANO carries a tenth (the completed mark), and at
 * a fixed 100% that column would fall onto a second sheet of paper. Fitting to
 * ONE PAGE WIDE keeps the sheet whole; `fitToHeight: 0` lets a long export run
 * over as many pages as it needs, because squeezing a month onto one page would
 * make it unreadable.
 */
export const PAGE_SETUP = {
  paperSize: 9,
  orientation: "landscape" as const,
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  horizontalCentered: true,
  verticalCentered: true,
  showGridLines: false,
  showRowColHeaders: false,
  margins: { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 },
};

/** A column of the printed grid: what it is called, how wide, in which ink. */
export interface StyledColumn {
  readonly header: string;
  readonly width: number;
  readonly fontColor: string;
  readonly format?: string;
}

/**
 * Applies the reference look to a finished sheet.
 *
 * Called AFTER every row has been added, so it can style what is actually
 * there. Doing it up front through column defaults leaves later rows to
 * ExcelJS's own inheritance rules, which is how half a table ends up unstyled.
 */
export function applyReferenceLook(
  sheet: Worksheet,
  columns: readonly StyledColumn[],
  headerRowNumber: number,
): void {
  sheet.properties.defaultRowHeight = DEFAULT_ROW_HEIGHT;
  sheet.pageSetup = { ...sheet.pageSetup, ...PAGE_SETUP };
  // Stated rather than left out: this sheet is printed, and a frozen pane is a
  // screen convenience that the reference deliberately does not have.
  sheet.views = [{ state: "normal" }];

  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  styleHeaderRow(sheet, columns, headerRowNumber);
  styleBodyRows(sheet, columns, headerRowNumber);
}

/**
 * The header band: centered, grey, and in each column's own ink.
 *
 * Not bold — the reference is not, and the grey fill already separates the band
 * from the data.
 */
function styleHeaderRow(
  sheet: Worksheet,
  columns: readonly StyledColumn[],
  headerRowNumber: number,
): void {
  const header = sheet.getRow(headerRowNumber);
  header.height = TABLE_ROW_HEIGHT;

  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);

    cell.font = { ...TABLE_FONT, color: { argb: column.fontColor } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = GRID_BORDER;
  });
}

/**
 * The data rows: left-aligned, top-aligned, never wrapped.
 *
 * Wrapping is switched off on purpose. A single long remark would otherwise
 * expand its row to three times the height of its neighbours, and a printed
 * sheet of uneven rows is exactly what this restyle exists to avoid. A value
 * too long for its column is cut off on paper, which is visible; a silently
 * ragged table is not.
 */
function styleBodyRows(
  sheet: Worksheet,
  columns: readonly StyledColumn[],
  headerRowNumber: number,
): void {
  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= sheet.rowCount;
    rowNumber += 1
  ) {
    const row = sheet.getRow(rowNumber);
    row.height = TABLE_ROW_HEIGHT;

    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);

      cell.font = { ...TABLE_FONT, color: { argb: column.fontColor } };
      cell.alignment = { horizontal: "left", vertical: "top", wrapText: false };
      cell.border = GRID_BORDER;

      if (column.format) {
        cell.numFmt = column.format;
      }
    });
  }
}

/**
 * The date line above the table.
 *
 * ── WHY IT SITS IN COLUMN G ─────────────────────────────────────────────────
 * That is where the reference puts it, and the office reads it there. It is one
 * bordered cell rather than a merged banner, so the sheet has no merges at all
 * and every column still sorts.
 *
 * `value` is a real Excel date number for a single-day export — a value, so it
 * carries the day rather than describing it — and plain text for a period, for
 * which no single date exists. Passing text with no `format` is expected.
 */
export function writeDateHeading(
  sheet: Worksheet,
  columnNumber: number,
  value: number | string,
  format?: string,
): void {
  const row = sheet.getRow(1);
  row.height = HEADING_ROW_HEIGHT;

  const cell = row.getCell(columnNumber);
  cell.value = value;
  cell.font = HEADING_FONT;
  cell.alignment = { horizontal: "center" };
  cell.border = GRID_BORDER;

  if (format) {
    cell.numFmt = format;
  }
}
