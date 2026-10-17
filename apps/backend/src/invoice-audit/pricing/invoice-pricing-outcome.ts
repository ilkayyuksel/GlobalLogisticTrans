import { Prisma } from "@prisma/client";

import type { InvoiceColumn } from "../workbook/invoice-columns";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { INVOICE_COMPONENTS, type InvoiceComponent } from "./invoice-column-map";
import type { PriceReliability } from "./price-reliability";

/** What the pricing check concluded about one invoice line. */
export const InvoicePricingStatus = {
  /** Compared, and the invoice already states what this system holds. */
  MATCHED_NO_CHANGES: "MATCHED_NO_CHANGES",
  /** Compared, and at least one amount of this row is raised. */
  PRICING_CORRECTED: "PRICING_CORRECTED",
  /**
   * Compared, nothing raised, and at least one amount is HIGHER than this
   * system holds. Never lowered — the invoice states at least what is owed —
   * and reported, because a higher figure can point at an outdated price.
   */
  INVOICE_HIGHER: "INVOICE_HIGHER",
  /** Not compared at all: the line has no single CLOSED Trip. */
  NOT_COMPARED: "NOT_COMPARED",
  /**
   * Compared, a raise found, and no cell may safely carry it.
   *
   * The invoice states one component on SEVERAL rows — the ordinary case is a
   * transport charged by two Cost Confirmations — so a total that disagrees
   * cannot be placed on one of them without deciding which confirmation
   * changed. Nothing on the line is written and the line is reported instead.
   */
  NOT_DISTRIBUTABLE: "NOT_DISTRIBUTABLE",
  /**
   * The Trip's stored price cannot be relied on — no snapshot, no route found,
   * an unconfirmed route, an outdated Combination. See `price-reliability.ts`.
   */
  PRICE_UNRELIABLE: "PRICE_UNRELIABLE",
  /** An amount cell of the line holds something that is not an amount. */
  AMOUNT_UNREADABLE: "AMOUNT_UNREADABLE",
  /**
   * The Excel marks the line as half of a Combination the system cannot
   * confirm — or the two halves were not priced as the same Combination. A
   * Backload may hang on that answer, so nothing on the line is written.
   */
  COMBINATION_REVIEW: "COMBINATION_REVIEW",
} as const;

export type InvoicePricingStatus =
  (typeof InvoicePricingStatus)[keyof typeof InvoicePricingStatus];

/** What one difference is, which decides whether and how it is written. */
export const DifferenceKind = {
  /** The amount goes up to this system's figure. */
  RAISE: "RAISE",
  /** The amount is removed — only the Backload of an established GEEN COMBI. */
  REMOVE: "REMOVE",
  /**
   * The cell is rewritten so its amount STAYS what it shows: a Fuel formula
   * that would otherwise follow a raised Tarief past the figure it may hold.
   */
  KEEP_AMOUNT: "KEEP_AMOUNT",
  /** The invoice states more than this system holds. Reported, never written. */
  INVOICE_HIGHER: "INVOICE_HIGHER",
  /** A raise no single cell can carry. Nothing on the line is written. */
  NOT_PLACEABLE: "NOT_PLACEABLE",
  /** A cell holding something that is not an amount. */
  UNREADABLE: "UNREADABLE",
} as const;

export type DifferenceKind = (typeof DifferenceKind)[keyof typeof DifferenceKind];

/** What a cell is given: a figure, nothing at all, or a formula. */
export type CellWrite =
  | { readonly kind: "VALUE"; readonly value: Prisma.Decimal | null }
  | {
      readonly kind: "FORMULA";
      readonly formula: string;
      /** What the formula calculates, unrounded, as Excel will store it. */
      readonly result: Prisma.Decimal;
    };

/** One component of one line, as the invoice states it and as we hold it. */
export interface InvoicePricingDifference {
  /** The customer's own name for it: Tarief, Fuel, Backload, Tol, … */
  readonly component: string;
  readonly kind: DifferenceKind;
  /** The cell that carries the correction, when one can. */
  readonly column: InvoiceColumn | null;
  /** What the invoice states, added up over the rows sharing this line. */
  readonly invoiceValue: Prisma.Decimal | null;
  /** What this system holds — the effective pricing, overrides included. */
  readonly expectedValue: Prisma.Decimal;
  /** Expected minus stated: positive when the invoice charges too little. */
  readonly difference: Prisma.Decimal;
  /** The row this difference concerns, and whose cell is written. */
  readonly correctionRowNumber: number | null;
  /** What that cell will SHOW. Null when nothing is written. */
  readonly correctedValue: Prisma.Decimal | null;
  /** The cell's own formula stays; only its cached result is refreshed. */
  readonly keepsFormula: boolean;
  /** Exactly what the writer puts in the cell; null when nothing is written. */
  readonly write: CellWrite | null;
  /** Why nothing is written, when that is a problem. */
  readonly problem: string | null;
}

