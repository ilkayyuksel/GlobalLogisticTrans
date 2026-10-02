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
 * ── WHERE THE NEW LINES GO ──────────────────────────────────────────────────
 * Directly below the document's last line and directly above its totals row —
 * where the customer would have typed them. The totals row and the summary block
 * move down to make room (see `openRowsAt`), and every formula is rewritten for
 * the move, so the totals cover the added lines and the summary still reads the
 * totals. No line the customer wrote moves: the opened rows are BELOW all of
 * them, so the row number each line is reported and corrected by stays true.
 *
 * ── AND THEY LOOK LIKE THE DOCUMENT'S OWN LINES ─────────────────────────────
 * Each column takes the style the customer's lines USUALLY have in it — see
 * `typicalStyles`. Not the first line's: a customer highlights individual lines
 * by hand, and copying one highlighted line would paint every added line with
 * it. The Supplier comes from their lines, and the Fuel follows their own
 * formula convention. Nothing is styled from scratch, and no column is invented.
 */

/** What an added line copies from the document's own lines. */
export interface AddedRowTemplate {
  /** An existing line, for the columns its style is read from. */
  readonly rowNumber: number;
  /**
   * The style each column's lines usually have, by column number — across the
   * full width the lines use, so an added line is formatted edge to edge.
   */
  readonly styles: ReadonlyMap<number, Partial<ExcelJS.Style>>;
  /** The customer's own Supplier value, as their lines state it. */
  readonly supplier: string;
  /**
   * The percentage the Fuel column charges, when the document writes Fuel as a
   * formula. Null when it writes plain amounts.
   */
  readonly fuelPercentage: Prisma.Decimal | null;
}

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
    styles: typicalStyles(worksheet, sheet),
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

/**
 * The style the customer's lines usually have, column by column.
 *
 * The most common one wins, so a line they highlighted by hand — a fill on its
 * booking, a bold amount — is outvoted by the ordinary lines around it. Read
 * from the document before this check changes anything in it, so a line it
 * marks or corrects cannot become the template either.
 *
 * Each style is a COPY: ExcelJS hands every cell of one style the same object,
 * and the added lines must never share theirs with the customer's cells.
 */
function typicalStyles(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
): Map<number, Partial<ExcelJS.Style>> {
  const counts = new Map<
    number,
    Map<string, { style: Partial<ExcelJS.Style>; seen: number }>
  >();

  for (const line of sheet.rows) {
    worksheet
      .getRow(line.rowNumber)
      .eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const style = cell.style ?? {};
        const signature = JSON.stringify(style);
        const forColumn = counts.get(columnNumber) ?? new Map();
        const known = forColumn.get(signature);

        forColumn.set(signature, {
          style: known?.style ?? style,
          seen: (known?.seen ?? 0) + 1,
        });
        counts.set(columnNumber, forColumn);
      });
  }

  const styles = new Map<number, Partial<ExcelJS.Style>>();

  for (const [columnNumber, forColumn] of counts) {
    const typical = [...forColumn.values()].sort((a, b) => b.seen - a.seen)[0];

    styles.set(columnNumber, structuredClone(typical.style));
  }

  return styles;
}

/**
 * Where the first added line goes: the row the totals row is on now, which
 * moves down to make room. A document with no totals row has nothing to move,
 * and the lines go directly below the last thing it states.
 */
export function toFirstAddedRowNumber(sheet: InvoiceSheet): number {
  if (sheet.totalsRowNumber !== null) {
    return sheet.totalsRowNumber;
  }

  return (
    Math.max(
      sheet.headerRowNumber,
      ...sheet.rows.map((row) => row.rowNumber),
      ...sheet.incompleteRowNumbers,
    ) + 1
  );
}

/**
 * Writes one missing transport as a line of this document.
 *
 * ── WHAT IS FILLED, AND WHAT IS DELIBERATELY NOT ────────────────────────────
 * Everything this system holds: the day, the times, the container, the route as
 * the Trip domain derives it, the distance, and every amount from the effective
 * pricing — the same figures the existing lines are corrected towards.
 *
 * Remarks says what the exports say about the Trip — its Custom Properties,
 * TAR when charged, its waiting window and every Cost Confirmation — in the one
 * vocabulary `trip-export-labels.ts` owns. Nothing is composed here.
 *
 * Startpoint, Endpoint and Route are left empty: their vocabulary
 * (`VOYAGE BEQ869`, `BE-Q869,BE-90000000`) is the customer's own planning
 * system's and no source in this one states it. The customer leaves them empty
 * on the lines they add by hand too.
 *
 * ── AN AMOUNT OF NOTHING IS AN EMPTY CELL ───────────────────────────────────
 * Never a written 0. The customer's money format prints zero as `- €`, and
 * their own lines leave a component they do not charge EMPTY — not one literal
 * zero in the whole real `week 13` invoice. A line we add says nothing about a
 * component that costs nothing, exactly as theirs do.
 */
export function writeAddedRow(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  template: AddedRowTemplate,
  missing: MissingTrip,
  rowNumber: number,
): void {
  const row = worksheet.getRow(rowNumber);

  /*
   * The look of the customer's own lines, edge to edge — every column their
   * lines format, not only the ones written below, so the row reads as one of
   * theirs. Each cell gets a style object of its own.
   */
  for (const [columnNumber, style] of template.styles) {
    row.getCell(columnNumber).style = structuredClone(style);
  }

  const write = (column: InvoiceColumn, value: ExcelJS.CellValue) => {
    const position = sheet.columns[column];

    if (position === undefined) {
      return;
    }

    row.getCell(position).value = value;
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
  // Nothing to say is an empty cell, never an empty string.
  write("remarks", missing.remarks === "" ? null : missing.remarks);

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

  // No fuel is an empty cell, not a formula that comes to `- €`.
  if (brandstof.isZero()) {
    return null;
  }

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
    // Never zero here: a zero fuel returned an empty cell above.
    result: Number(brandstof.toFixed(MONEY_DECIMAL_PLACES)),
  };
}

/** `08:30`, as the document's own Time column states it. */
function toClockTime(time: Date | null): string | null {
  if (time === null) {
    return null;
  }

  return time.toISOString().slice(11, 16);
}

/** The amount as a cell holds it, or nothing at all for an amount of zero. */
function toNumber(amount: Prisma.Decimal): number | null {
  const rounded = Number(amount.toFixed(MONEY_DECIMAL_PLACES));

  return rounded === 0 ? null : rounded;
}

/** What an amount cell of a row holds, for the totals to add up. */
export function amountOf(cell: ExcelJS.Cell): Prisma.Decimal | null {
  return toAmountCell(cell.value).value;
}
