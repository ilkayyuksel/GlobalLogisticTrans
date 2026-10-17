import ExcelJS from "exceljs";

import { toColumnLetter, toHeaderText, type InvoiceColumn } from "./invoice-columns";
import type { InvoiceSheet } from "./invoice-sheet";
import { toCellText } from "./invoice-sheet";
import { AMOUNT_COLUMNS } from "./invoice-sheet.reader";

/**
 * Whether the document's totals can take added lines without a wrong total.
 *
 * ── WHAT EVERY REAL WEEK LOOKS LIKE ─────────────────────────────────────────
 * Week 41, as received: each component's total is `SUM(L2:L127)` from the
 * first line to the row directly above the totals row (128); `U128` adds the
 * component totals up (`SUM(L128:T128)`); the summary below (`L130`–`L139`)
 * points at the totals row; its Fuel label says the header's percentage.
 *
 * Added lines open room directly above the totals row, and only a range that
 * ends directly above it grows over them. A total that ends anywhere else —
 * week 36 as corrected by hand reads `SUM(N2:N138)` beside `SUM(L2:L141)` —
 * would silently leave an added line out. So the structure is checked FIRST,
 * and a document that deviates gets no added line and no new Fuel header: the
 * deviations are reported, nothing is overwritten to "fix" them.
 */
export interface TotalsStructure {
  readonly sound: boolean;
  readonly problems: readonly string[];
}

/** `SUM(L2:L127)` — one range down one column. */
const COLUMN_SUM = /^\s*SUM\(\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)\s*\)\s*$/i;

/** `L128` — the single reference a summary cell reads a total with. */
const SINGLE_REFERENCE = /^\s*\$?([A-Z]+)\$?(\d+)\s*$/i;

/** The percentage a Fuel header or label states: `Fuel 24%`, `Fuel 23% `. */
export const FUEL_PERCENTAGE = /^\s*fuel\s+(\d+(?:[.,]\d+)?)\s*%/i;

export function checkTotalsStructure(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
): TotalsStructure {
  // No totals row: added lines go below the last line, and nothing can miss them.
  if (sheet.totalsRowNumber === null || sheet.rows.length === 0) {
    return { sound: true, problems: [] };
  }

  const problems = [
    ...componentTotalProblems(worksheet, sheet, sheet.totalsRowNumber),
    ...grandTotalProblems(worksheet, sheet, sheet.totalsRowNumber),
    ...summaryProblems(worksheet, sheet, sheet.totalsRowNumber),
  ];

  return { sound: problems.length === 0, problems };
}

/** Each component total: one SUM, its own column, first line to the row above. */
function componentTotalProblems(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  totalsRow: number,
): string[] {
  const firstLine = Math.min(...sheet.rows.map((row) => row.rowNumber));
  const lastLine = totalsRow - 1;

  return presentAmountColumns(sheet).flatMap((column): string[] => {
    const letter = toColumnLetter(sheet.columns[column]!);
    const formula = formulaOf(worksheet.getCell(`${letter}${totalsRow}`));
    const sum = formula === null ? null : COLUMN_SUM.exec(formula);
    const name = toHeaderText(column);

    if (sum === null) {
      return [`${name}: de totaalrij bevat geen SOM over de eigen kolom (${formula ?? "leeg"}).`];
    }

    const [, fromLetter, from, toLetter, to] = sum;

    if (fromLetter.toUpperCase() !== letter || toLetter.toUpperCase() !== letter) {
      return [`${name}: het totaal telt een andere kolom op (${formula}).`];
    }

    return Number(from) <= firstLine && Number(to) === lastLine
      ? []
      : [`${name}: het totaal telt de rijen ${from}–${to} op in plaats van ${firstLine}–${lastLine} (${formula}).`];
  });
}

/** One cell of the totals row adds up exactly the component totals. */
function grandTotalProblems(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  totalsRow: number,
): string[] {
  const letters = presentAmountColumns(sheet).map((column) => sheet.columns[column]!);
  const expected = `SUM(${toColumnLetter(Math.min(...letters))}${totalsRow}:${toColumnLetter(Math.max(...letters))}${totalsRow})`;
  let found = false;

  worksheet.getRow(totalsRow).eachCell({ includeEmpty: false }, (cell) => {
    found = found || formulaOf(cell)?.replace(/\s|\$/g, "").toUpperCase() === expected;
  });

  return found ? [] : [`De totaalrij bevat geen eindtotaal ${expected}.`];
}

/** The summary reads the totals row, and its Fuel label says the header's percentage. */
function summaryProblems(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  totalsRow: number,
): string[] {
  const problems: string[] = [];
  const headerPercentage = fuelPercentageOf(fuelHeaderCell(worksheet, sheet));

  for (const rowNumber of sheet.summaryRowNumbers) {
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
      const reference = SINGLE_REFERENCE.exec(formulaOf(cell) ?? "");

      if (reference !== null && Number(reference[2]) !== totalsRow) {
        problems.push(`Samenvatting ${cell.address} leest rij ${reference[2]} in plaats van de totaalrij ${totalsRow}.`);
      }

      const labelPercentage = fuelPercentageOf(cell);

      if (labelPercentage !== null && headerPercentage !== null && labelPercentage !== headerPercentage) {
        problems.push(
          `Het label "${toCellText(cell.value)}" in de samenvatting vermeldt niet de ${headerPercentage}% van de kop.`,
        );
      }
    });
  }

  return problems;
}

/** The Fuel header's cell. */
export function fuelHeaderCell(worksheet: ExcelJS.Worksheet, sheet: InvoiceSheet): ExcelJS.Cell | null {
  const fuel = sheet.columns.fuel;

  return fuel === undefined ? null : worksheet.getRow(sheet.headerRowNumber).getCell(fuel);
}

/** The percentage a Fuel header or label states, as written (`24`, `23,5`). */
export function fuelPercentageOf(cell: ExcelJS.Cell | null): string | null {
  return cell === null ? null : (FUEL_PERCENTAGE.exec(toCellText(cell.value))?.[1]?.replace(",", ".") ?? null);
}

function presentAmountColumns(sheet: InvoiceSheet): InvoiceColumn[] {
  return AMOUNT_COLUMNS.filter((column) => sheet.columns[column] !== undefined);
}

/** A cell's formula — its own, or the one it borrows, translated to it. */
function formulaOf(cell: ExcelJS.Cell): string | null {
  const value = cell.value;

  if (value === null || typeof value !== "object") {
    return null;
  }

  return "formula" in value || "sharedFormula" in value ? (cell.formula ?? null) : null;
}
