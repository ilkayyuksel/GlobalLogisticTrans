import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { MONEY_DECIMAL_PLACES, toAmountCell } from "./invoice-amounts";
import { releaseSharedFormulasFrom } from "./invoice-row-inserter";
import type { InvoiceSheet } from "./invoice-sheet";

/** A SUM over one or more ranges: `SUM(L2:L101)`, `SUM(L102:T102)`. */
const SUM_CALL = /^\s*SUM\(([^)]*)\)\s*$/i;
const RANGE = /^\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)\s*$/i;

/** `L131` — the shape the summary block points at the totals row with. */
const CELL_REFERENCE = /^\s*\$?([A-Z]+)\$?(\d+)\s*$/;

/**
 * Brings the cached results of the totals row and the summary block up to
 * date.
 *
 * ── WHY THE CACHE MATTERS AT ALL ────────────────────────────────────────────
 * A workbook stores both the formula and what it last calculated. Correcting a
 * Tarief leaves `=SUM(L2:L130)` correct and its cached figure wrong, and a
 * reader that trusts the cache — anything that is not Excel — would show the
 * old total. The formulas are never replaced by figures: they stay formulas,
 * and only what they last produced is rewritten.
 *
 * Only the two shapes these documents actually use are recomputed: a SUM over
 * a range, and a reference to a single cell. Anything else keeps whatever it
 * had, and `fullCalcOnLoad` is what covers it when the file is opened.
 *
 * ── EVERY TOTALS CELL, NOT ONLY THE MASTER ──────────────────────────────────
 * The customer's totals row writes its SUMs as one shared formula, and a cell
 * that BORROWS a formula holds none of its own — so the totals' group is given
 * back as ordinary formulas first, and each cell is refreshed with the formula
 * it actually calculates.
 *
 * `rowsAdded` is how far the totals and the summary moved when added lines
 * opened space above them; their reported row numbers are from before.
 */
export function refreshTotals(
  worksheet: ExcelJS.Worksheet,
  sheet: InvoiceSheet,
  rowsAdded: number,
): void {
  const rowNumbers = [
    ...(sheet.totalsRowNumber === null ? [] : [sheet.totalsRowNumber]),
    ...sheet.summaryRowNumbers,
  ].map((rowNumber) => rowNumber + rowsAdded);

  if (rowNumbers.length > 0) {
    releaseSharedFormulasFrom(worksheet, Math.min(...rowNumbers));
  }

  /*
   * What each refreshed cell now calculates, by address. ExcelJS does not keep
   * a cached result of exactly 0 — not even in memory — so a summary cell
   * reading a total that came to nothing (`=N128` after every Backload was
   * removed) would otherwise find no figure and keep its stale one. Week 41
   * showed exactly that: a Backloads line of 1300 beside a total without them.
   */
  const refreshed = new Map<string, Prisma.Decimal>();

  for (const rowNumber of rowNumbers) {
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
      const formula = toFormula(cell.value);

      if (formula === null) {
        return;
      }

      const result =
        sumOfRange(worksheet, formula) ?? valueOfReference(worksheet, formula, refreshed);

      if (result === null) {
        return;
      }

      refreshed.set(cell.address, result);
      cell.value = {
        formula,
        result: Number(result.toFixed(MONEY_DECIMAL_PLACES)),
      } as ExcelJS.CellFormulaValue;

      /*
       * A total of nothing prints as nothing. The customer's money format
       * spells zero as `- €`; only that section of the format is emptied, on
       * the totals and summary cells this recalculates, and every other figure
       * keeps its exact format.
       */
      const numFmt = withBlankZero(cell.style.numFmt);

      if (numFmt !== cell.style.numFmt) {
        cell.style = { ...cell.style, numFmt };
      }
    });
  }
}

function sumOfRange(worksheet: ExcelJS.Worksheet, formula: string): Prisma.Decimal | null {
  const inside = SUM_CALL.exec(formula);

  if (inside === null) {
    return null;
  }

  let total = new Prisma.Decimal(0);

  // `SUM(L2:L101)` down a column, or `SUM(L102:T102)` — the grand total —
  // across one; any rectangle of cells, each counted once.
  for (const part of inside[1].split(",")) {
    const range = RANGE.exec(part);

    if (range === null) {
      return null;
    }

    const firstColumn = worksheet.getColumn(range[1]).number;
    const lastColumn = worksheet.getColumn(range[3]).number;

    for (let rowNumber = Number(range[2]); rowNumber <= Number(range[4]); rowNumber += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        total = total.plus(toAmountCell(worksheet.getRow(rowNumber).getCell(column).value).value ?? 0);
      }
    }
  }

  return total;
}

function valueOfReference(
  worksheet: ExcelJS.Worksheet,
  formula: string,
  refreshed: ReadonlyMap<string, Prisma.Decimal>,
): Prisma.Decimal | null {
  const match = CELL_REFERENCE.exec(formula);

  if (!match) {
    return null;
  }

  const cell = worksheet.getRow(Number(match[2])).getCell(worksheet.getColumn(match[1]).number);

  return refreshed.get(cell.address) ?? toAmountCell(cell.value).value;
}

function toFormula(value: unknown): string | null {
  return value !== null && typeof value === "object" && "formula" in value
    ? (value as { formula: string }).formula
    : null;
}

/**
 * A number format whose ZERO section prints nothing.
 *
 * Excel formats have up to four `;`-separated sections — positive, negative,
 * zero, text. The customer's money format puts `"-"` in the third, which is the
 * `- €` an empty total shows. That section is emptied and the other three are
 * kept exactly. A format with fewer sections gets an empty zero section added
 * behind what it has; `General` and an absent format are left alone.
 */
export function withBlankZero(numFmt: string | undefined): string | undefined {
  if (!numFmt || numFmt === "General") {
    return numFmt;
  }

  const sections = splitFormatSections(numFmt);

  if (sections.length === 1) {
    return `${sections[0]};-${sections[0]};`;
  }

  if (sections.length === 2) {
    return `${sections[0]};${sections[1]};`;
  }

  return [sections[0], sections[1], "", ...sections.slice(3)].join(";");
}

/** The `;`-separated sections, ignoring any `;` inside quotes or brackets. */
function splitFormatSections(numFmt: string): string[] {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  let bracketed = false;

  for (const character of numFmt) {
    if (character === '"' && !bracketed) {
      quoted = !quoted;
    } else if (character === "[" && !quoted) {
      bracketed = true;
    } else if (character === "]" && !quoted) {
      bracketed = false;
    }

    if (character === ";" && !quoted && !bracketed) {
      sections.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  sections.push(current);

  return sections;
}
