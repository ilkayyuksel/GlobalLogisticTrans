import { ApiProperty } from "@nestjs/swagger";

import { INVOICE_COMPONENTS } from "../pricing/invoice-column-map";
import { DifferenceKind, type InvoiceRowPricing } from "../pricing/invoice-reconciliation";
import { MONEY_DECIMAL_PLACES } from "../workbook/invoice-amounts";

/** What became of one component: unchanged, or the kind of its difference. */
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
      outcome: difference.kind,
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
