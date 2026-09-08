import type { Worksheet } from "exceljs";

import type { Language } from "@/lib/i18n/translations";
import { TRANSLATIONS } from "@/lib/i18n/translations";
import { combinationFillArgb } from "./combination";
import type { BasicExportRow, PricingExportRow } from "./export-rows";
import {
  GRID_BORDER,
  HEADER_FILL_COLOR,
  INK,
  REFERENCE_TIME_FORMAT,
  type StyledColumn,
  applyReferenceLook,
  writeDateHeading,
} from "./export-style";

/**
 * The two operational workbooks, as real `.xlsx` files.
 *
 * ── VALUES, NOT TEXT ────────────────────────────────────────────────────────
 * Dates and times are written as real Excel values with a display format, not
 * as strings: a date cell can be sorted, filtered and compared, and text cannot.
 * The formats pin what a reader sees — `DD/MM/YYYY` and `HH:mm` — so Excel's
 * own locale cannot turn 07/06 into June 7th.
 *
 * Money is written as a number with a EUR format, so a column can be totalled
 * in the spreadsheet. Nothing is totalled HERE: the numbers come from stored
 * pricing lines, and a total this file computed could disagree with the
 * snapshot it came from.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * An empty cell stays empty. A Trip that was never priced and a Trip priced at
 * zero are different facts, and `0.00` would state the second while meaning the
 * first.
 */

const DATE_FORMAT = "dd/mm/yyyy";
const TIME_FORMAT = "hh:mm";
const MONEY_FORMAT = '#,##0.00 "€"';
const PERCENT_FORMAT = "0\\%";

/**
 * The basic export's look is not chosen here.
 *
 * It reproduces `docs/07-excels/29-06-2026.xlsx`, the sheet the office has
 * printed for years; every colour, width and height comes from
 * `export-style.ts`, which read that workbook cell by cell. TRANO's own
 * interface palette deliberately does not appear in any workbook — a navy
 * header band is a web design, and on paper it is a black bar.
 */

/**
 * Excel keeps a date as days since 1899-12-30, in no timezone at all.
 *
 * Built from the calendar parts rather than from `new Date(...)`: a planning
 * date is a calendar day, and putting it through a JavaScript Date attaches an
 * offset that can move it a day for anyone west of UTC — which is exactly how
 * an export ends up one day early.
 */
const EXCEL_EPOCH_OFFSET_DAYS = 25_569;
const MILLISECONDS_PER_DAY = 86_400_000;

export function toExcelDate(isoDate: string | null): number | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }

  const [year, month, day] = isoDate.split("-").map(Number);

  return Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY + EXCEL_EPOCH_OFFSET_DAYS;
}

/** A time of day is a fraction of one Excel day. */
export function toExcelTime(clockTime: string | null): number | null {
  if (!clockTime) {
    return null;
  }

  const [hours, minutes] = clockTime.split(":").map(Number);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return (hours * 60 + minutes) / (24 * 60);
}

interface ColumnSpec {
  readonly header: string;
  readonly width: number;
  readonly format?: string;
  readonly wrap?: boolean;
}

/**
 * The pricing export's columns, in the order the business reads them.
 *
 * Headers are the operator's own words rather than translation keys: this
 * workbook is a business document with a fixed layout, and a column that
 * changed its name with the interface language would break every spreadsheet
 * built on top of it.
 */
const PRICING_COLUMNS: readonly ColumnSpec[] = [
  { header: "Datum", width: 12, format: DATE_FORMAT },
  { header: "Begin", width: 8, format: TIME_FORMAT },
  { header: "Eind", width: 8, format: TIME_FORMAT },
  { header: "Containertype", width: 14 },
  { header: "Bookingnr", width: 18 },
  { header: "Containernr.", width: 16 },
  { header: "Startpoint", width: 20 },
  { header: "Trip", width: 30 },
  { header: "Endpoint", width: 20 },
  { header: "Tarief", width: 12, format: MONEY_FORMAT },
  { header: "Brandstof (%)", width: 13, format: PERCENT_FORMAT },
  { header: "Backload", width: 12, format: MONEY_FORMAT },
  { header: "Tol", width: 12, format: MONEY_FORMAT },
  { header: "Tunnel", width: 12, format: MONEY_FORMAT },
  { header: "Others", width: 12, format: MONEY_FORMAT },
  /*
   * ── WACHTTIJD HAD NO COLUMN, AND EK HELD IT ─────────────────────────────
   * The waiting time was written into the column headed EK, so the sheet
   * labelled one component as another and the CONFIRMED COST — which is what
   * EK means everywhere else in this system, including the Ritten list —
   * appeared nowhere at all. A Cost Confirmation arriving for a Trip changed
   * the total on screen and changed nothing in the export.
   *
   * The waiting time now has the column it always needed, and EK holds EK.
   */
  { header: "Wachttijd", width: 12, format: MONEY_FORMAT },
  { header: "EK", width: 12, format: MONEY_FORMAT },
  { header: "Remarks", width: 32, wrap: true },
];

