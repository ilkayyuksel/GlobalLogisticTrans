import ExcelJS from "exceljs";

/**
 * Opens empty rows inside a worksheet, without `spliceRows`.
 *
 * ── WHY NOT `spliceRows` ────────────────────────────────────────────────────
 * The customer's workbooks write a column of identical formulas ONCE, as a
 * shared formula, and ExcelJS cannot move rows through one: `spliceRows` throws
 * "Shared Formula master must exist above and or left of clone", and where it
 * does not throw it leaves formulas pointing at the rows they used to point at.
 * The real `week 13` invoice has eleven such groups.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
 * Everything from `fromRow` down is copied `count` rows lower, bottom row first,
 * cell by cell: value, style, row height and visibility. Every formula in the
 * sheet is then rewritten the way Excel rewrites it when rows are inserted:
 *
 *   * a reference at or below `fromRow` moves down by `count`;
 *   * a range ending on the row directly ABOVE `fromRow` grows by `count`, so
 *     `SUM(L2:L99)` above a totals row on 100 becomes `SUM(L2:L101)` once two
 *     rows open at 100 — the opened rows are part of the data above them;
 *   * everything else is left exactly as it was.
 *
 * A shared-formula group touching the moved rows is first given back as
 * ordinary formulas, cell by cell, each translated to its own cell — the same
 * arithmetic, no longer borrowed from a master that is about to move.
 *
 * The opened rows are left empty and unstyled, for the caller to fill.
 */
export function openRowsAt(
  worksheet: ExcelJS.Worksheet,
  fromRow: number,
  count: number,
): void {
  if (count <= 0) {
    return;
  }

  releaseSharedFormulasFrom(worksheet, fromRow);

  const lastRow = worksheet.rowCount;

  for (let rowNumber = lastRow; rowNumber >= fromRow; rowNumber -= 1) {
    moveRow(worksheet, rowNumber, rowNumber + count, fromRow, count);
  }

  for (let rowNumber = fromRow; rowNumber < fromRow + count; rowNumber += 1) {
    clearRow(worksheet.getRow(rowNumber));
  }

  // Formulas ABOVE the opened rows may point below them — a line referring to
  // the totals, say. They are not moved, but what they point at was.
  for (let rowNumber = 1; rowNumber < fromRow; rowNumber += 1) {
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
      const formula = ownFormula(cell.value);

      if (formula !== null) {
        cell.value = {
          ...(cell.value as ExcelJS.CellFormulaValue),
          formula: shiftReferences(formula, fromRow, count),
        };
      }
    });
  }

  moveMerges(worksheet, fromRow, count);
}

/**
 * A formula, rewritten for `count` rows opened at `fromRow`.
 *
 * Text inside quotes is never touched, and neither is a reference to another
 * sheet: those are the two places a cell address is not one of this sheet's.
 */
export function shiftReferences(
  formula: string,
  fromRow: number,
  count: number,
): string {
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, index) =>
      // Odd parts are the quoted strings the split kept.
      index % 2 === 1 ? part : shiftUnquoted(part, fromRow, count),
    )
    .join("");
}

/** `$L$2:$L99`, `L100`, `$U100` — a cell or a range of cells on this sheet. */
const REFERENCE =
  /(?<![A-Za-z0-9_.!$])(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![A-Za-z0-9_(!])/g;

function shiftUnquoted(text: string, fromRow: number, count: number): string {
  return text.replace(
    REFERENCE,
    (_whole, startColumn: string, start: string, endColumn?: string, end?: string) => {
      const startRow = Number(start);
      const movedStart = startRow >= fromRow ? startRow + count : startRow;

      if (endColumn === undefined || end === undefined) {
        return `${startColumn}${movedStart}`;
      }

      const endRow = Number(end);
      const movedEnd =
        endRow >= fromRow || (endRow === fromRow - 1 && startRow <= endRow)
          ? endRow + count
          : endRow;

      return `${startColumn}${movedStart}:${endColumn}${movedEnd}`;
    },
  );
}

/** A shared-formula master: `{ formula, shareType: "shared", ref }`. */
interface SharedFormulaValue {
  readonly formula?: string;
  readonly sharedFormula?: string;
  readonly shareType?: string;
  readonly ref?: string;
  readonly result?: unknown;
}

/**
 * Turns every shared-formula group that reaches `fromRow` or below into
 * ordinary formulas.
 *
 * Each borrower gets `cell.formula` — the master's formula translated to that
 * cell by ExcelJS — so it calculates exactly what it calculated before. The
 * master keeps its own formula and simply stops being a master.
 */
export function releaseSharedFormulasFrom(
  worksheet: ExcelJS.Worksheet,
  fromRow: number,
): void {
  const reaching = new Set<string>();

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value as SharedFormulaValue | null;

      if (value?.shareType === "shared" && lastRowOf(value.ref ?? cell.address) >= fromRow) {
        reaching.add(cell.address);
      }
    });
  });

  if (reaching.size === 0) {
    return;
  }

  // Borrowers first, while their master still holds the formula they borrow.
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value as SharedFormulaValue | null;

      if (value?.sharedFormula && reaching.has(value.sharedFormula)) {
        cell.value = {
          formula: cell.formula,
          result: value.result,
        } as ExcelJS.CellFormulaValue;
      }
    });
  });

  for (const address of reaching) {
    const cell = worksheet.getCell(address);
    const value = cell.value as SharedFormulaValue;

    cell.value = {
      formula: value.formula ?? cell.formula,
      result: value.result,
    } as ExcelJS.CellFormulaValue;
  }
}

function moveRow(
  worksheet: ExcelJS.Worksheet,
  from: number,
  to: number,
  fromRow: number,
  count: number,
): void {
  const source = worksheet.getRow(from);
  const target = worksheet.getRow(to);

  // The target may still hold a row moved there a moment ago; it is replaced.
  clearRow(target);

  target.height = source.height;
  target.hidden = source.hidden;

  source.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const moved = target.getCell(columnNumber);
    const formula = ownFormula(cell.value);

    // A style object of its own: ExcelJS shares one object between every cell
    // with the same style, so the copy must never be the same object.
    moved.style = { ...cell.style };
    moved.value =
      formula === null
        ? cell.value
        : ({
            ...(cell.value as ExcelJS.CellFormulaValue),
            formula: shiftReferences(formula, fromRow, count),
          } as ExcelJS.CellFormulaValue);
  });
}

function clearRow(row: ExcelJS.Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.value = null;
    cell.style = {};
  });
  row.height = undefined as unknown as number;
  row.hidden = false;
}

/** Merged ranges at or below `fromRow` move with their rows. */
function moveMerges(
  worksheet: ExcelJS.Worksheet,
  fromRow: number,
  count: number,
): void {
  const merges = [...((worksheet.model as { merges?: string[] }).merges ?? [])];

  for (const range of merges) {
    if (lastRowOf(range) < fromRow) {
      continue;
    }

    worksheet.unMergeCells(range);
    worksheet.mergeCells(shiftReferences(range, fromRow, count));
  }
}

/** A plain formula of the cell's own — not a borrowed shared one. */
function ownFormula(value: ExcelJS.CellValue): string | null {
  if (value === null || typeof value !== "object" || !("formula" in value)) {
    return null;
  }

  const formula = (value as { formula?: unknown }).formula;

  return typeof formula === "string" ? formula : null;
}

/** The last row a cell or range address covers: `M100:T100` → 100. */
function lastRowOf(address: string): number {
  const rows = [...address.matchAll(/(\d+)/g)].map((match) => Number(match[1]));

  return Math.max(...rows);
}