/** The outcome for one row of the invoice. */
export interface InvoiceRowPricing {
  readonly rowNumber: number;
  readonly status: InvoicePricingStatus;
  readonly differences: readonly InvoicePricingDifference[];
  /** Whether the Trip's stored price could be relied on; null when uncompared. */
  readonly reliability: PriceReliability | null;
}

export type ComparedComponent = Pick<
  InvoicePricingDifference,
  "component" | "invoiceValue" | "expectedValue" | "difference"
>;

export function compared(
  component: InvoiceComponent,
  stated: Prisma.Decimal | null,
  expected: Prisma.Decimal,
): ComparedComponent {
  return {
    component: component.label,
    invoiceValue: stated,
    expectedValue: expected,
    difference: expected.minus(stated ?? new Prisma.Decimal(0)),
  };
}

export function written(
  base: ComparedComponent,
  component: InvoiceComponent,
  rowNumber: number,
  correctedValue: Prisma.Decimal,
  write: CellWrite,
  kind: DifferenceKind,
): InvoicePricingDifference {
  return {
    ...base,
    kind,
    column: component.correctionColumn,
    correctionRowNumber: rowNumber,
    correctedValue,
    keepsFormula: false,
    write,
    problem: null,
  };
}

export function informational(
  base: ComparedComponent,
  component: InvoiceComponent,
  rowNumber: number,
): InvoicePricingDifference {
  return {
    ...base,
    kind: DifferenceKind.INVOICE_HIGHER,
    column: component.correctionColumn,
    correctionRowNumber: rowNumber,
    correctedValue: null,
    keepsFormula: false,
    write: null,
    problem: null,
  };
}

export function notPlaceable(
  base: ComparedComponent,
  rowNumber: number,
  problem: string,
): InvoicePricingDifference {
  return {
    ...base,
    kind: DifferenceKind.NOT_PLACEABLE,
    column: null,
    correctionRowNumber: rowNumber,
    correctedValue: null,
    keepsFormula: false,
    write: null,
    problem,
  };
}

export function withoutWrite(difference: InvoicePricingDifference): InvoicePricingDifference {
  return { ...difference, correctedValue: null, keepsFormula: false, write: null };
}

/** Every amount cell of the line that holds something unreadable. */
export function unreadableDifferences(rows: readonly InvoiceSheetRow[]): InvoicePricingDifference[] {
  return INVOICE_COMPONENTS.flatMap((component) =>
    rows.flatMap((row) =>
      component.columns
        .filter((column) => row.amounts[column]?.unreadable)
        .map(
          (column): InvoicePricingDifference => ({
            component: component.label,
            kind: DifferenceKind.UNREADABLE,
            column,
            invoiceValue: null,
            expectedValue: new Prisma.Decimal(0),
            difference: new Prisma.Decimal(0),
            correctionRowNumber: row.rowNumber,
            correctedValue: null,
            keepsFormula: false,
            write: null,
            problem: `${component.label} on row ${row.rowNumber} is not an amount this check can read`,
          }),
        ),
    ),
  );
}

/** Every row of the line under one status, each with its own differences. */
export function toRows(
  rows: readonly InvoiceSheetRow[],
  differences: readonly InvoicePricingDifference[],
  status: InvoicePricingStatus,
): InvoiceRowPricing[] {
  return rows.map((row) => ({
    rowNumber: row.rowNumber,
    status,
    differences: differences.filter((difference) => difference.correctionRowNumber === row.rowNumber),
    reliability: null,
  }));
}

export function toStatus(differences: readonly InvoicePricingDifference[]): InvoicePricingStatus {
  const has = (...kinds: DifferenceKind[]) =>
    differences.some((difference) => kinds.includes(difference.kind));

  if (has(DifferenceKind.RAISE, DifferenceKind.REMOVE)) {
    return InvoicePricingStatus.PRICING_CORRECTED;
  }

  const invoiceHigher = differences.some(
    (difference) =>
      difference.kind === DifferenceKind.INVOICE_HIGHER ||
      (difference.kind === DifferenceKind.KEEP_AMOUNT && difference.difference.isNegative()),
  );

  return invoiceHigher ? InvoicePricingStatus.INVOICE_HIGHER : InvoicePricingStatus.MATCHED_NO_CHANGES;
}