/**
 * The daily operational sheet, column for column as the office knows it.
 *
 * ── THIS LAYOUT IS COPIED, NOT DESIGNED ─────────────────────────────────────
 * The first nine columns are the reference workbook's: the same names, the same
 * order, the same widths and the same ink. Dispatchers read this sheet on paper
 * at arm's length and find a value by its POSITION and its COLOUR long before
 * they read a header, so moving a column or recolouring one costs real time at
 * a real desk. `CONT NR` in particular is 11.54 wide because a container number
 * such as `EUCU1451295` has to sit on one line.
 *
 * ── NINE COLUMNS, EXACTLY THE REFERENCE'S ───────────────────────────────────
 * A tenth, `AFGEWERKT`, was TRANO's own addition and has been removed: the
 * sheet is the reference's again. The Trip's status is untouched — it is simply
 * not a column here.
 */
const BASIC_COLUMNS: readonly StyledColumn[] = [
  { header: "NR PLAAT", width: 8.7265625, fontColor: INK.red },
  {
    header: "TIJD",
    width: 8.7265625,
    fontColor: INK.green,
    format: REFERENCE_TIME_FORMAT,
  },
  {
    header: "TIJD",
    width: 8.7265625,
    fontColor: INK.green,
    format: REFERENCE_TIME_FORMAT,
  },
  { header: "BOEKING", width: 9.6328125, fontColor: INK.blue },
  { header: "TYPE", width: 8.7265625, fontColor: INK.red },
  { header: "CONT NR", width: 11.54296875, fontColor: INK.green },
  { header: "PLAATS", width: 19.6328125, fontColor: INK.blue },
  { header: "COMBI EN KOST", width: 25.90625, fontColor: INK.green },
  { header: "INFO", width: 41, fontColor: INK.red },
];

/** Column G, where the reference prints the day. */
const DATE_HEADING_COLUMN = 7;

/** Row 1 is the date; the table starts under it. */
const BASIC_HEADER_ROW = 2;



/** An empty workbook with one sheet, however that sheet is later dressed. */
async function createWorkbook(title: string) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "TRAXO";
  workbook.created = new Date();

  return { workbook, sheet: workbook.addWorksheet(title) };
}

/**
 * The pricing sheet's own look.
 *
 * ── WHY IT IS NOT THE REFERENCE LOOK ────────────────────────────────────────
 * These are two different documents. The reference workbook is a printed
 * dispatch sheet with nine fixed columns; the pricing export is a seventeen
 * column analysis that is read on screen, sorted and filtered. Forcing the
 * dispatch sheet's 8pt grid and printed-page setup onto it would make a
 * spreadsheet nobody can work in.
 *
 * What the two DO share is that no TRANO interface colour appears in either.
 * The header band is the same pale grey, and the borders are the same thin
 * black, so the two files still look like they came from the same system.
 */
async function createPricingSheet(
  title: string,
  columns: readonly ColumnSpec[],
  rowCount: number,
) {
  const { workbook, sheet } = await createWorkbook(title);

  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width,
    style: {
      numFmt: column.format,
      alignment: column.wrap ? { wrapText: true, vertical: "top" } : undefined,
    },
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: INK.black } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL_COLOR },
  };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 20;

  // The header stays put while scrolling, and every column can be filtered —
  // the two things that make a long analysis usable at all. The dispatch sheet
  // has neither, because paper does not scroll.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(rowCount + 1, 2), column: columns.length },
  };

  return { workbook, sheet };
}

/** Thin black on every filled cell, as both sheets want. */
function applyBorders(sheet: Worksheet): void {
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = GRID_BORDER;
    });
  });
}

export async function buildPricingWorkbook(
  rows: readonly PricingExportRow[],
  language: Language,
): Promise<ArrayBuffer> {
  const translations = TRANSLATIONS[language];
  const { workbook, sheet } = await createPricingSheet(
    translations["ritten.export.pricingSheet"],
    PRICING_COLUMNS,
    rows.length,
  );

  for (const row of rows) {
    sheet.addRow([
      toExcelDate(row.planningDate),
      toExcelTime(row.startTime),
      toExcelTime(row.endTime),
      row.containerType,
      row.bookingNumber,
      row.containerNumber,
      row.startPoint,
      row.trip,
      row.endPoint,
      row.basePrice,
      row.fuelPercentage,
      row.backload,
      row.toll,
      row.tunnel,
      row.others,
      row.waitingTime,
      row.ek,
      row.remarks,
    ]);
  }

  applyBorders(sheet);

  return workbook.xlsx.writeBuffer();
}

