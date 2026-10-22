import ExcelJS from "exceljs";

import {
  inRed,
  isYellowFill,
  sameStyle,
  sameValue,
  stateOf,
  type CellState,
} from "./cell-comparison";
import type { ChangePlan, PlannedCell } from "./change-plan";
import { MONEY_DECIMAL_PLACES } from "./invoice-amounts";
import { toPlanningDate } from "./invoice-sheet";
import { shiftReferences } from "./invoice-row-inserter";
import { checkAddedRows, checkSheetsAndMarkers } from "./workbook-shape-check";
import { withBlankZero } from "./totals-refresher";

/** Enough to say what went wrong; a broken writer would otherwise list thousands. */
const MAX_REPORTED = 50;

/**
 * Every difference between the document as received and as written that the
 * change plan does not account for — empty when the written file is exactly
 * the received one plus the plan.
 *
 * ── CELL BY CELL, ACROSS THE MOVE ───────────────────────────────────────────
 * A row of the written sheet is compared with the row it came from: the same
 * row above the opening, `count` rows higher below it, and nothing for an added
 * line (those are checked against the plan's added rows). Every formula is
 * expected as Excel rewrites it for inserted rows (`shiftReferences`).
 *
 *   planned cell     the planned content; red where planned, otherwise the
 *                    customer's font; every other style kept
 *   totals, summary  the same formula; its cached result may follow the
 *                    correction (checked on its own), its zero format may be
 *                    blanked (`withBlankZero`)
 *   every other      unchanged — value, formula and style — except the fill
 *                    of a row planned yellow
 *
 * Row heights and visibility, column widths and visibility, merged ranges and
 * the other worksheets are compared too.
 */
export function findUnplannedChanges(
  original: ExcelJS.Workbook,
  written: ExcelJS.Workbook,
  sheetName: string,
  plan: ChangePlan,
): string[] {
  const before = original.getWorksheet(sheetName);
  const after = written.getWorksheet(sheetName);

  if (!before || !after) {
    return [`Het werkblad "${sheetName}" ontbreekt.`];
  }

  const problems = [
    ...compareCells(before, after, plan),
    ...compareRowsAndColumns(before, after, plan),
    ...checkAddedRows(after, plan),
    ...checkSheetsAndMarkers(original, written, sheetName, plan),
  ];

  return problems.length > MAX_REPORTED
    ? [...problems.slice(0, MAX_REPORTED), `… en nog ${problems.length - MAX_REPORTED} andere.`]
    : problems;
}

/** The written row a received row is now on — and back. */
export function rowMapping(plan: ChangePlan) {
  const { opening } = plan;

  return {
    isAdded: (row: number) =>
      opening !== null && row >= opening.fromRow && row < opening.fromRow + opening.count,
    toOriginal: (row: number) =>
      opening !== null && row >= opening.fromRow + opening.count ? row - opening.count : row,
    formula: (formula: string | null) =>
      formula === null || opening === null
        ? formula
        : shiftReferences(formula, opening.fromRow, opening.count),
  };
}

function compareCells(before: ExcelJS.Worksheet, after: ExcelJS.Worksheet, plan: ChangePlan): string[] {
  const map = rowMapping(plan);
  const lastRow = Math.max(after.rowCount, before.rowCount + (plan.opening?.count ?? 0));
  const lastColumn = Math.max(after.columnCount, before.columnCount, plan.lastColumnNumber);
  const problems: string[] = [];

  for (let row = 1; row <= lastRow; row += 1) {
    if (map.isAdded(row)) {
      continue;
    }

    for (let column = 1; column <= lastColumn; column += 1) {
      const is = after.getRow(row).getCell(column);
      const was = stateOf(before.getRow(map.toOriginal(row)).getCell(column));
      const problem = compareCell(was, stateOf(is), is.address, row, plan, map.formula(was.formula));

      if (problem !== null) {
        problems.push(problem);
      }
    }
  }

  return problems;
}

