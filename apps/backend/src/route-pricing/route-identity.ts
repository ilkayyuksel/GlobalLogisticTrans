import { normalizeLocation } from "./location-forms";

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
 * Whether two entries describe the same road — the ONE identity every
 * uniqueness rule uses (owner's audit, 14 October 2026).
 *
 * Both ends through `normalizeLocation`: the canonical terminal rule
 * (`PSA Quay 869` is `Quay 869`) at EITHER end — a collection runs city →
 * terminal — and the safe normalisation of the pricing matcher (letter case,
 * accents, punctuation, spacing). So two configurations the matcher would read
 * as one road (`Quay 869 → LOKEREN`, `Quay 869 → Lokeren`) can no longer both
 * be created, which left every Trip on that road AMBIGUOUS.
 *
 * Deliberately NOT the aliases, qualifiers or fuzzy layer: those need the
 * Trip's terminal end and stay in pricing (`route-matcher.ts`), where several
 * candidates are AMBIGUOUS rather than chosen.
 */
export function isSameRoad(left: RoadEndpoints, right: RoadEndpoints): boolean {
  return (
    normalizeLocation(left.departure) === normalizeLocation(right.departure) &&
    normalizeLocation(left.destination) === normalizeLocation(right.destination)
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
