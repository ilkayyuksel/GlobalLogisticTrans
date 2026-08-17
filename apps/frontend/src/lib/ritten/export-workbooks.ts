import type { Language } from "@/lib/i18n/translations";
import { TRANSLATIONS } from "@/lib/i18n/translations";
import type { BasicExportRow, PricingExportRow } from "./export-rows";

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

const HEADER_FILL = "FF0B1220";
const HEADER_TEXT = "FFF8FAFC";
const BORDER_COLOR = "FFCBD5E1";

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
  { header: "EK", width: 12, format: MONEY_FORMAT },
  { header: "Remarks", width: 32, wrap: true },
];

const BASIC_COLUMNS: readonly ColumnSpec[] = [
  { header: "Afgewerkt", width: 11 },
  { header: "Nummerplaat", width: 14 },
  { header: "Begin", width: 8, format: TIME_FORMAT },
  { header: "Eind", width: 8, format: TIME_FORMAT },
  { header: "Boekingsnummer", width: 18 },
  { header: "Type", width: 10 },
  { header: "Container nummer", width: 18 },
  { header: "Trip", width: 30 },
  { header: "Kosten", width: 22 },
  { header: "Info", width: 34, wrap: true },
];

/**
 * The completed indicator.
 *
 * Symbols rather than a form control: ExcelJS has no checkbox, and a drawn one
 * would be a picture that no filter or formula can read. These are characters,
 * so a column of them sorts and filters like data.
 */
export const COMPLETED_MARK = "☑";
export const NOT_COMPLETED_MARK = "☐";

/** Both workbooks share their look, so neither drifts from the other. */
async function createSheet(
  title: string,
  columns: readonly ColumnSpec[],
  rowCount: number,
) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "TRAXO";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title);

  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width,
    style: {
      numFmt: column.format,
      alignment: column.wrap ? { wrapText: true, vertical: "top" } : undefined,
    },
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: HEADER_TEXT } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 20;

  // The header stays put while scrolling, and every column can be filtered —
  // the two things that make a long export usable at all.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(rowCount + 1, 2), column: columns.length },
  };

  return { workbook, sheet };
}

function applyBorders(sheet: {
  eachRow: (callback: (row: { eachCell: (cb: (cell: unknown) => void) => void }) => void) => void;
}): void {
  const thin = { style: "thin" as const, color: { argb: BORDER_COLOR } };

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      (cell as { border?: unknown }).border = {
        top: thin,
        left: thin,
        bottom: thin,
        right: thin,
      };
    });
  });
}

export async function buildPricingWorkbook(
  rows: readonly PricingExportRow[],
  language: Language,
): Promise<ArrayBuffer> {
  const translations = TRANSLATIONS[language];
  const { workbook, sheet } = await createSheet(
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
      row.remarks,
    ]);
  }

  applyBorders(sheet as never);

  return workbook.xlsx.writeBuffer();
}

export async function buildBasicWorkbook(
  rows: readonly BasicExportRow[],
  language: Language,
): Promise<ArrayBuffer> {
  const translations = TRANSLATIONS[language];
  const { workbook, sheet } = await createSheet(
    translations["ritten.export.basicSheet"],
    BASIC_COLUMNS,
    rows.length,
  );

  for (const row of rows) {
    sheet.addRow([
      row.isCompleted ? COMPLETED_MARK : NOT_COMPLETED_MARK,
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

  applyBorders(sheet as never);

  return workbook.xlsx.writeBuffer();
}

/**
 * The file name, carrying the period it covers.
 *
 * A day is one date; a week or a month is the range, so two exports taken on
 * the same afternoon for different periods cannot overwrite each other in a
 * downloads folder.
 */
export function pricingFileName(periodStart: string, periodEnd: string): string {
  return buildFileName("TRAXO_Prijzen", periodStart, periodEnd);
}

export function basicFileName(periodStart: string, periodEnd: string): string {
  return buildFileName("TRAXO_Ritten", periodStart, periodEnd);
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
