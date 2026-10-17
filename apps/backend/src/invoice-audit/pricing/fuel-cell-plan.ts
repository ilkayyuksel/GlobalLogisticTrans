import { Prisma } from "@prisma/client";

import {
  round,
  toExactFormulaResult,
  type InvoiceAmountCell,
} from "../workbook/invoice-amounts";

/**
 * What the Fuel cell of one line must hold, and how to write it so it STAYS so.
 *
 * ── THE AMOUNT FIRST ────────────────────────────────────────────────────────
 * The target is the higher of what the invoice shows and what this system
 * holds: an existing Fuel is never lowered, and a higher system Fuel is
 * written (see `raise-only-policy.ts`).
 *
 * ── THEN THE CELL, BECAUSE EXCEL RECALCULATES ───────────────────────────────
 * The customer writes Fuel as a percentage of the row's Tarief (`24%*L5`), and
 * Excel recalculates every formula when the file is opened. A formula can only
 * stay when what it will calculate — with the row's FINAL Tarief — is exactly
 * the target. In order of preference:
 *
 *   1. the cell's own formula, if it already comes to the target;
 *   2. this system's own percentage in the customer's own shape
 *      (`20%*L5`), if that comes to it exactly;
 *   3. otherwise the amount itself, as a fixed figure Excel cannot move.
 *
 * Example, week 41 R5: Tarief 229 → 300, Fuel `24%*L5` = 54,96, system Fuel
 * 45,00. The target stays 54,96; `24%*L5` would become 72,00 and `15%*L5`
 * 45,00, so 54,96 is written as a figure. Its shown amount is unchanged.
 */
export const FuelCellAction = {
  /** Nothing to write: the cell already shows the target and will keep it. */
  UNCHANGED: "UNCHANGED",
  /** A formula — its own or this system's — with its new cached result. */
  FORMULA: "FORMULA",
  /** A fixed amount in place of whatever the cell held. */
  VALUE: "VALUE",
} as const;

export type FuelCellAction = (typeof FuelCellAction)[keyof typeof FuelCellAction];

export interface FuelCellInput {
  readonly rowNumber: number;
  readonly tariefColumnLetter: string;
  /** The Fuel cell as the invoice states it. */
  readonly cell: InvoiceAmountCell;
  /** The row's Tarief after this check's corrections — what Excel will read. */
  readonly finalTarief: Prisma.Decimal;
  /** Whether this check changes that Tarief. */
  readonly tariefChanged: boolean;
  /** What this system holds for the Fuel. */
  readonly systemFuel: Prisma.Decimal;
  /**
   * The percentage the stored calculation used, or null when the snapshot did
   * not record one. Without it, step 2 is simply skipped.
   */
  readonly systemRate: Prisma.Decimal | null;
}

export interface FuelCellPlan {
  readonly action: FuelCellAction;
  /** What the cell will SHOW, at the money precision. */
  readonly shown: Prisma.Decimal;
  /** True when the shown amount goes up — the only case that is marked red. */
  readonly raised: boolean;
  /** The existing formula is the one that stays. */
  readonly keepsOwnFormula: boolean;
  /** The formula to write, for `FORMULA`. */
  readonly formula: string | null;
  /** What that formula calculates, unrounded, exactly as Excel will store it. */
  readonly result: Prisma.Decimal | null;
}

export function planFuelCell(input: FuelCellInput): FuelCellPlan {
  const original = round(input.cell.value ?? new Prisma.Decimal(0));
  const system = round(input.systemFuel);
  const target = system.greaterThan(original) ? system : original;
  const raised = target.greaterThan(original);

  /*
   * Nothing goes up and nothing underneath it moves: a plain figure, or a
   * formula whose Tarief stays what it was, keeps showing what it shows.
   */
  if (!raised && !(input.cell.formula && input.tariefChanged)) {
    return unchanged(original);
  }

  const own = input.cell.formula
    ? toExactFormulaResult(
        input.cell.formula,
        input.tariefColumnLetter,
        input.rowNumber,
        input.finalTarief,
      )
    : null;

  if (input.cell.formula && own !== null && round(own).equals(target)) {
    return {
      action: FuelCellAction.FORMULA,
      shown: target,
      raised,
      keepsOwnFormula: true,
      formula: input.cell.formula,
      result: own,
    };
  }

  const systemFormula = toSystemFormula(input, target);

  if (raised && systemFormula !== null) {
    return {
      action: FuelCellAction.FORMULA,
      shown: target,
      raised,
      keepsOwnFormula: false,
      ...systemFormula,
    };
  }

  return {
    action: FuelCellAction.VALUE,
    shown: target,
    raised,
    keepsOwnFormula: false,
    formula: null,
    result: null,
  };
}

/** `20%*L5` — this system's percentage in the customer's own shape. */
function toSystemFormula(
  input: FuelCellInput,
  target: Prisma.Decimal,
): { formula: string; result: Prisma.Decimal } | null {
  if (input.systemRate === null || input.systemRate.lessThanOrEqualTo(0)) {
    return null;
  }

  const formula = `${input.systemRate.toString()}%*${input.tariefColumnLetter}${input.rowNumber}`;
  const result = toExactFormulaResult(
    formula,
    input.tariefColumnLetter,
    input.rowNumber,
    input.finalTarief,
  );

  return result !== null && round(result).equals(target) ? { formula, result } : null;
}

function unchanged(shown: Prisma.Decimal): FuelCellPlan {
  return {
    action: FuelCellAction.UNCHANGED,
    shown,
    raised: false,
    keepsOwnFormula: false,
    formula: null,
    result: null,
  };
}
