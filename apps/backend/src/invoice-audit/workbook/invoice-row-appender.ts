import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { toIsoDate, toUtcDate } from "../../common/dates";
import type { MissingTrip } from "../missing/missing-trips.service";
import { MONEY_DECIMAL_PLACES, round, toAmountCell } from "./invoice-amounts";
import { toColumnLetter, type InvoiceColumn } from "./invoice-columns";
import type { InvoiceSheet } from "./invoice-sheet";

/**
 * Writes a finished transport the invoice never mentioned as a new line.
 *
 * ── WHERE THE NEW LINES GO, AND WHY THERE ───────────────────────────────────
 * Below everything the document already has — past the totals row and the
 * summary block — with one blank line between. Not because that is the prettiest
 * place, but because it is the only safe one: these workbooks carry shared
 * formulas, and ExcelJS cannot insert a row through them at all (it throws
 * "Shared Formula master must exist above and or left of clone"). Inserting
 * would also renumber every line below the insertion point, and the row number
 * of an existing line is what the check reports and corrects by.
 *
 * So nothing moves. Every original line keeps its own row, and the totals grow
 * to cover the new ones — see `extendTotals`.
 *
 * ── AND THEY LOOK LIKE THE DOCUMENT'S OWN LINES ─────────────────────────────
 * The euro formats, the date format and the Supplier come from a line the
 * customer wrote; the Fuel follows whatever convention that line uses. Nothing
 * is styled from scratch, and no column is invented.
 */

/** What an added line copies from the document's own lines. */
export interface AddedRowTemplate {
  /** An existing line whose look the new ones take. */
  readonly rowNumber: number;
  /** The customer's own Supplier value, as their lines state it. */
  readonly supplier: string;
  /**
   * The percentage the Fuel column charges, when the document writes Fuel as a
   * formula. Null when it writes plain amounts.
   */
  readonly fuelPercentage: Prisma.Decimal | null;
}

/** One blank line between the customer's document and what was added to it. */
const GAP_BEFORE_ADDED_ROWS = 1;

/**
 * Reads how the document writes a line, off a line it already has.
 *
 * Null when there is none to read — a document with no transport at all has no
 * convention to follow, and a guess would put our own habits in their file.
 */
export function toAddedRowTemplate(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
): AddedRowTemplate | null {
  const first = sheet.rows[0];

  if (!first) {
    return null;
  }

  const supplierColumn = sheet.columns.supplier;

  return {
    rowNumber: first.rowNumber,
    supplier:
      supplierColumn === undefined
        ? ""
        : String(worksheet.getRow(first.rowNumber).getCell(supplierColumn).value ?? ""),
    fuelPercentage: toFuelPercentage(sheet),
  };
}

/**
 * The percentage the Fuel column applies, read off the lines themselves.
 *
 * Never a constant of ours: the customer's own sheets have used 10% and 13%,
 * and a hard-coded figure would quietly disagree with their document. The first
 * line that writes Fuel as a percentage of its own Tarief answers for the sheet.
 */
function toFuelPercentage(sheet: InvoiceSheet): Prisma.Decimal | null {
  const tariefLetter = toColumnLetter(sheet.columns.tarief ?? 0);

  for (const row of sheet.rows) {
    const formula = row.amounts.fuel?.formula;

    if (!formula) {
      continue;
    }

    const match = new RegExp(
      `^\\s*(\\d+(?:[.,]\\d+)?)%\\s*\\*\\s*\\$?${tariefLetter}\\$?${row.rowNumber}\\s*$`,
      "i",
    ).exec(formula);

    if (match) {
      return new Prisma.Decimal(match[1].replace(",", "."));
    }
  }

  return null;
}

/** Where the first added line goes: below everything the document has. */
export function toFirstAddedRowNumber(sheet: InvoiceSheet): number {
  const used = [
    sheet.headerRowNumber,
    ...sheet.rows.map((row) => row.rowNumber),
    ...(sheet.totalsRowNumber === null ? [] : [sheet.totalsRowNumber]),
    ...sheet.summaryRowNumbers,
    ...sheet.incompleteRowNumbers,
  ];

  return Math.max(...used) + 1 + GAP_BEFORE_ADDED_ROWS;
}

