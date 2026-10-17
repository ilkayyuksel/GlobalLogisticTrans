import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";

import { round, toAmountCell } from "./invoice-amounts";
import { toColumnLetter } from "./invoice-columns";
import type { InvoiceSheet } from "./invoice-sheet";
import { AMOUNT_COLUMNS } from "./invoice-sheet.reader";


/**
 * Whether the totals row SHOWS what its lines add up to — each component total
 * the sum of its column from the first line to the row above, and the grand
 * total the sum of the component totals.
 *
 * Recomputed here from the cells, independently of the refresher that wrote
 * those results, so a total that kept a stale figure is caught before the file
 * reaches anybody. Only for a document whose structure is sound
 * (`totals-structure.ts`); the formulas themselves are checked there.
 */
export function checkTotalsResults(worksheet: ExcelJS.Worksheet, sheet: InvoiceSheet): string[] {
  const totalsRow = sheet.totalsRowNumber;

  if (totalsRow === null || sheet.rows.length === 0) {
    return [];
  }

  const firstLine = Math.min(...sheet.rows.map((row) => row.rowNumber));
  const problems: string[] = [];
  let grandTotal = new Prisma.Decimal(0);

  for (const column of AMOUNT_COLUMNS) {
    const position = sheet.columns[column];

    if (position === undefined) {
      continue;
    }

    let lines = new Prisma.Decimal(0);

    for (let row = firstLine; row < totalsRow; row += 1) {
      lines = lines.plus(shownAmount(worksheet.getRow(row).getCell(position)));
    }

    const total = shownAmount(worksheet.getRow(totalsRow).getCell(position));

    grandTotal = grandTotal.plus(total);

    // Totals are stored at the cent, as the customer's money format shows them.
    if (!round(total).equals(round(lines))) {
      // The address only: what a transport costs stays out of logs and errors.
      problems.push(`${toColumnLetter(position)}${totalsRow}: does not show what its lines add up to`);
    }
  }

  return [...problems, ...grandTotalProblems(worksheet, totalsRow, grandTotal)];
}

/** The cell of the totals row that adds the component totals up, checked against them. */
function grandTotalProblems(
  worksheet: ExcelJS.Worksheet,
  totalsRow: number,
  componentTotals: Prisma.Decimal,
): string[] {
  const problems: string[] = [];

  worksheet.getRow(totalsRow).eachCell({ includeEmpty: false }, (cell) => {
    const formula = cell.formula?.replace(/\s|\$/g, "").toUpperCase() ?? "";

    if (
      new RegExp(`^SUM\\([A-Z]+${totalsRow}:[A-Z]+${totalsRow}\\)$`).test(formula) &&
      !round(shownAmount(cell)).equals(round(componentTotals))
    ) {
      problems.push(`${cell.address}: the grand total does not show the component totals`);
    }
  });

  return problems;
}

/** What a cell shows as an amount; a formula whose result is 0 stores none. */
function shownAmount(cell: ExcelJS.Cell): Prisma.Decimal {
  return toAmountCell(cell.value).value ?? new Prisma.Decimal(0);
}
