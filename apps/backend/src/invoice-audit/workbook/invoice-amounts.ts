import { Prisma } from "@prisma/client";

import { toCellText } from "./invoice-sheet";

/**
 * What an amount cell of the invoice states.
 *
 * ── A CELL SAYS ONE OF THREE THINGS ─────────────────────────────────────────
 * A figure, nothing at all, or a formula that produces a figure. The three are
 * different facts and the check treats them as such: an empty Tunnel cell and a
 * Tunnel of 0,00 both mean no toll is charged, but an empty Tarief and a Tarief
 * of 0,00 are the customer saying two different things.
 */
export interface InvoiceAmountCell {
  /** What the cell shows, or null when it shows nothing. */
  readonly value: Prisma.Decimal | null;
  /** The formula behind it, when there is one. Kept, never rewritten blindly. */
  readonly formula: string | null;
}

export const EMPTY_AMOUNT: InvoiceAmountCell = { value: null, formula: null };

/** Money, as this system compares and writes it. */
export const MONEY_DECIMAL_PLACES = 2;

/**
 * An amount cell, read.
 *
 * Numbers arrive as numbers; a sheet a human typed into may hold `135,00` as
 * text, and a European decimal comma is the ordinary spelling in these
 * documents. Anything that is not a number at all — a word, a dash — reads as
 * nothing stated, because guessing at it would invent a figure.
 */
export function toAmountCell(value: unknown): InvoiceAmountCell {
  if (value === null || value === undefined) {
    return EMPTY_AMOUNT;
  }

  if (typeof value === "number") {
    return { value: toDecimal(value), formula: null };
  }

  if (typeof value === "object" && "formula" in value) {
    const cell = value as { formula: string; result?: unknown };

    return {
      // What the formula last CALCULATED is what the sheet shows. A formula a
      // writer never calculated shows nothing yet, which is not the same as a
      // cell holding zero.
      value: cell.result === undefined ? null : toAmount(cell.result),
      formula: cell.formula,
    };
  }

  return { value: toAmount(value), formula: null };
}

function toAmount(value: unknown): Prisma.Decimal | null {
  if (typeof value === "number") {
    return toDecimal(value);
  }

  const text = toCellText(value);

  if (text === "") {
    return null;
  }

  // The European decimal comma, and nothing else: a thousands separator would
  // make `1.234` ambiguous, so a value that is not a plain number is left unread.
  const normalised = text.replace(",", ".");

  if (!/^-?\d+(\.\d+)?$/.test(normalised)) {
    return null;
  }

  return toDecimal(normalised);
}

function toDecimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/**
 * Whether two amounts agree, with an absent amount treated as absent.
 *
 * ── EMPTY IS NOT ZERO, EXCEPT WHEN IT IS ────────────────────────────────────
 * An empty cell beside a figure of 0,00 is agreement: the customer charged
 * nothing and this system charges nothing, and correcting one into the other
 * would be a change that means nothing. An empty cell beside 18,18 is not.
 *
 * Compared as Decimal at the money precision, never as JavaScript numbers:
 * 0.1 + 0.2 is not 0.3 in binary floating point, and a cent of drift in a
 * comparison would report corrections nobody needs.
 */
export function isSameAmount(
  invoice: Prisma.Decimal | null,
  expected: Prisma.Decimal,
): boolean {
  const stated = invoice ?? new Prisma.Decimal(0);

  return round(stated).equals(round(expected));
}

/** The money precision this system states every amount at. */
export function round(amount: Prisma.Decimal): Prisma.Decimal {
  return amount.toDecimalPlaces(MONEY_DECIMAL_PLACES);
}

/**
 * What a formula will produce once the Tarief cell holds `tarief`.
 *
 * ── DELIBERATELY ONE SHAPE ONLY ─────────────────────────────────────────────
 * The Fuel column of these invoices is written as `10%*L7` — a percentage of
 * the Tarief cell on the same row — and that is the only shape this reads. It
 * exists for one decision: whether correcting the Tarief already puts the right
 * Fuel in the cell, in which case the formula is left exactly as it is.
 *
 * Anything else returns null, which means "cannot say", and a cell we cannot
 * reason about is corrected by writing the amount rather than by rewriting a
 * formula nobody here understands.
 */
const PERCENTAGE_OF_CELL =
  /^\s*(?:(\d+(?:[.,]\d+)?)%\s*\*\s*\$?([A-Z]+)\$?(\d+)|\$?([A-Z]+)\$?(\d+)\s*\*\s*(\d+(?:[.,]\d+)?)%)\s*$/;

export function toFormulaResult(
  formula: string,
  tariefColumnLetter: string,
  rowNumber: number,
  tarief: Prisma.Decimal,
): Prisma.Decimal | null {
  const match = PERCENTAGE_OF_CELL.exec(formula);

  if (!match) {
    return null;
  }

  const percentage = match[1] ?? match[6];
  const column = (match[2] ?? match[4]).toUpperCase();
  const row = Number(match[3] ?? match[5]);

  // Only a percentage of THIS row's Tarief. A formula pointing anywhere else is
  // one this check has no opinion about.
  if (column !== tariefColumnLetter.toUpperCase() || row !== rowNumber) {
    return null;
  }

  return round(
    tarief.mul(new Prisma.Decimal(percentage.replace(",", "."))).div(100),
  );
}
