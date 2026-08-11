import { PricingCalculationContext } from "./pricing-calculation-context";
import { PricingLine } from "./pricing-line";

/**
 * A calculation's inputs, resolved and validated, before any step has run.
 *
 * Produced on its own by `prepareCalculation`, which answers "could this Trip
 * be priced right now, and against what" without producing an amount.
 */
export interface PricingPreparation {
  readonly tripId: string;

  /** Every validated input the calculation steps read. */
  readonly context: PricingCalculationContext;

  /**
   * True when the Trip already has a pricing snapshot, so a calculation would
   * replace it rather than create the first one. pricing_rules.md treats those
   * as two distinct events.
   */
  readonly isReprocess: boolean;

  readonly preparedAt: Date;
  readonly durationMs: number;
}

/**
 * The outcome of one Pricing Engine run.
 *
 * `lines` holds what the calculation steps produced, in the order
 * pricing_rules.md defines. Each line maps onto a future `trip_pricing_item`
 * field for field.
 *
 * There is deliberately no total. The Final Total is step 9 of the sequence and
 * belongs to its own phase; deriving it here would quietly implement a step
 * this phase does not own, and a caller could not tell a real total from a
 * running subtotal of the components implemented so far.
 */
export interface PricingCalculationResult extends PricingPreparation {
  readonly lines: readonly PricingLine[];
}
