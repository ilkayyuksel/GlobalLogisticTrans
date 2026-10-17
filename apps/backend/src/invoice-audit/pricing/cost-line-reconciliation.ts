import { Prisma } from "@prisma/client";

import { round } from "../workbook/invoice-amounts";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { INVOICE_COMPONENTS } from "./invoice-column-map";
import {
  DifferenceKind,
  InvoicePricingStatus,
  compared,
  informational,
  toRows,
  toStatus,
  unreadableDifferences,
  written,
  type InvoicePricingDifference,
  type InvoiceRowPricing,
} from "./invoice-pricing-outcome";
import { ComponentDecision, decideComponent } from "./raise-only-policy";

/**
 * A Cost Confirmation line against its own confirmation — its EK, and nothing
 * else.
 *
 * `expected` is what this system holds for THAT confirmation: its amount, or
 * nothing when the Trip's EK is its charged waiting time instead (one EK
 * source, never two — see `resolveEk`). The line is raised, left alone or
 * reported exactly as any other amount (`raise-only-policy.ts`); a Tarief or a
 * toll is never put on it, because its transport was invoiced on its own line.
 */
export function reconcileCostLine(
  row: InvoiceSheetRow,
  expected: Prisma.Decimal,
): InvoiceRowPricing {
  const component = INVOICE_COMPONENTS.find((candidate) => candidate.correctionColumn === "ek")!;

  if (row.amounts.ek?.unreadable) {
    return toRows([row], unreadableDifferences([row]), InvoicePricingStatus.AMOUNT_UNREADABLE)[0];
  }

  const stated = row.amounts.ek?.value ?? null;
  const target = round(expected);
  const base = compared(component, stated, target);
  const decision = decideComponent(stated, target);
  const differences: InvoicePricingDifference[] = [];

  if (decision === ComponentDecision.RAISE) {
    differences.push(
      written(base, component, row.rowNumber, target, { kind: "VALUE", value: target }, DifferenceKind.RAISE),
    );
  } else if (decision === ComponentDecision.INVOICE_HIGHER) {
    differences.push(informational(base, component, row.rowNumber));
  }

  return { rowNumber: row.rowNumber, status: toStatus(differences), differences, reliability: null };
}
