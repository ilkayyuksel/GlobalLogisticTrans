import { isCalendarDate, toIsoDate } from "../../common/dates";
import type { AuditMarkedRow } from "./invoice-audit-marker";
import type { InvoiceAmountCell } from "./invoice-amounts";
import type { InvoiceColumn, InvoiceColumnPositions } from "./invoice-columns";

/**
 * A weekly invoice, as this system reads it.
 *
 * ── EVERY ROW KEEPS ITS EXCEL ROW NUMBER ────────────────────────────────────
 * Not its position in a filtered list, not an index of our own: the number the
 * row has in the workbook. The corrected document is produced by writing into
 * these exact rows later, and a row number derived from anything else would
 * eventually point at the wrong line — the totals row, or somebody else's
 * transport.
 */
export interface InvoiceSheet {
  /** The sheet the rows were read from, as the workbook names it. */
  readonly sheetName: string;
  readonly headerRowNumber: number;
  readonly columns: InvoiceColumnPositions;
  readonly rows: readonly InvoiceSheetRow[];
  /**
   * The rows below the lines that are NOT transports: the totals row and the
   * summary block beneath it.
   *
   * Read and kept apart deliberately. They look like data to anything scanning
   * for filled cells — the totals row carries money in every amount column —
   * and counting them as invoice lines would invent transports nobody drove.
   */
  readonly totalsRowNumber: number | null;
  readonly summaryRowNumbers: readonly number[];
  /**
   * Rows that say SOMETHING but not enough to be a line: a booking with no
   * container, a container with no date.
   *
   * Reported rather than skipped silently, and never matched: the three
   * identity values are required, so a row missing one of them is a question
   * for the customer, not a Trip we failed to find.
   */
  readonly incompleteRowNumbers: readonly number[];
  /**
   * The lines a previous run of this check added to this document, by row.
   *
   * Empty for a customer's own invoice. A line named here is one this system
   * wrote in because the invoice had forgotten the transport — it is priced and
   * corrected like any other, and it is never settled. See
   * `invoice-audit-marker.ts`.
   */
  readonly addedByAudit: ReadonlyMap<number, AuditMarkedRow>;
}

/** One invoice line, exactly as the sheet states it. */
export interface InvoiceSheetRow {
  /** The row's number in the workbook, 1-based, as Excel counts. */
  readonly rowNumber: number;
  /** `YYYY-MM-DD`, normalised from whatever the cell held. */
  readonly planningDate: string;
  readonly bookingNumber: string;
  /** The container EXACTLY as the sheet spells it, spaces and all. */
  readonly containerNumber: string;
  /** The same container, as matching compares it. See `normalizeContainerNumber`. */
  readonly normalizedContainerNumber: string;
  /**
   * What this row charges, per amount column.
   *
   * Read as the cell states it — a figure, nothing, or a formula — because all
   * three are different facts and the comparison depends on which one it is.
   * A column the sheet does not have is simply absent here.
   */
  readonly amounts: Readonly<Partial<Record<InvoiceColumn, InvoiceAmountCell>>>;
}

/**
 * What a cell holds, reduced to text.
 *
 * Excel offers a value half a dozen ways — a number, a string, rich text, a
 * formula with a cached result, a hyperlink — and every one of them can appear
 * in a column a human types into. Reading them in one place keeps the rest of
 * this module free of Excel's type system.
 */
export function toCellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return toIsoDate(value);
  }

  if (typeof value === "object") {
    const candidate = value as {
      richText?: readonly { text: string }[];
      result?: unknown;
      text?: unknown;
    };

    if (candidate.richText) {
      return candidate.richText.map((part) => part.text).join("").trim();
    }

    // A formula cell: what it CALCULATED is what the sheet shows, so that is
    // what is read. A formula with no cached result says nothing yet.
    if (candidate.result !== undefined) {
      return toCellText(candidate.result);
    }

    if (typeof candidate.text === "string") {
      return candidate.text.trim();
    }

    return "";
  }

  return String(value).trim();
}

/**
 * Whether a cell holds ANYTHING — a value, or a formula that will produce one.
 *
 * ── WHY A FORMULA WITH NO RESULT STILL COUNTS ───────────────────────────────
 * The totals row is written as `=SUM(L2:L130)`, and a workbook saved by a
 * writer that did not calculate carries the formula with no cached result. Read
 * as a VALUE that cell is empty, which is honest; read as STRUCTURE it is the
 * totals row, and mistaking it for a blank line would let the summary block
 * below it be read as the totals instead.
 *
 * So the two questions are asked separately: `toCellText` answers what the cell
 * shows, and this answers whether the cell is there at all.
 */
export function statesSomething(value: unknown): boolean {
  if (value !== null && typeof value === "object" && "formula" in value) {
    return true;
  }

  return toCellText(value) !== "";
}

/**
 * The calendar day a Planning date cell states, or null.
 *
 * ── THREE SPELLINGS, ONE DAY ────────────────────────────────────────────────
 * A real Excel date cell arrives as a Date, which is the ordinary case in both
 * reference files. A sheet typed by hand may hold `2026-03-23` as text, and one
 * exported by another system may hold the serial number Excel stores
 * underneath. All three mean one day, and matching needs that day — not a
 * timestamp, and not a locale.
 *
 * Everything is read in UTC, as every other DATE in this system is: a local
 * interpretation would shift the day either side of midnight and match the
 * wrong Trips for whoever runs the server in the wrong timezone.
 */
export function toPlanningDate(value: unknown): string | null {
  if (value instanceof Date) {
    return toIsoDate(value);
  }

  if (typeof value === "number") {
    return fromExcelSerial(value);
  }

  const text = toCellText(value);

  if (text === "") {
    return null;
  }

  if (isCalendarDate(text)) {
    return text;
  }

  // Anything else is not a date this system will guess at: a day read wrongly
  // matches a real Trip on the wrong day, which is worse than reporting none.
  return null;
}

/** Excel counts days from 1899-12-30; the serial is that offset. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) {
    return null;
  }

  // The whole days only: a time of day is not part of a calendar date, and
  // rounding one into the next day is exactly the error this avoids.
  return toIsoDate(
    new Date(EXCEL_EPOCH_MS + Math.floor(serial) * MILLISECONDS_PER_DAY),
  );
}

/** The days an invoice covers, from the rows themselves. */
export function toInvoicePeriod(
  rows: readonly InvoiceSheetRow[],
): { readonly from: string; readonly to: string } | null {
  if (rows.length === 0) {
    return null;
  }

  const dates = rows.map((row) => row.planningDate).sort();

  return { from: dates[0], to: dates[dates.length - 1] };
}

/** Which columns a sheet offers, for a caller that only needs to ask. */
export function hasColumn(
  columns: InvoiceColumnPositions,
  column: InvoiceColumn,
): boolean {
  return columns[column] !== undefined;
}
