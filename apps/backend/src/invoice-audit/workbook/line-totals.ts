import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";

import { toAmountCell } from "./invoice-amounts";
import type { InvoiceColumn } from "./invoice-columns";
import type { InvoiceSheet } from "./invoice-sheet";
import { AMOUNT_COLUMNS } from "./invoice-sheet.reader";

/** What one amount column of the given lines adds up to. */
export interface ColumnTotal {
  readonly column: InvoiceColumn;
  readonly total: Prisma.Decimal;
}

/**
 * The amount columns of the given lines, added up as the document shows them.
 *
 * Read off the cells — a formula counts with the result it shows — so the same
 * function answers for the document as received and for the document as this
 * check wrote it. The preview reports both; the difference is the correction.
 * It is the sum of the LINES, which is what a sound totals row states; a
 * document whose totals deviate says so separately (`totals-structure.ts`).
 */
export function sumAmountColumns(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  rowNumbers: readonly number[],
): ColumnTotal[] {
  return AMOUNT_COLUMNS.flatMap((column) => {
    const position = sheet.columns[column];

    if (position === undefined) {
      return [];
    }

    const total = rowNumbers.reduce(
      (sum, rowNumber) =>
        sum.plus(toAmountCell(worksheet.getRow(rowNumber).getCell(position).value).value ?? 0),
      new Prisma.Decimal(0),
    );

    return [{ column, total }];
  });
}
