import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { toColumnLetter } from "./invoice-columns";
import type { InvoiceSheet } from "./invoice-sheet";

/**
 * How the document writes a line, read off the lines it already has — the
 * look an added line copies. See `invoice-row-appender.ts` for the writing.
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
  /**
   * How the document spells the Combination marker — `COMBINATION ` with its
   * trailing space in every real week — so an added leg is marked exactly as
   * the customer's own legs are.
   */
  readonly combinationMarker: string;
}

/** The marker's own word, when the document has no leg to copy its spelling from. */
const COMBINATION_MARKER = "COMBINATION";

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
    combinationMarker: toCombinationMarker(worksheet, sheet),
  };
}

/**
 * The marker exactly as a leg of theirs spells it. Read off the cell, not off
 * the read line: the reader trims, and the customer's trailing space is part
 * of how their document writes it.
 */
function toCombinationMarker(worksheet: ExcelJS.Worksheet, sheet: InvoiceSheet): string {
  const ends = [sheet.columns.startPoint, sheet.columns.endPoint].filter(
    (column): column is number => column !== undefined,
  );

  for (const line of sheet.rows) {
    for (const column of ends) {
      const value = worksheet.getRow(line.rowNumber).getCell(column).value;

      if (typeof value === "string" && value.trim().toUpperCase() === COMBINATION_MARKER) {
        return value;
      }
    }
  }

  return COMBINATION_MARKER;
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
