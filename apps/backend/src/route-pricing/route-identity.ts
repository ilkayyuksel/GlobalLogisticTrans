import { isSameTerminal } from "../common/terminal";

/**
 * The two ends of a road, as every uniqueness rule compares them.
 *
 * Deliberately not a route, a leg or a DTO: it is the pair of names, which is
 * all that identity is made of. A Tarief, a distance and a tunnel are what a
 * road COSTS in some context, and two rows may disagree about that while being
 * the same road.
 */
export interface RoadEndpoints {
  readonly departure: string;
  readonly destination: string;
}

/**
 * Whether two entries describe the same road.
 *
 * The departure is compared as a TERMINAL through the shared helper, so
 * `PSA Quay 869` and `Quay 869` are one place — the same rule the repositories
 * apply, which is what makes every check in the application agree with the
 * database.
 */
export function isSameRoad(left: RoadEndpoints, right: RoadEndpoints): boolean {
  return (
    left.destination === right.destination &&
    isSameTerminal(left.departure, right.departure)
  );
}

/**
 * Whether two Combination configurations are the same one.
 *
 * ── THE IDENTITY OF A COMBINATION IS ITS PAIR ───────────────────────────────
 * Not either leg on its own. One road may be a leg of many Combinations —
 * everything out of MPET 1742 shares its outbound — and treating a leg as the
 * identity is what used to refuse those. What may not exist twice is the same
 * PAIR of roads: `Quay 869 → Lessines` with `Lessines → Quay 869` is one
 * configuration, and a second copy of it would be two answers to one question.
 *
 * ── WHY THE ORDER OF THE LEGS DOES NOT MATTER ───────────────────────────────
 * The position tells an operator which leg is the outbound, and it is kept
 * exactly as configured. But pricing selects a leg by its ROAD and never by its
 * position, so a configuration with its legs written in the other order would
 * price every Trip identically — it would be the same configuration wearing a
 * different order. Compared as a set, therefore, so swapping the legs cannot
 * smuggle a duplicate past this rule.
 */
export function isSameCombination(
  left: readonly RoadEndpoints[],
  right: readonly RoadEndpoints[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const unmatched = [...right];

  for (const road of left) {
    const index = unmatched.findIndex((candidate) =>
      isSameRoad(candidate, road),
    );

    if (index === -1) {
      return false;
    }

    unmatched.splice(index, 1);
  }

  return unmatched.length === 0;
}

/** A Combination's pair of roads, as a sentence an operator can read. */
export function describeCombination(roads: readonly RoadEndpoints[]): string {
  return roads
    .map((road) => `${road.departure} to ${road.destination}`)
    .join(" and ");
}
