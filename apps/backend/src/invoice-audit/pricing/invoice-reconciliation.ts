import { Prisma } from "@prisma/client";

import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import { isMissingPrice, round } from "../workbook/invoice-amounts";
import type { InvoiceColumn } from "../workbook/invoice-columns";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { expectedFuel, reconcileFuel } from "./fuel-reconciliation";
import { INVOICE_COMPONENTS, type InvoiceComponent } from "./invoice-column-map";
import {
  DifferenceKind,
  InvoiceLineMark,
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

/** The EK's own label: a cost beside the transport, not one of its prices. */
const COST_COMPONENT_LABEL = INVOICE_COMPONENTS.find((component) => component.correctionColumn === "ek")!.label;
export { reconcileCostLine } from "./cost-line-reconciliation";

/** What the sheet and the stored price decide about this line. */
export interface LineContext {
  /** The Tarief column's letter, for reading and writing a Fuel formula. */
  readonly tariefColumnLetter: string;
  /** The percentage the stored calculation charged Fuel at, when recorded. */
  readonly fuelRate: Prisma.Decimal | null;
  /** The Backload may be removed: an established GEEN COMBI. */
  readonly backloadRemovalAllowed?: boolean;
  /**
   * False when the Trip is a Combination the Excel does not mark as one: its
   * €50 Backload is then not added to the invoice (owner, November 2026).
   */
  readonly backloadRaiseAllowed?: boolean;
  /**
   * The transport is no Combination in this system nor in the Excel: when the
   * line states no Tarief and no Fuel, its EK is read as the transport's total
   * (owner, November 2026). See `TRIP_TOTAL_IN_EK`.
   */
  readonly ekIsTripTotalWhenPricesMissing?: boolean;
}

/** The two components a line must state at least one of to be priced from us. */
const PRICE_COLUMNS: readonly InvoiceColumn[] = ["tarief", "fuel"];

/**
 * The line states NO Tarief and NO Fuel: every one of its cells of both is
 * empty or a dash (owner, November 2026). Neither is then filled in from this
 * system and the line is marked. A figure — 0,00 included — is a price, and a
 * line stating either one keeps every component check as it was.
 */
export function statesNoPrices(rows: readonly InvoiceSheetRow[]): boolean {
  return rows.every((row) => PRICE_COLUMNS.every((column) => isMissingPrice(row.amounts[column])));
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
 * transport is corrected completely or not at all. The one exception is the EK
 * (owner, October 2026): an EK raise no row can carry holds back the EK alone,
 * and the transport's own prices are still written; the line stays marked.
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
  if (!statesNoPrices(rows)) {
    return compareLine(rows, pricing, context, INVOICE_COMPONENTS);
  }

  /*
   * ── NO TARIEF AND NO FUEL: NEITHER IS FILLED IN ───────────────────────────
   * Both were filled in from this system; they are now left exactly as the
   * customer wrote them — empty, or the dash — and the line is marked. Every
   * other component is compared as always; a dash in Tarief or Fuel is no
   * longer a reason to leave the whole line unread.
   */
  const outcomes = compareLine(
    rows,
    pricing,
    context,
    context.ekIsTripTotalWhenPricesMissing === true
      ? [TRIP_TOTAL_IN_EK]
      : INVOICE_COMPONENTS.filter((component) => !PRICE_COLUMNS.includes(component.correctionColumn)),
  );

  return outcomes.map((outcome) => withMark(outcome, InvoiceLineMark.PRICES_MISSING));
}

/** The components a transport's total is made of, each counted once. */
const TRIP_TOTAL_COLUMNS: readonly InvoiceColumn[] = ["tarief", "fuel", "backload", "tolB", "tunnel", "others", "ek"];

/**
 * ── A NORMAL TRIP WITHOUT TARIEF AND FUEL: ITS EK IS THE TOTAL ──────────────
 * On a line that is a Combination neither here nor in the Excel, and states no
 * Tarief and no Fuel, the customer's EK holds what the whole transport costs
 * (owner, November 2026). It is compared with the stored snapshot's total —
 * effective Tarief, stored Fuel, Toll, Tunnel, Backload, Others and EK, each
 * rounded as the check rounds it — and only ever raised: the higher of the two
 * stands. Nothing is priced again, and no other column is compared or written,
 * since each of those is already inside the total.
 *
 * The EK of the snapshot is the one the Trip's own line is owed: Cost
 * Confirmations charged on their own lines are already taken off it
 * (`trip-reconciliation.ts`), and a waiting time or confirmation is in it
 * exactly once (`effective-pricing.ts`). The label stays the EK's, so the
 * preview and the EK-only exception for unplaceable amounts treat it as the EK.
 */
const TRIP_TOTAL_IN_EK: InvoiceComponent = {
  label: COST_COMPONENT_LABEL,
  columns: ["ek"],
  correctionColumn: "ek",
  expected: (pricing) => tripTotalOf(pricing),
};

/** The stored snapshot's total for the transport, every component once. */
export function tripTotalOf(pricing: EffectivePricing): Prisma.Decimal {
  return INVOICE_COMPONENTS.filter((component) => TRIP_TOTAL_COLUMNS.includes(component.correctionColumn)).reduce(
    (total, component) => total.plus(round(component.expected(pricing))),
    new Prisma.Decimal(0),
  );
}

/** The outcome, marked yellow for one more reason. */
export function withMark(outcome: InvoiceRowPricing, mark: InvoiceLineMark): InvoiceRowPricing {
  return { ...outcome, marks: [...new Set([...(outcome.marks ?? []), mark])] };
}

function compareLine(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  context: LineContext,
  components: readonly InvoiceComponent[],
): readonly InvoiceRowPricing[] {
  const unreadable = unreadableDifferences(rows).filter((difference) =>
    components.some((component) => component.label === difference.component),
  );

  if (unreadable.length > 0) {
    return toRows(rows, unreadable, InvoicePricingStatus.AMOUNT_UNREADABLE);
  }

  const differences: InvoicePricingDifference[] = [];
  const comparedComponents = components.filter((component) => !isBackloadWithheld(component, rows, pricing, context));

  for (const component of comparedComponents) {
    const difference =
      component.correctionColumn === "fuel"
        ? reconcileFuel(rows, pricing, component, context, differences)
        : reconcileComponent(rows, pricing, component, context);

    if (difference !== null) {
      differences.push(difference);
    }
  }

  const unplaceable = differences.filter((difference) => difference.kind === DifferenceKind.NOT_PLACEABLE);

  if (unplaceable.length > 0) {
    /*
     * An EK difference no single row can carry — a transport split over EC
     * lines, each stating its own EK — holds back the EK and nothing else
     * (owner, October 2026): the transport's own prices are decided apart from
     * it and are still written. The line stays NOT_DISTRIBUTABLE, marked and
     * not settled, because its EK is not. Any other component that cannot be
     * placed still holds back the whole line: the Fuel follows the Tarief.
     */
    const onlyCost = unplaceable.every((difference) => difference.component === COST_COMPONENT_LABEL);

    if (!onlyCost) {
      return toRows(rows, differences.map(withoutWrite), InvoicePricingStatus.NOT_DISTRIBUTABLE);
    }

    const agreements = toAgreements(rows, pricing, context, differences, comparedComponents);

    return toRows(rows, differences, InvoicePricingStatus.NOT_DISTRIBUTABLE).map((outcome, index) => ({
      ...outcome,
      agreements: index === 0 ? agreements : [],
    }));
  }

  const agreements = toAgreements(rows, pricing, context, differences, comparedComponents);

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
  components: readonly InvoiceComponent[],
): ComparedComponent[] {
  return components.filter((component) => !differences.some((difference) => difference.component === component.label))
    .map((component) =>
      compared(
        component,
        sumOf(rows, component.columns),
        component.correctionColumn === "fuel" ? expectedFuel(rows, pricing, context) : round(component.expected(pricing)),
      ),
    )
    .filter((agreement) => !agreement.expectedValue.isZero() || !(agreement.invoiceValue ?? new Prisma.Decimal(0)).isZero());
}

/**
 * A Backload raise this line does not get: the Trip is a Combination the Excel
 * does not mark as one, so its €50 is not added (owner, November 2026). Only
 * the RAISE is withheld — a Backload the invoice already states is compared as
 * always — and the Backload is then neither written nor reported as agreeing.
 */
function isBackloadWithheld(
  component: InvoiceComponent,
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  context: LineContext,
): boolean {
  return (
    component.correctionColumn === "backload" &&
    context.backloadRaiseAllowed === false &&
    decideComponent(sumOf(rows, component.columns), round(component.expected(pricing))) === ComponentDecision.RAISE
  );
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
