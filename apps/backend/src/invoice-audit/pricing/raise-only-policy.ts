import { Prisma } from "@prisma/client";

import { round } from "../workbook/invoice-amounts";

/**
 * What one component of one invoice line comes to: change it or leave it.
 *
 * ── ONLY EVER UP (owner, October 2026) ──────────────────────────────────────
 * The invoice is the customer's own statement of what they pay. It is raised to
 * this system's figure when that figure is STRICTLY higher — compared to the
 * cent, after both sides are rounded — and left alone otherwise:
 *
 *   system higher  RAISE           the cell gets this system's figure
 *   equal          UNCHANGED
 *   system lower   INVOICE_HIGHER  nothing is written; the preview says so
 *
 * The one exception is a removal the caller must explicitly allow: the Backload
 * of a line the Excel calls a Combination while this system has established it
 * is none (`GEEN COMBI`). Nothing else may ever lower an amount.
 *
 * An empty cell states nothing and compares as zero, so an empty Tunnel against
 * 36,20 is raised. A cell this check cannot READ never reaches this function:
 * it makes the whole line unreliable instead (see `invoice-amounts.ts`).
 */
export const ComponentDecision = {
  UNCHANGED: "UNCHANGED",
  RAISE: "RAISE",
  INVOICE_HIGHER: "INVOICE_HIGHER",
  REMOVE: "REMOVE",
} as const;

export type ComponentDecision =
  (typeof ComponentDecision)[keyof typeof ComponentDecision];

export interface ComponentDecisionOptions {
  /**
   * The invoice amount may be REMOVED because this system charges nothing for
   * it. Only the Backload of an established `GEEN COMBI` sets this.
   */
  readonly removalAllowed?: boolean;
}

export function decideComponent(
  stated: Prisma.Decimal | null,
  expected: Prisma.Decimal,
  options: ComponentDecisionOptions = {},
): ComponentDecision {
  const invoice = round(stated ?? new Prisma.Decimal(0));
  const system = round(expected);

  if (system.greaterThan(invoice)) {
    return ComponentDecision.RAISE;
  }

  if (system.lessThan(invoice)) {
    return options.removalAllowed && system.isZero()
      ? ComponentDecision.REMOVE
      : ComponentDecision.INVOICE_HIGHER;
  }

  return ComponentDecision.UNCHANGED;
}