/**
 * Writes one missing transport as a line of this document.
 *
 * ── WHAT IS FILLED, AND WHAT IS DELIBERATELY NOT ────────────────────────────
 * Everything this system holds: the day, the times, the container, the route as
 * the Trip domain derives it, the distance, and every amount from the effective
 * pricing — the same figures the existing lines are corrected towards.
 *
 * Startpoint, Endpoint, Route and Remarks are left empty. Their vocabulary
 * (`VOYAGE BEQ869`, `BE-Q869,BE-90000000`, `tar, EC 3631673`) lives in the
 * browser's own Excel export, and writing a second implementation of it here is
 * exactly the duplication this codebase refuses. The customer leaves those four
 * columns empty on the lines they add by hand, which is what these rows follow.
 */
export function writeAddedRow(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  template: AddedRowTemplate,
  missing: MissingTrip,
  rowNumber: number,
): void {
  const row = worksheet.getRow(rowNumber);
  const source = worksheet.getRow(template.rowNumber);

  const write = (column: InvoiceColumn, value: ExcelJS.CellValue) => {
    const position = sheet.columns[column];

    if (position === undefined) {
      return;
    }

    const cell = row.getCell(position);

    // The look of the customer's own line, cell for cell: the euro format, the
    // date format, the borders they use.
    cell.style = { ...source.getCell(position).style };
    cell.value = value;
  };

  const { trip, pricing } = missing;

  write("planningDate", trip.planningDate ? toUtcDate(toIsoDate(trip.planningDate)) : null);
  write("supplier", template.supplier);
  write("time", toClockTime(trip.startTime));
  write("containerType", trip.containerType);
  write("bookingNumber", trip.bookingNumber);
  write("containerNumber", trip.containerNumber);
  write("trip", missing.route);
  write("distance", trip.distanceKm === null ? null : Number(trip.distanceKm));

  if (pricing) {
    write("tarief", toNumber(pricing.tarief));
    write("fuel", toFuelCell(template, pricing, sheet, rowNumber));
    write("backload", toNumber(pricing.backload));
    // The same toll convention as a correction: the figure goes to Tol B, and
    // the columns the customer leaves empty stay empty.
    write("tolB", toNumber(pricing.tol));
    write("tunnel", toNumber(pricing.tunnel));
    write("others", toNumber(pricing.others));
    write("ek", toNumber(pricing.ek));
  }

  row.commit();
}

/**
 * The Fuel cell of an added line.
 *
 * When the document writes Fuel as a percentage of the Tarief, the new line is
 * written the same way — and only when that formula produces exactly what this
 * system holds. Where it would not (their percentage differs from ours), the
 * amount is written instead, because the figure that must be right is the
 * amount and not the arithmetic that produced it.
 */
function toFuelCell(
  template: AddedRowTemplate,
  pricing: { tarief: Prisma.Decimal; brandstof: Prisma.Decimal },
  sheet: InvoiceSheet,
  rowNumber: number,
): ExcelJS.CellValue {
  const brandstof = round(pricing.brandstof);

  if (template.fuelPercentage === null) {
    return toNumber(brandstof);
  }

  const produced = round(
    round(pricing.tarief).mul(template.fuelPercentage).div(100),
  );

  if (!produced.equals(brandstof)) {
    return toNumber(brandstof);
  }

  const tariefLetter = toColumnLetter(sheet.columns.tarief ?? 0);

  return {
    formula: `${template.fuelPercentage.toString()}%*${tariefLetter}${rowNumber}`,
    result: toNumber(brandstof),
  };
}

/** `08:30`, as the document's own Time column states it. */
function toClockTime(time: Date | null): string | null {
  if (time === null) {
    return null;
  }

  return time.toISOString().slice(11, 16);
}

function toNumber(amount: Prisma.Decimal): number {
  return Number(amount.toFixed(MONEY_DECIMAL_PLACES));
}

/** What an amount cell of a row holds, for the totals to add up. */
export function amountOf(cell: ExcelJS.Cell): Prisma.Decimal | null {
  return toAmountCell(cell.value).value;
}
