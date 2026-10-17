import { isDeepStrictEqual } from "node:util";

import ExcelJS from "exceljs";

import { CORRECTED_TEXT_ARGB } from "./cell-marking";

/**
 * One cell as the integrity check compares it: what it shows and how it looks.
 *
 * ── ONLY WHAT EXCEL WOULD SHOW DIFFERENTLY ──────────────────────────────────
 * Both workbooks are read fresh from bytes, so anything ExcelJS adds on a round
 * trip is added to both. What remains are three representations that are the
 * same cell to Excel and are normalised here:
 *
 *   * a borrowed shared formula and the same formula written out — compared by
 *     the formula the cell calculates (`cell.formula`);
 *   * a cached result of 0 and none — ExcelJS drops a 0 when it writes;
 *   * an empty border or a fill of pattern `none` and no border or fill;
 *   * a font property left out and the same property of the base font ExcelJS
 *     writes into every file it saves — Excel fills a missing one from it. A
 *     cell without a style of its own that is given one (a yellow fill, red
 *     text) comes back with more or less of that base font spelled out, and
 *     looks exactly the same.
 */
export interface CellState {
  readonly formula: string | null;
  /** A plain value, or the cached result of a formula. */
  readonly value: unknown;
  readonly style: ComparedStyle;
}

export interface ComparedStyle {
  readonly font?: unknown;
  readonly fill?: unknown;
  readonly numFmt?: unknown;
  readonly border?: unknown;
  readonly alignment?: unknown;
  readonly protection?: unknown;
}

/** The base font ExcelJS writes as the first font of every workbook. */
const EXCELJS_BASE_FONT = { color: { theme: 1 }, family: 2, scheme: "minor", size: 11, name: "Calibri" };

export function stateOf(cell: ExcelJS.Cell): CellState {
  const value = cell.value;
  const isFormula =
    value !== null && typeof value === "object" && ("formula" in value || "sharedFormula" in value);

  return {
    formula: isFormula ? (cell.formula ?? null) : null,
    value: isFormula ? normalisedResult((value as { result?: unknown }).result) : normalisedValue(value),
    style: comparedStyle(cell.style ?? {}) ?? {},
  };
}

/**
 * The font a cell turned red has: the customer's own, in red — or, for a cell
 * that had none of its own, the base font in red.
 */
export function inRed(font: unknown): unknown {
  return comparedFont({ ...(font as object | undefined), color: { argb: CORRECTED_TEXT_ARGB } });
}

/** Whether a fill is the solid yellow of a line marked for review. */
export function isYellowFill(fill: unknown): boolean {
  const pattern = fill as ExcelJS.FillPattern | undefined;

  return pattern?.pattern === "solid" && pattern.fgColor?.argb === "FFFFFF00";
}

export function sameValue(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    // Money is written at the cent and formulas' results unrounded; a binary
    // round trip may move the last bit and nothing more.
    return Math.abs(left - right) < 1e-9;
  }

  return isDeepStrictEqual(left, right);
}

export function sameStyle(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function comparedStyle(style: Partial<ExcelJS.Style>): ComparedStyle | undefined {
  const fill = style.fill as ExcelJS.FillPattern | undefined;

  return withoutEmpty({
    font: comparedFont(style.font),
    fill: fill?.type === "pattern" && fill.pattern === "none" ? undefined : withoutEmpty(fill),
    numFmt: style.numFmt,
    border: withoutEmpty(style.border),
    alignment: withoutEmpty(style.alignment),
    protection: withoutEmpty(style.protection),
  }) as ComparedStyle | undefined;
}

/** A font with every property it leaves out taken from the base font; none when it is the base font. */
function comparedFont(font: unknown): unknown {
  const complete = { ...EXCELJS_BASE_FONT, ...(withoutEmpty(font) as object | undefined) };

  return isDeepStrictEqual(complete, EXCELJS_BASE_FONT) ? undefined : complete;
}

function normalisedResult(result: unknown): unknown {
  return result === undefined || result === null ? 0 : result;
}

function normalisedValue(value: ExcelJS.CellValue): unknown {
  return value === undefined || value === "" ? null : value;
}

/** An object with its undefined keys dropped; undefined when nothing is left. */
function withoutEmpty<T>(value: T): T | undefined {
  if (value === null || value === undefined || typeof value !== "object") {
    return value ?? undefined;
  }

  const entries = Object.entries(value as object).filter(([, entry]) => entry !== undefined);

  return entries.length === 0 ? undefined : (Object.fromEntries(entries) as T);
}
