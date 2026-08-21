import type { CostConfirmation } from "@/lib/api/types";

/**
 * How a confirmation is named on screen: `CC4139505`.
 *
 * The prefix is PRESENTATION. The stored number is Eucon's own, digits only,
 * and nothing business-facing may depend on the two letters in front of it —
 * so this is the one place they are added, and never a value anything compares.
 */
export function toCostConfirmationLabel(
  confirmation: Pick<CostConfirmation, "ccNumber">,
): string {
  return `CC${confirmation.ccNumber}`;
}

/**
 * Whether this Trip carries a confirmed cost.
 *
 * A Trip with none shows nothing at all rather than a zero: nothing confirmed
 * and confirmed at nothing are different facts, and the second one has never
 * happened.
 */
export function hasCostConfirmation(trip: {
  costConfirmation: CostConfirmation | null;
}): boolean {
  return trip.costConfirmation !== null;
}
