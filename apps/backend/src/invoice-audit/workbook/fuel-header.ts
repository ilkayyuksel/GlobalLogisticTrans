import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";

import type { AddedRow } from "../missing/added-rows";
import type { InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import { round } from "./invoice-amounts";
import { toColumnLetter } from "./invoice-columns";
import { fuelFormulaProduces } from "./invoice-row-appender";
import type { InvoiceSheet } from "./invoice-sheet";
import { toCellText } from "./invoice-sheet";
import { FUEL_PERCENTAGE, fuelHeaderCell, fuelPercentageOf } from "./totals-structure";

/**
 * The Fuel header and its summary label, when the corrected column states ONE
 * new percentage.
 *
 * ── ONLY WHEN THE WHOLE COLUMN SAYS IT ──────────────────────────────────────
 * The header (`Fuel 24%`) describes every Fuel cell of the column. It is
 * rewritten only when, after the corrections, EVERY Fuel cell that states an
 * amount is exactly `P%*L<its own row>` for one and the same P, and P is not
 * what the header already says. A column that ends up mixed — some cells kept
 * higher at the old percentage, some written as fixed amounts — keeps its
 * header and label exactly: the customer has no way of writing "mixed", and a
 * header like `Fuel gemengd` would also stop this check from finding the Fuel
 * column on the next upload. The cells that differ are in the preview.
 *
 * The lines this check ADDS belong to the column too: each one with a reliable
 * price and a Fuel must come out exactly at the new percentage, or the header
 * stays as it is.
 *
 * Only the number changes; the words, the spacing and the trailing space of
 * `Fuel 24% ` stay as the customer wrote them.
 */
export interface TextChange {
  readonly address: string;
  readonly before: string;
  readonly after: string;
}

export interface FuelHeaderChange {
  /** The percentage the whole column now states. */
  readonly percentage: string;
  readonly header: TextChange;
  /** The summary's Fuel label, when the document has one. */
  readonly label: TextChange | null;
}

export function planFuelHeader(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  added: readonly AddedRow[] = [],
): FuelHeaderChange | null {
  const header = fuelHeaderCell(worksheet, sheet);
  const current = fuelPercentageOf(header);
  const tarief = sheet.columns.tarief;

  if (header === null || current === null || tarief === undefined) {
    return null;
  }

  const percentages = new Set<string | null>(
    sheet.rows.flatMap((row) => {
      const formula = finalFuelFormula(sheet, pricing, row.rowNumber);

      return formula === undefined
        ? []
        : [percentageOfOwnRow(formula, toColumnLetter(tarief), row.rowNumber)];
    }),
  );

  if (percentages.size !== 1 || percentages.has(null)) {
    return null;
  }

  const percentage = [...percentages][0]!;

  if (percentage === current || !addedRowsFit(added, new Prisma.Decimal(percentage))) {
    return null;
  }

  return {
    percentage,
    header: toTextChange(header, percentage),
    label: toLabelChange(worksheet, sheet, percentage),
  };
}

/** Writes the header and label changes into the document. */
export function writeFuelHeader(worksheet: ExcelJS.Worksheet, change: FuelHeaderChange): void {
  for (const text of [change.header, change.label]) {
    if (text !== null) {
      worksheet.getCell(text.address).value = text.after;
    }
  }
}

/**
 * The Fuel cell of a row as it will be after the corrections: the planned
 * write, or the cell as it is. `undefined` for a cell that states no amount;
 * `null` for one that states a fixed amount rather than a formula.
 */
function finalFuelFormula(
  sheet: InvoiceSheet,
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
  rowNumber: number,
): string | null | undefined {
  const planned = pricing
    .get(rowNumber)
    ?.differences.find((difference) => difference.column === "fuel" && difference.write !== null)?.write;

  if (planned) {
    return planned.kind === "FORMULA" ? planned.formula : planned.value === null ? undefined : null;
  }

  // As read: the reader gives a borrowed shared formula back as the cell's own.
  const amount = sheet.rows.find((row) => row.rowNumber === rowNumber)?.amounts.fuel;

  if (!amount || (amount.value === null && amount.formula === null)) {
    return undefined;
  }

  return amount.formula;
}

/** Every added line that states a Fuel can state it at this percentage. */
function addedRowsFit(added: readonly AddedRow[], percentage: Prisma.Decimal): boolean {
  return added.every(
    (row) =>
      !row.reliability.reliable ||
      row.pricing === null ||
      round(row.pricing.brandstof).isZero() ||
      fuelFormulaProduces(percentage, row.pricing),
  );
}

/** `24` from `24%*L5` on row 5; null for anything else. */
function percentageOfOwnRow(
  formula: string | null,
  tariefLetter: string,
  rowNumber: number,
): string | null {
  if (formula === null) {
    return null;
  }

  const match = /^\s*(\d+(?:[.,]\d+)?)%\s*\*\s*\$?([A-Z]+)\$?(\d+)\s*$/i.exec(formula);

  return match !== null && match[2].toUpperCase() === tariefLetter && Number(match[3]) === rowNumber
    ? match[1].replace(",", ".")
    : null;
}

function toLabelChange(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  percentage: string,
): TextChange | null {
  for (const rowNumber of sheet.summaryRowNumbers) {
    let label: ExcelJS.Cell | null = null;

    worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
      label ??= FUEL_PERCENTAGE.test(toCellText(cell.value)) ? cell : null;
    });

    if (label !== null) {
      return toTextChange(label, percentage);
    }
  }

  return null;
}

/** The same text with only its percentage replaced. */
function toTextChange(cell: ExcelJS.Cell, percentage: string): TextChange {
  const before = typeof cell.value === "string" ? cell.value : toCellText(cell.value);

  return {
    address: cell.address,
    before,
    after: before.replace(/(\d+(?:[.,]\d+)?)(\s*%)/, `${percentage}$2`),
  };
}
