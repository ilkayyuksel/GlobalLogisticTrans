import { Prisma } from "@prisma/client";

import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import {
  isSameAmount,
  round,
  toFormulaResult,
  type InvoiceAmountCell,
} from "../workbook/invoice-amounts";
import type { InvoiceColumn } from "../workbook/invoice-columns";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { INVOICE_COMPONENTS, type InvoiceComponent } from "./invoice-column-map";

/** What the pricing check concluded about one invoice line. */
export const InvoicePricingStatus = {
  /** Compared, and the invoice already states what this system holds. */
  MATCHED_NO_CHANGES: "MATCHED_NO_CHANGES",
  /** Compared, and at least one cell of this row is corrected. */
  PRICING_CORRECTED: "PRICING_CORRECTED",
  /** Not compared at all: the line has no single CLOSED Trip. */
  NOT_COMPARED: "NOT_COMPARED",
  /**
   * Compared, a difference found, and no cell may safely carry it.
   *
   * The invoice states one component on SEVERAL rows — the ordinary case is a
   * transport charged by two Cost Confirmations — so a total that disagrees
   * cannot be placed on one of them without deciding which confirmation
   * changed. Nothing is written and the line is reported instead.
   */
  NOT_DISTRIBUTABLE: "NOT_DISTRIBUTABLE",
} as const;

export type InvoicePricingStatus =
  (typeof InvoicePricingStatus)[keyof typeof InvoicePricingStatus];

/** One component of one line, as the invoice states it and as we hold it. */
export interface InvoicePricingDifference {
  /** The customer's own name for it: Tarief, Fuel, Backload, Tol, … */
  readonly component: string;
  /** The cell that carries the correction, when one can. */
  readonly column: InvoiceColumn | null;
  /** What the invoice states, added up over the rows sharing this line. */
  readonly invoiceValue: Prisma.Decimal | null;
  /** What this system holds — the effective pricing, overrides included. */
  readonly expectedValue: Prisma.Decimal;
  /** Expected minus stated: positive when the invoice charges too little. */
  readonly difference: Prisma.Decimal;
  /** The row whose cell is corrected, or null when none safely can be. */
  readonly correctionRowNumber: number | null;
  /** What that cell will hold. Null when nothing is written. */
  readonly correctedValue: Prisma.Decimal | null;
  /**
   * The cell is a formula that already produces the right figure once the
   * Tarief is corrected, so the formula stays and only its cached result is
   * refreshed. See `toFormulaResult`.
   */
  readonly keepsFormula: boolean;
  /** Why nothing is written, when nothing is. */
  readonly problem: string | null;
}

/** The outcome for one row of the invoice. */
export interface InvoiceRowPricing {
  readonly rowNumber: number;
  readonly status: InvoicePricingStatus;
  readonly differences: readonly InvoicePricingDifference[];
}

/**
 * Compares what one transport is charged with what this system holds for it.
 *
 * ── THE LINE IS THE KEY, NOT THE ROW ────────────────────────────────────────
 * A weekly invoice may state one transport on several rows: its own line, and
 * one line per Cost Confirmation carrying nothing but an EK amount. Comparing
 * each row against the whole would report the EK rows as missing a Tarief and
 * the first row as missing most of the EK.
 *
 * So the rows sharing an identity are added up per component and compared ONCE,
 * exactly as the customer means them. Not one of those rows is merged, moved or
 * removed: they are read together and written to individually.
 *
 * ── AND WHERE A CORRECTION GOES ─────────────────────────────────────────────
 * To the row that already states that component. When none does, to the line's
 * first row, which is where the customer states a transport's own amounts. When
 * SEVERAL do, nowhere: the difference is reported and the document is left
 * alone, because choosing between them would be inventing a fact.
 */
export function reconcileLine(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  context: LineContext,
): readonly InvoiceRowPricing[] {
  const differences = INVOICE_COMPONENTS.flatMap((component) =>
    toDifference(rows, pricing, component, context),
  );

  return rows.map((row) => {
    const own = differences.filter(
      (difference) => difference.correctionRowNumber === row.rowNumber,
    );

    return {
      rowNumber: row.rowNumber,
      status: toStatus(own),
      differences: own,
    };
  });
}