function compareCell(
  was: CellState,
  is: CellState,
  address: string,
  row: number,
  plan: ChangePlan,
  expectedFormula: string | null,
): string | null {
  const planned = plan.cells.get(address);
  const yellow = plan.yellowRows.has(row);

  if (yellow ? !isYellowFill(is.style.fill) : !sameStyle(is.style.fill, was.style.fill)) {
    return `${address}: ${yellow ? "niet geel gemarkeerd zoals gepland" : "opvulkleur gewijzigd zonder plan"}.`;
  }

  if (planned) {
    return comparePlanned(planned, was, is, address);
  }

  if (plan.totalsRows.has(row)) {
    const numFmtKept = is.style.numFmt === was.style.numFmt || is.style.numFmt === withBlankZero(was.style.numFmt as string);

    if (is.formula !== expectedFormula || (is.formula === null && !sameValue(is.value, was.value))) {
      return `${address}: formule of waarde van een totaalcel gewijzigd.`;
    }

    return numFmtKept && sameOtherStyle(was, is, ["fill", "numFmt"]) ? null : `${address}: opmaak van een totaalcel gewijzigd.`;
  }

  if (is.formula !== expectedFormula) {
    return `${address}: formule gewijzigd zonder plan.`;
  }

  if (!sameValue(is.value, was.value)) {
    return `${address}: waarde gewijzigd zonder plan.`;
  }

  return sameOtherStyle(was, is, ["fill"]) ? null : `${address}: opmaak gewijzigd zonder plan.`;
}

function comparePlanned(planned: PlannedCell, was: CellState, is: CellState, address: string): string | null {
  const { content } = planned;
  const contentHolds =
    content.kind === "TEXT"
      ? is.formula === null && is.value === content.text
      : content.kind === "DATE"
        ? is.formula === null && toPlanningDate(is.value) === content.date
        : content.write.kind === "FORMULA"
        ? is.formula === content.write.formula && sameValue(is.value, content.write.result.toNumber() || 0)
        : is.formula === null &&
          sameValue(
            is.value,
            content.write.value === null ? null : Number(content.write.value.toFixed(MONEY_DECIMAL_PLACES)),
          );

  if (!contentHolds) {
    return `${address}: bevat niet wat gepland was (${planned.reason}).`;
  }

  const font = planned.red ? inRed(was.style.font) : was.style.font;


  return sameStyle(is.style.font, font) && sameOtherStyle(was, is, ["fill", "font"])
    ? null
    : `${address}: opmaak wijkt af van het plan (${planned.reason}).`;
}

/** Every compared style property except the ones named. */
function sameOtherStyle(was: CellState, is: CellState, except: readonly string[]): boolean {
  const rest = (state: CellState) =>
    Object.fromEntries(Object.entries(state.style).filter(([key]) => !except.includes(key)));

  return sameStyle(rest(is), rest(was));
}

function compareRowsAndColumns(
  before: ExcelJS.Worksheet,
  after: ExcelJS.Worksheet,
  plan: ChangePlan,
): string[] {
  const map = rowMapping(plan);
  const problems: string[] = [];

  for (let row = 1; row <= after.rowCount; row += 1) {
    const is = after.getRow(row);
    const was = before.getRow(map.toOriginal(row));

    if (!map.isAdded(row) && (is.height !== was.height || Boolean(is.hidden) !== Boolean(was.hidden))) {
      problems.push(`Rij ${row}: hoogte of zichtbaarheid gewijzigd.`);
    }
  }

  for (let column = 1; column <= Math.max(before.columnCount, after.columnCount); column += 1) {
    const is = after.getColumn(column);
    const was = before.getColumn(column);

    // A hidden column's width is not shown; ExcelJS writes a hidden width of 0 as its default.
    const widthShown = !was.hidden && !is.hidden;

    if (Boolean(is.hidden) !== Boolean(was.hidden) || (widthShown && is.width !== was.width)) {
      problems.push(`Kolom ${is.letter}: breedte of zichtbaarheid gewijzigd.`);
    }
  }

  const merges = (sheet: ExcelJS.Worksheet) =>
    [...((sheet.model as { merges?: string[] }).merges ?? [])].sort();
  // A merged range moves only when it reaches the opening — as `openRowsAt` moves it.
  const expected = merges(before)
    .map((range) => (lastRowOf(range) < (plan.opening?.fromRow ?? Infinity) ? range : map.formula(range)!))
    .sort();

  if (!sameValue(merges(after), expected)) {
    problems.push("Samengevoegde cellen gewijzigd.");
  }

  return problems;
}

/** The last row a range covers: `M100:T101` → 101. */
function lastRowOf(range: string): number {
  return Math.max(...[...range.matchAll(/(\d+)/g)].map((match) => Number(match[1])));
}
