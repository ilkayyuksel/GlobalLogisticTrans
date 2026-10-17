import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import {
  DifferenceKind,
  InvoicePricingStatus,
  type CellWrite,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import { markTextRed } from "./cell-marking";
import { MONEY_DECIMAL_PLACES } from "./invoice-amounts";
import type { InvoiceColumnPositions } from "./invoice-columns";
import type { InvoiceSheet } from "./invoice-sheet";

/**
 * Writes the amounts the pricing check planned — exactly its `write`, nothing
 * else — and turns a changed amount red.
 *
 * Red marks a VALUE that changed: a raised amount, a removed Backload. A Fuel
 * cell rewritten only to keep the amount it already shows (`KEEP_AMOUNT`) is not
 * red: the customer's figure did not change.
 */

/**
 * A cell whose formula other cells borrow — Excel's own way of writing a column
 * of identical formulas once.
 *
 * ── AND THE TRAP IN IT ──────────────────────────────────────────────────────
 * A borrower stores no formula of its own, only the master's address. Writing
 * into the MASTER therefore leaves every borrower pointing at a cell that no
 * longer holds a formula, and ExcelJS refuses to write the workbook ("Shared
 * Formula master must exist above and or left of clone"). The customer's real
 * invoices are full of these — 11 masters and 94 borrowers in one week.
 *
 * The remedy is to hand each borrower its own copy of the formula BEFORE the
 * master is written to. ExcelJS translates it per cell (`13%*L2` becomes
 * `13%*L3`), so the copy calculates exactly what the borrowed one did.
 */
interface SharedFormulaCell {
  readonly formula?: string;
  readonly sharedFormula?: string;
  readonly shareType?: string;
  readonly result?: unknown;
}

/**
 * Rows whose planned writes are carried out.
 *
 * Every compared row that is not a problem: a corrected one, and also one whose
 * amounts did not go up but whose Fuel cell must be rewritten to KEEP its
 * amount. A line that is a problem in any way writes nothing.
 */
const WRITABLE_STATUSES: readonly InvoicePricingStatus[] = [
  InvoicePricingStatus.MATCHED_NO_CHANGES,
  InvoicePricingStatus.PRICING_CORRECTED,
  InvoicePricingStatus.INVOICE_HIGHER,
];

/** The changes that are shown in red. */
const VISIBLE_CHANGES: readonly DifferenceKind[] = [DifferenceKind.RAISE, DifferenceKind.REMOVE];

export function isWritable(outcome: InvoiceRowPricing): boolean {
  return WRITABLE_STATUSES.includes(outcome.status);
}

/** Whether a written difference is shown in red. */
export function isShownRed(kind: DifferenceKind): boolean {
  return VISIBLE_CHANGES.includes(kind);
}

/** Writes one row's planned amounts, and answers how many cells it wrote. */
export function writeRowAmounts(
  worksheet: ExcelJS.Worksheet,
  columns: InvoiceColumnPositions,
  outcome: InvoiceRowPricing,
): number {
  let written = 0;

  for (const difference of outcome.differences) {
    const position = difference.column ? columns[difference.column] : undefined;

    // Reported, never written: a figure the invoice states higher than ours,
    // or a difference nothing may carry. Only a planned write reaches a cell.
    if (difference.write === null || difference.correctionRowNumber === null || position === undefined) {
      continue;
    }

    const cell = worksheet.getRow(difference.correctionRowNumber).getCell(position);

    cell.value = toCellValue(difference.write);

    if (isShownRed(difference.kind)) {
      markTextRed(cell);
    }

    written += 1;
  }

  return written;
}

/**
 * Gives every borrower of a formula about to be overwritten its own copy of it.
 *
 * Only the masters actually being written to — a column of shared formulas
 * this check does not touch keeps its own shape. Answers how many masters were
 * involved and how many borrowers were released.
 */
export function releaseBorrowedFormulas(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
): { masters: number; released: number } {
  const masters = new Set<string>();

  for (const row of sheet.rows) {
    const outcome = pricing.get(row.rowNumber);

    if (!outcome || !isWritable(outcome)) {
      continue;
    }

    for (const difference of outcome.differences) {
      const position = difference.column ? sheet.columns[difference.column] : undefined;

      if (difference.write === null || difference.correctionRowNumber === null || position === undefined) {
        continue;
      }

      const cell = worksheet.getRow(difference.correctionRowNumber).getCell(position);

      if ((cell.value as SharedFormulaCell | null)?.shareType === "shared") {
        masters.add(cell.address);
      }
    }
  }

  if (masters.size === 0) {
    return { masters: 0, released: 0 };
  }

  let released = 0;

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value as SharedFormulaCell | null;

      if (!value?.sharedFormula || !masters.has(value.sharedFormula)) {
        return;
      }

      // `cell.formula` is the master's formula translated to THIS cell, so the
      // copy calculates what the borrowed one did.
      cell.value = { formula: cell.formula, result: value.result } as ExcelJS.CellFormulaValue;
      released += 1;
    });
  });

  return { masters: masters.size, released };
}

/** A planned write as the cell holds it: a figure, nothing, or a formula. */
function toCellValue(write: CellWrite): ExcelJS.CellValue {
  if (write.kind === "FORMULA") {
    // What a formula calculated, as Excel stores it: not rounded to the cent.
    return { formula: write.formula, result: write.result.toNumber() };
  }

  return write.value === null ? null : toMoney(write.value);
}

/** Money as a cell holds it: a number at the money precision, never a string. */
function toMoney(amount: Prisma.Decimal): number {
  return Number(amount.toFixed(MONEY_DECIMAL_PLACES));
}
