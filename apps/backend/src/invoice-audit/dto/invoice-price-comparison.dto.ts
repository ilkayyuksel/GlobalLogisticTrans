import { ApiProperty } from "@nestjs/swagger";

import { INVOICE_COMPONENTS } from "../pricing/invoice-column-map";
import { DifferenceKind, type InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import { MONEY_DECIMAL_PLACES } from "../workbook/invoice-amounts";

/**
 * What became of one component: unchanged, or the kind of its difference. An
 * empty Excel cell is compared as €0,00 (owner, October 2026) — a raise from it
 * is a raise like any other.
 */
export const ComparisonOutcome = { UNCHANGED: "UNCHANGED", ...DifferenceKind } as const;

export type ComparisonOutcome = (typeof ComparisonOutcome)[keyof typeof ComparisonOutcome];

/**
 * One price component of a line, side by side: what the Excel states, what
 * Trano holds, and what the corrected document will show. Exactly the check's
 * own comparison — the preview lays it out and decides nothing.
 */
export class InvoicePriceComparisonDto {
  @ApiProperty({ example: "Tarief", description: "Tarief, Fuel, Backload, Tol, Tunnel, Others or EK." })
  component!: string;

  @ApiProperty({ enum: Object.values(ComparisonOutcome) })
  outcome!: ComparisonOutcome;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "450.00",
    description: "What the Excel states; 0.00 for an empty cell, which is compared as zero; null only when unreadable.",
  })
  excelValue!: string | null;

  @ApiProperty({ description: "The Excel cell is empty: its 0.00 is the comparison's, not a figure the customer wrote." })
  excelCellEmpty!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "475.00",
    description: "What Trano holds for the line; null when the cell could not be read, so nothing is compared.",
  })
  tranoValue!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "475.00",
    description: "What the corrected document writes in the cell; null when nothing is written.",
  })
  writtenValue!: string | null;
}

/** The line's components in the invoice's own column order: differences and agreements together. */
export function toPriceComparisons(pricing: InvoiceRowPricing | undefined): InvoicePriceComparisonDto[] {
  if (pricing === undefined) {
    return [];
  }

  const money = (value: { toFixed(places: number): string } | null) =>
    value === null ? null : value.toFixed(MONEY_DECIMAL_PLACES);
  const comparisons: InvoicePriceComparisonDto[] = [
    ...pricing.differences.map((difference) => ({
      component: difference.component,
      outcome: difference.kind,
      ...excelSide(difference.kind === DifferenceKind.UNREADABLE ? undefined : difference.invoiceValue),
      // An unreadable cell was never compared: there is no figure to set against it.
      tranoValue: difference.kind === DifferenceKind.UNREADABLE ? null : money(difference.expectedValue),
      writtenValue: difference.write === null ? null : money(difference.correctedValue),
    })),
    ...(pricing.agreements ?? []).map((agreement) => ({
      component: agreement.component,
      outcome: ComparisonOutcome.UNCHANGED,
      ...excelSide(agreement.invoiceValue),
      tranoValue: money(agreement.expectedValue),
      writtenValue: null,
    })),
  ];
  const order = (component: string) => INVOICE_COMPONENTS.findIndex((each) => each.label === component);

  return comparisons.sort((left, right) => order(left.component) - order(right.component));
}

/**
 * The Excel's side of a comparison: an empty cell as the €0,00 it is compared
 * as, said to be empty; an unreadable cell (`undefined`) as no figure at all.
 */
function excelSide(value: { toFixed(places: number): string } | null | undefined): {
  excelValue: string | null;
  excelCellEmpty: boolean;
} {
  if (value === undefined) {
    return { excelValue: null, excelCellEmpty: false };
  }

  return value === null
    ? { excelValue: (0).toFixed(MONEY_DECIMAL_PLACES), excelCellEmpty: true }
    : { excelValue: value.toFixed(MONEY_DECIMAL_PLACES), excelCellEmpty: false };
}

/** EK is a cost beside the transport: its own figure says nothing about the transport's prices. */
const COST_COMPONENT = "EK";

/**
 * Whether the line stated no transport price at all, so the ones Trano holds
 * are filled in rather than compared — said so in the preview.
 */
export function fillsTransportPrices(comparisons: readonly InvoicePriceComparisonDto[]): boolean {
  const transport = comparisons.filter((comparison) => comparison.component !== COST_COMPONENT);

  return (
    transport.some((comparison) => comparison.outcome === ComparisonOutcome.RAISE) &&
    transport.every((comparison) => comparison.excelCellEmpty)
  );
}
