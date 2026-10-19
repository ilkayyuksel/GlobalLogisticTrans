import { CombinationMatchOutcome, RouteMatchMethod } from "@prisma/client";

/**
 * Which kind of route an operator may choose by hand for a Trip, or null.
 *
 * ── ONE RULE, THREE READERS (owner, October 2026) ───────────────────────────
 * The Engine (may the stored choice price this Trip?), the route-choice
 * endpoint (may this choice be made?) and the Ritten row (is the action
 * offered?) all ask HERE, from the AUTOMATIC matcher's own outcome:
 *
 *   a Trip in no group whose road matched nothing (NOT_FOUND) or several
 *     routes (AMBIGUOUS)                                        → NORMAL;
 *   a grouped Trip whose pair is not identified (LEG_NOT_IDENTIFIED), not
 *     configured (PAIR_NOT_CONFIGURED) or ambiguous (AMBIGUOUS) → COMBINATION;
 *   anything else — a usable match (EXACT, NORMALIZED, FUZZY, MATCHED), or a
 *     grouped Trip with no pricing partner (NO_PAIR)            → null.
 *
 * A usable automatic match always wins: a manual choice is a fallback, never
 * an override. NO_PAIR is excluded because a Combination needs a partner leg
 * and there is none to give the other leg to.
 * ────────────────────────────────────────────────────────────────────────────
 */
export type ManualRouteChoiceKind = "NORMAL" | "COMBINATION";

export interface AutomaticRouteOutcome {
  readonly method: RouteMatchMethod | null;
  readonly combinationMatch: CombinationMatchOutcome | null;
}

const UNUSABLE_METHODS: readonly RouteMatchMethod[] = [RouteMatchMethod.NOT_FOUND, RouteMatchMethod.AMBIGUOUS];

const UNIDENTIFIED_PAIRS: readonly CombinationMatchOutcome[] = [
  CombinationMatchOutcome.LEG_NOT_IDENTIFIED,
  CombinationMatchOutcome.PAIR_NOT_CONFIGURED,
  CombinationMatchOutcome.AMBIGUOUS,
];

export function manualRouteChoiceFor(outcome: AutomaticRouteOutcome): ManualRouteChoiceKind | null {
  if (outcome.combinationMatch === null) {
    return outcome.method !== null && UNUSABLE_METHODS.includes(outcome.method) ? "NORMAL" : null;
  }

  return UNIDENTIFIED_PAIRS.includes(outcome.combinationMatch) ? "COMBINATION" : null;
}
