import { Prisma } from "@prisma/client";

import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import { EMPTY_AMOUNT, round } from "../workbook/invoice-amounts";
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

/**
 * The Fuel of a line — see `fuel-cell-plan.ts` for how its cell is written.
 *
 * It is decided AFTER the Tarief, because the customer's Fuel formula reads the
 * row's Tarief: a raised Tarief changes what that formula will calculate.
 */
export function reconcileFuel(
  rows: readonly InvoiceSheetRow[],
  pricing: EffectivePricing,
  component: InvoiceComponent,
  context: LineContext,
  decided: readonly InvoicePricingDifference[],
): InvoicePricingDifference | null {
  const expected = round(component.expected(pricing));
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
      return notPlaceable(base, rows[0].rowNumber, `Fuel is stated on ${carriers.length} rows of this invoice`);
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