/** What the sheet itself decides about a formula. */
export interface LineContext {
  /** The Tarief column's letter, for reading a Fuel formula. */
  readonly tariefColumnLetter: string;
}

function toStatus(
  differences: readonly InvoicePricingDifference[],
): InvoicePricingStatus {
  if (differences.length === 0) {
    return InvoicePricingStatus.MATCHED_NO_CHANGES;
  }

  return differences.some((difference) => difference.problem !== null)
    ? InvoicePricingStatus.NOT_DISTRIBUTABLE
    : InvoicePricingStatus.PRICING_CORRECTED;
}

function toDifference(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  component: InvoiceComponent,
  context: LineContext,
): InvoicePricingDifference[] {
  const expected = round(component.expected(pricing));
  const stated = sumOf(rows, component.columns);

  if (isSameAmount(stated, expected)) {
    return [];
  }

  const difference = {
    component: component.label,
    invoiceValue: stated,
    expectedValue: expected,
    difference: expected.minus(stated ?? new Prisma.Decimal(0)),
  };

  const carriers = rows.filter((row) => statesAny(row, component.columns));

  /*
   * Several rows state this component and they disagree with us as a whole.
   * Which of them is wrong is not in the document — see NOT_DISTRIBUTABLE.
   */
  if (carriers.length > 1) {
    return [
      {
        ...difference,
        column: null,
        correctionRowNumber: rows[0].rowNumber,
        correctedValue: null,
        keepsFormula: false,
        problem: `${component.label} is stated on ${carriers.length} rows of this invoice, so a difference cannot be placed on one of them`,
      },
    ];
  }

  // The row that already states it, or the line's own first row.
  const target = carriers[0] ?? rows[0];
  const corrected = toCorrectedValue(target, component, expected);

  if (corrected === null) {
    return [
      {
        ...difference,
        column: component.correctionColumn,
        correctionRowNumber: target.rowNumber,
        correctedValue: null,
        keepsFormula: false,
        problem: `${component.label} is split over columns this check cannot correct without changing a column the customer leaves empty`,
      },
    ];
  }

  return [
    {
      ...difference,
      column: component.correctionColumn,
      correctionRowNumber: target.rowNumber,
      correctedValue: corrected,
      keepsFormula: keepsFormula(target, component, expected, pricing, context),
      problem: null,
    },
  ];
}

/**
 * What the correction cell must hold for the line to add up.
 *
 * For the single-column components that is simply the expected amount. For the
 * toll, which the customer splits over three columns, it is the expected total
 * MINUS whatever the other two already state — so the sum comes out right and
 * the columns the customer leaves empty stay empty. Null when that cannot be
 * done without writing a negative amount into a cell.
 */
function toCorrectedValue(
  row: InvoiceSheetRow,
  component: InvoiceComponent,
  expected: Prisma.Decimal,
): Prisma.Decimal | null {
  const others = component.columns
    .filter((column) => column !== component.correctionColumn)
    .reduce(
      (total, column) => total.plus(row.amounts[column]?.value ?? 0),
      new Prisma.Decimal(0),
    );

  const corrected = round(expected.minus(others));

  return corrected.isNegative() ? null : corrected;
}

/**
 * Whether the cell's own formula already produces the right figure.
 *
 * The Fuel column is written as a percentage of the Tarief, and the Tarief is
 * corrected first — so in the ordinary case the formula produces exactly what
 * this system holds and the right thing to do is nothing at all. Only its
 * cached result is refreshed, so the file is correct before Excel recalculates.
 */
function keepsFormula(
  row: InvoiceSheetRow,
  component: InvoiceComponent,
  expected: Prisma.Decimal,
  pricing: EffectivePricing,
  context: LineContext,
): boolean {
  const cell: InvoiceAmountCell | undefined = row.amounts[component.correctionColumn];

  if (!cell?.formula) {
    return false;
  }

  const produced = toFormulaResult(
    cell.formula,
    context.tariefColumnLetter,
    row.rowNumber,
    round(pricing.tarief),
  );

  return produced !== null && produced.equals(expected);
}

/** What the line states for a component, over every row and column of it. */
function sumOf(
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

function statesAny(
  row: InvoiceSheetRow,
  columns: readonly InvoiceColumn[],
): boolean {
  return columns.some((column) => {
    const value = row.amounts[column]?.value;

    return value !== null && value !== undefined;
  });
}
