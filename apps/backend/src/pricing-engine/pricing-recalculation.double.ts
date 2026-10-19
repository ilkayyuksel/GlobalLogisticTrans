import { tripsRepricedByRegrouping } from "./combination-leg";
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
): PricingRecalculationService & {
  recalculate: jest.Mock;
  tripsAffectedByPlanningDate: jest.Mock;
  tripsAffectedByRoadChange: jest.Mock;
} {
  const recalculate = jest.fn().mockResolvedValue(outcome);

  return {
    recalculate,
    // One `recalculate` per Trip, so a spec reads every repriced Trip from the
    // calls it already inspects. Pairing partner legs is the real service's
    // job, proven in its own spec and through the pricing harness.
    recalculateAll: jest.fn(async (tripIds: readonly string[]) => {
      const outcomes = new Map<string, PricingRecalculationOutcome>();

      for (const tripId of tripIds) {
        outcomes.set(tripId, await recalculate(tripId));
      }

      return outcomes;
    }),
    // The real rule, not a canned answer: which Trips a regrouping affects is
    // the pricing domain's rule itself, and a double that guessed would let a
    // test pass for a group the Engine would price differently.
    tripsAffectedByRegrouping: jest.fn(tripsRepricedByRegrouping),
    // An ordinary Trip: its planningDate moves no price. A spec about a
    // Combination's date names the legs it expects.
    tripsAffectedByPlanningDate: jest.fn().mockResolvedValue([]),
    // A Trip in no group: its road moves only its own price.
    tripsAffectedByRoadChange: jest.fn((tripId: string) => Promise.resolve([tripId])),
  } as unknown as PricingRecalculationService & {
    recalculate: jest.Mock;
    tripsAffectedByRegrouping: jest.Mock;
    tripsAffectedByPlanningDate: jest.Mock;
    tripsAffectedByRoadChange: jest.Mock;
  };
}
