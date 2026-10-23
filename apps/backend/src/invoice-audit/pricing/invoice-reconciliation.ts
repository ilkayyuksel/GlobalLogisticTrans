import { Prisma } from "@prisma/client";

import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import { round } from "../workbook/invoice-amounts";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { expectedFuel, reconcileFuel } from "./fuel-reconciliation";
import { INVOICE_COMPONENTS, type InvoiceComponent } from "./invoice-column-map";
import {
  DifferenceKind,
  InvoicePricingStatus,
  compared,
  informational,
  notPlaceable,
  toRows,
  toStatus,
  unreadableDifferences,
  withoutWrite,
  written,
  type ComparedComponent,
  type InvoicePricingDifference,
  type InvoiceRowPricing,
} from "./invoice-pricing-outcome";
import { othersInRow, statesAny, sumOf } from "./line-amounts";
import { ComponentDecision, decideComponent } from "./raise-only-policy";

/*
 * The outcome types live in `invoice-pricing-outcome.ts`; they are re-exported
 * here so every caller keeps one place to import the reconciliation from.
 */
export * from "./invoice-pricing-outcome";
export { reconcileCostLine } from "./cost-line-reconciliation";

/** What the sheet and the stored price decide about this line. */
export interface LineContext {
  /** The Tarief column's letter, for reading and writing a Fuel formula. */
  readonly tariefColumnLetter: string;
  /** The percentage the stored calculation charged Fuel at, when recorded. */
  readonly fuelRate: Prisma.Decimal | null;
  /** The Backload may be removed: an established GEEN COMBI. */
  readonly backloadRemovalAllowed?: boolean;
}

/**
 * Compares what one transport is charged with what this system holds for it.
 *
 * ── THE LINE IS THE KEY, NOT THE ROW ────────────────────────────────────────
 * A weekly invoice may state one transport on several rows: its own line, and
 * one line per Cost Confirmation carrying nothing but an EK amount. So the rows
 * of one Trip are added up per component and compared ONCE. Not one of them is
 * merged, moved or removed: they are read together and written to separately.
 *
 * ── ONLY EVER UP ────────────────────────────────────────────────────────────
 * See `raise-only-policy.ts`. A raise goes to the row that already states the
 * component, or to the line's first row when none does. When SEVERAL rows
 * state it, nowhere — and then nothing on the whole line is written, because a
 * transport is corrected completely or not at all.
 *
 * ── A LINE THAT CANNOT BE READ IS NOT COMPARED ──────────────────────────────
 * One cell holding a word, a dash or an error makes the whole line unreliable:
 * every comparison would otherwise treat that cell as zero.
 */
export function reconcileLine(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  context: LineContext,
): readonly InvoiceRowPricing[] {
  const unreadable = unreadableDifferences(rows);

  if (unreadable.length > 0) {
    return toRows(rows, unreadable, InvoicePricingStatus.AMOUNT_UNREADABLE);
  }

  const differences: InvoicePricingDifference[] = [];

  for (const component of INVOICE_COMPONENTS) {
    const difference =
      component.correctionColumn === "fuel"
        ? reconcileFuel(rows, pricing, component, context, differences)
        : reconcileComponent(rows, pricing, component, context);

    if (difference !== null) {
      differences.push(difference);
    }
  }

  if (differences.some((difference) => difference.kind === DifferenceKind.NOT_PLACEABLE)) {
    return toRows(
      rows,
      differences.map(withoutWrite),
      InvoicePricingStatus.NOT_DISTRIBUTABLE,
    );
  }

  const agreements = toAgreements(rows, pricing, context, differences);

  return rows.map((row, index) => {
    const own = differences.filter((difference) => difference.correctionRowNumber === row.rowNumber);

    return {
      rowNumber: row.rowNumber,
      status: toStatus(own),
      differences: own,
      agreements: index === 0 ? agreements : [],
      reliability: null,
    };
  });
}

/**
 * Every component compared above without a difference: what the invoice states
 * and what this system holds, read the same way the comparison read them —
 * nothing priced again. A component neither side charges is left out.
 */
function toAgreements(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  context: LineContext,
  differences: readonly InvoicePricingDifference[],
): ComparedComponent[] {
  return INVOICE_COMPONENTS.filter((component) => !differences.some((difference) => difference.component === component.label))
    .map((component) =>
      compared(
        component,
        sumOf(rows, component.columns),
        component.correctionColumn === "fuel" ? expectedFuel(rows, pricing, context) : round(component.expected(pricing)),
      ),
    )
    .filter((agreement) => !agreement.expectedValue.isZero() || !(agreement.invoiceValue ?? new Prisma.Decimal(0)).isZero());
}

function reconcileComponent(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  component: InvoiceComponent,
  context: LineContext,
): InvoicePricingDifference | null {
  const expected = round(component.expected(pricing));
  const stated = sumOf(rows, component.columns);
  const decision = decideComponent(stated, expected, {
    removalAllowed: component.correctionColumn === "backload" && context.backloadRemovalAllowed,
  });

  if (decision === ComponentDecision.UNCHANGED) {
    return null;
  }

  const carriers = rows.filter((row) => statesAny(row, component.columns));
  const target = carriers[0] ?? rows[0];
  const base = compared(component, stated, expected);

  if (decision === ComponentDecision.INVOICE_HIGHER) {
    return informational(base, component, target.rowNumber);
  }

  if (carriers.length > 1) {
    return notPlaceable(
      base,
      rows[0].rowNumber,
      `${component.label} staat op ${carriers.length} regels van deze factuur; een verschil kan niet aan één ervan worden toegewezen.`,
    );
  }

  if (decision === ComponentDecision.REMOVE) {
    return written(base, component, target.rowNumber, new Prisma.Decimal(0), {
      kind: "VALUE",
      value: null,
    }, DifferenceKind.REMOVE);
  }

  const corrected = round(expected.minus(othersInRow(target, component)));

  // Cannot happen for a raise on one row; kept so a negative can never be written.
  if (corrected.isNegative()) {
    return notPlaceable(base, target.rowNumber, `${component.label} kan niet verhoogd worden zonder een negatieve cel.`);
  }

  return written(base, component, target.rowNumber, corrected, {
    kind: "VALUE",
    value: corrected,
  }, DifferenceKind.RAISE);
}
