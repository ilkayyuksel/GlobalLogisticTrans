import {
  PricingRecalculationOutcome,
  PricingRecalculationService,
} from "./pricing-recalculation.service";

/**
 * A stand-in for PricingRecalculationService.
 *
 * Not a test file — a shared double, in the same spirit as
 * `trip-write-transaction.double.ts`.
 *
 * Three services now call the recalculation after a write, and a dozen specs
 * exercise them for reasons that have nothing to do with pricing: grouping,
 * losrit, filters, imports. Each would otherwise spell out the same stub, which
 * is how a change to the outcome shape turns into a dozen edits.
 *
 * The default outcome is "no pricing and no reason", which is what a Trip that
 * was never priceable produces. A spec that is ABOUT pricing passes its own,
 * and reads the calls through `recalculate`.
 */
export function stubPricingRecalculation(
  outcome: PricingRecalculationOutcome = { pricing: null, reasonCode: null },
): PricingRecalculationService & { recalculate: jest.Mock } {
  return {
    recalculate: jest.fn().mockResolvedValue(outcome),
  } as unknown as PricingRecalculationService & { recalculate: jest.Mock };
}
