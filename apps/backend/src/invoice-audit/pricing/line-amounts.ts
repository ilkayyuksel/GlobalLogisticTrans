import { Prisma } from "@prisma/client";

import type { InvoiceColumn } from "../workbook/invoice-columns";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import type { InvoiceComponent } from "./invoice-column-map";

/** What the other columns of a split component already state on this row. */
export function othersInRow(row: InvoiceSheetRow, component: InvoiceComponent): Prisma.Decimal {
  return component.columns
    .filter((column) => column !== component.correctionColumn)
    .reduce((total, column) => total.plus(row.amounts[column]?.value ?? 0), new Prisma.Decimal(0));
}

/** What the line states for a component, over every row and column of it. */
export function sumOf(
  rows: readonly InvoiceSheetRow[],
  columns: readonly InvoiceColumn[],
): Prisma.Decimal | null {
  let total: Prisma.Decimal | null = null;

  for (const row of rows) {
    for (const column of columns) {
      const value = row.amounts[column]?.value;

      if (value !== null && value !== undefined) {
        total = (total ?? new Prisma.Decimal(0)).plus(value);
      }
    }
  }

  return total;
}

export function statesAny(row: InvoiceSheetRow, columns: readonly InvoiceColumn[]): boolean {
  return columns.some((column) => {
    const value = row.amounts[column]?.value;

    return value !== null && value !== undefined;
  });
}
