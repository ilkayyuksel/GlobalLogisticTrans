import { PricingCalculationStatus, Prisma } from "@prisma/client";

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
 * The outcome of one Pricing Engine run: a complete snapshot, not yet stored.
 *
 * Everything `trip_pricing` and its items need is here, which is what keeps
 * CALCULATION and PERSISTENCE separate. A caller can inspect a finished result,
 * compare it with what is already stored, and decide whether to keep it —
 * writing is a distinct operation, performed by the snapshot writer.
 *
 * `lines` holds what the calculation steps produced, in the order
 * pricing_rules.md defines. Each line maps onto a `trip_pricing_item` field for
 * field, so persistence is a mechanical mapping with no arithmetic left in it.
 *
 * `totalPrice` is the exact Decimal sum of those line amounts and nothing else.
 * No component is recalculated to produce it.
 */
export interface PricingCalculationResult extends PricingPreparation {
  readonly lines: readonly PricingLine[];

  /** The exact Decimal sum of every line amount. */
  readonly totalPrice: Prisma.Decimal;

  /** When the calculation finished — the instant the snapshot describes. */
  readonly calculatedAt: Date;

  /** The Engine code that produced this result. */
  readonly pricingEngineVersion: string;

  /** The configured ruleset it was calculated against. */
  readonly pricingRuleVersion: string;

  /**
   * CALCULATED for a run that produced a result. The FAILED and
   * MANUAL_OVERRIDE states belong to workflows this phase does not implement;
   * a run that cannot produce a result throws instead of returning one.
   */
  readonly calculationStatus: PricingCalculationStatus;
}
