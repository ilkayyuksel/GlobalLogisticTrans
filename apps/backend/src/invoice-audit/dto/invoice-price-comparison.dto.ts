import { ApiProperty } from "@nestjs/swagger";

import { INVOICE_COMPONENTS } from "../pricing/invoice-column-map";
import { DifferenceKind, type InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import { MONEY_DECIMAL_PLACES } from "../workbook/invoice-amounts";

/**
 * What became of one component: unchanged, the kind of its difference — or
 * FILLED: the Excel states nothing for it, so Trano's figure is written in. A
 * raise from an empty cell is no comparison and is not shown as one.
 */
export const ComparisonOutcome = { UNCHANGED: "UNCHANGED", FILLED: "FILLED", ...DifferenceKind } as const;

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

  @ApiProperty({ type: String, nullable: true, example: "450.00", description: "What the Excel states; null when nothing or unreadable." })
  excelValue!: string | null;

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
      outcome:
        difference.kind === DifferenceKind.RAISE && difference.invoiceValue === null
          ? ComparisonOutcome.FILLED
          : difference.kind,
      excelValue: money(difference.invoiceValue),
      // An unreadable cell was never compared: there is no figure to set against it.
      tranoValue: difference.kind === DifferenceKind.UNREADABLE ? null : money(difference.expectedValue),
      writtenValue: difference.write === null ? null : money(difference.correctedValue),
    })),
    ...(pricing.agreements ?? []).map((agreement) => ({
      component: agreement.component,
      outcome: ComparisonOutcome.UNCHANGED,
      excelValue: money(agreement.invoiceValue),
      tranoValue: money(agreement.expectedValue),
      writtenValue: null,
    })),
  ];
  const order = (component: string) => INVOICE_COMPONENTS.findIndex((each) => each.label === component);

  return comparisons.sort((left, right) => order(left.component) - order(right.component));
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
    transport.some((comparison) => comparison.outcome === ComparisonOutcome.FILLED) &&
    transport.every((comparison) => comparison.excelValue === null)
  );
}
