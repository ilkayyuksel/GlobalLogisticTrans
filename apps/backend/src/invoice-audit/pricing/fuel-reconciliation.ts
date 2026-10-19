import { Prisma } from "@prisma/client";

import { fuelOnTarief, type EffectivePricing } from "../../trip-pricing/effective-pricing";
import { EMPTY_AMOUNT, round } from "../workbook/invoice-amounts";
import type { InvoiceColumn } from "../workbook/invoice-columns";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { FuelCellAction, planFuelCell } from "./fuel-cell-plan";
import type { InvoiceComponent } from "./invoice-column-map";
import {
  DifferenceKind,
  compared,
  informational,
  notPlaceable,
  written,
  type CellWrite,
  type InvoicePricingDifference,
} from "./invoice-pricing-outcome";
import type { LineContext } from "./invoice-reconciliation";
import { statesAny, sumOf } from "./line-amounts";
import { ComponentDecision, decideComponent } from "./raise-only-policy";

const TARIEF_COLUMNS: readonly InvoiceColumn[] = ["tarief"];

/**
 * The Fuel of a line — see `fuel-cell-plan.ts` for how its cell is written.
 *
 * It is decided AFTER the Tarief, because the customer's Fuel formula reads the
 * row's Tarief: a raised Tarief changes what that formula will calculate.
 *
 * ── OUR PERCENTAGE OF THE TARIEF THE INVOICE ENDS UP WITH (owner, 19 Oct 2026)
 * The Fuel owed is this Trip's own percentage of the line's FINAL Tarief — not
 * of this system's Tarief. They differ when the invoice states a HIGHER Tarief:
 * that Tarief stays (nothing is lowered), so its Fuel must be our percentage
 * of it too, or a Fuel at a lower percentage would pass unnoticed.
 */
export function reconcileFuel(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  component: InvoiceComponent,
  context: LineContext,
  decided: readonly InvoicePricingDifference[],
): InvoicePricingDifference | null {
  const expected = round(
    fuelOnTarief(pricing, finalLineTarief(rows, pricing), context.fuelRate),
  );
  const stated = sumOf(rows, component.columns);
  const base = compared(component, stated, expected);
  const carriers = rows.filter((row) => statesAny(row, component.columns));
  const tarief = decided.find((difference) => difference.column === "tarief" && difference.write);
  const tariefRow = tarief?.correctionRowNumber ?? null;

  if (carriers.length > 1) {
    const decision = decideComponent(stated, expected);
    const followsRaisedTarief = carriers.some(
      (row) => row.rowNumber === tariefRow && row.amounts.fuel?.formula,
    );

    if (decision === ComponentDecision.RAISE || followsRaisedTarief) {
      return notPlaceable(base, rows[0].rowNumber, `Fuel staat op ${carriers.length} regels van deze factuur.`);
    }

    return decision === ComponentDecision.INVOICE_HIGHER
      ? informational(base, component, carriers[0].rowNumber)
      : null;
  }

  const target = carriers[0] ?? rows[0];
  const tariefChanged = target.rowNumber === tariefRow;
  const plan = planFuelCell({
    rowNumber: target.rowNumber,
    tariefColumnLetter: context.tariefColumnLetter,
    cell: target.amounts.fuel ?? EMPTY_AMOUNT,
    finalTarief: tariefChanged
      ? tarief!.correctedValue!
      : (target.amounts.tarief?.value ?? new Prisma.Decimal(0)),
    tariefChanged,
    systemFuel: expected,
    systemRate: context.fuelRate,
  });

  if (plan.action === FuelCellAction.UNCHANGED) {
    return decideComponent(stated, expected) === ComponentDecision.INVOICE_HIGHER
      ? informational(base, component, target.rowNumber)
      : null;
  }

  const write: CellWrite =
    plan.action === FuelCellAction.FORMULA
      ? { kind: "FORMULA", formula: plan.formula!, result: plan.result! }
      : { kind: "VALUE", value: plan.shown };

  return {
    ...written(
      base,
      component,
      target.rowNumber,
      plan.shown,
      write,
      plan.raised ? DifferenceKind.RAISE : DifferenceKind.KEEP_AMOUNT,
    ),
    keepsFormula: plan.keepsOwnFormula,
  };
}

/**
 * The Tarief the line states once this check is done with it: only ever raised,
 * so the higher of the invoice's and this system's.
 */
function finalLineTarief(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
): Prisma.Decimal {
  const stated = round(sumOf(rows, TARIEF_COLUMNS) ?? new Prisma.Decimal(0));
  const system = round(pricing.tarief);

  return stated.greaterThan(system) ? stated : system;
}