/** The days an export covers, as the list's period filter had them. */
export interface ExportPeriod {
  /** `YYYY-MM-DD`. */
  readonly start: string;
  readonly end: string;
}

/**
 * The daily operational sheet, in the reference workbook's own layout.
 *
 * Row 1 carries the day, row 2 the headers, and the Trips follow. That order is
 * the reference's and it is also simply how the sheet is read: a printed page
 * that does not say which day it is cannot be filed.
 *
 * One Trip is one row. Trips of the same Combination are NOT merged: each keeps
 * its own times, booking, container and destination, which is the only way a
 * combination spanning midnight can show both of its days.
 */
export async function buildBasicWorkbook(
  rows: readonly BasicExportRow[],
  language: Language,
  period: ExportPeriod,
): Promise<ArrayBuffer> {
  const translations = TRANSLATIONS[language];
  const { workbook, sheet } = await createWorkbook(
    translations["ritten.export.basicSheet"],
  );

  writeHeaderRow(sheet);

  for (const row of rows) {
    sheet.addRow([
      row.licensePlate,
      toExcelTime(row.startTime),
      toExcelTime(row.endTime),
      row.bookingNumber,
      row.containerType,
      row.containerNumber,
      row.trip,
      row.costs,
      row.info,
    ]);
  }

  /*
   * ── ONE COMBINATION, ONE COLOUR, ACROSS THE WHOLE ROW ───────────────────
   * Applied AFTER the reference look, which paints every body cell, so the
   * fill lands on all nine columns rather than only the ones that happen to
   * hold a value. The colour comes from the group ID through the very function
   * the Ritten list's group tag uses, so a Combination reads the same on paper
   * as on screen — and keeps its colour across the days it spans, because the
   * id does not change with the date or the row's position.
   */
  paintGroupRows(sheet, rows, BASIC_HEADER_ROW);

  applyReferenceLook(sheet, BASIC_COLUMNS, BASIC_HEADER_ROW);
  writeDatePeriod(sheet, period);

  return workbook.xlsx.writeBuffer();
}

/** The headers go in row 2, because row 1 belongs to the date. */
function writeHeaderRow(sheet: Worksheet): void {
  const header = sheet.getRow(BASIC_HEADER_ROW);

  BASIC_COLUMNS.forEach((column, index) => {
    header.getCell(index + 1).value = column.header;
  });

  header.commit();
}

/**
 * The day above the table.
 *
 * A one-day export gets a REAL DATE, exactly as the reference does: the cell
 * holds the day rather than a sentence about it, so it formats to the reader's
 * expectation and can be compared. A week or a month has no single date to be,
 * so it says the range in words instead — inventing a date for it would put a
 * day on the page that the sheet does not cover.
 */
function writeDatePeriod(sheet: Worksheet, period: ExportPeriod): void {
  if (period.start === period.end) {
    const excelDate = toExcelDate(period.start);

    if (excelDate !== null) {
      writeDateHeading(sheet, DATE_HEADING_COLUMN, excelDate, DATE_FORMAT);
      return;
    }
  }

  writeDateHeading(
    sheet,
    DATE_HEADING_COLUMN,
    `${toDayLabel(period.start)} - ${toDayLabel(period.end)}`,
  );
}

/** `2026-06-29` as `29/06/2026`, matching the date cells' own format. */
function toDayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");

  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

/**
 * The file name, carrying the period it covers.
 *
 * A day is one date; a week or a month is the range, so two exports taken on
 * the same afternoon for different periods cannot overwrite each other in a
 * downloads folder.
 */
export function pricingFileName(periodStart: string, periodEnd: string): string {
  return buildFileName("TRANO_Prijzen", periodStart, periodEnd);
}

export function basicFileName(periodStart: string, periodEnd: string): string {
  return buildFileName("TRANO_Ritten", periodStart, periodEnd);
}

function buildFileName(
  prefix: string,
  periodStart: string,
  periodEnd: string,
): string {
  return periodStart === periodEnd
    ? `${prefix}_${periodStart}.xlsx`
    : `${prefix}_${periodStart}_${periodEnd}.xlsx`;
}

/**
 * Fills each row belonging to a group, every cell of it.
 *
 * A Trip in no group is left alone: the sheet's own background and its grid
 * lines are what the office reads the table by, and painting a standalone row
 * white would flatten them.
 */
function paintGroupRows(
  sheet: Worksheet,
  rows: readonly BasicExportRow[],
  headerRowNumber: number,
): void {
  rows.forEach((row, index) => {
    const argb = combinationFillArgb(row.tripGroupId);

    if (argb === null) {
      return;
    }

    const sheetRow = sheet.getRow(headerRowNumber + 1 + index);

    for (let column = 1; column <= BASIC_COLUMNS.length; column += 1) {
      sheetRow.getCell(column).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb },
      };
    }
  });
}
