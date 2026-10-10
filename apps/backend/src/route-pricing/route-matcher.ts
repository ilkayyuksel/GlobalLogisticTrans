import { toCanonicalTerminal } from "../common/terminal";
import type { RoadEndpoints } from "./route-identity";

/**
 * Which configured route a Trip's road is — the ONE matcher pricing uses.
 *
 * ── THE LAYERS, STRONGEST FIRST ─────────────────────────────────────────────
 * A layer is tried only when every stronger one found nothing, so a weaker
 * match can never overrule a configuration that matches better:
 *
 *   EXACT       both ends equal as configured, after the established canonical
 *               terminal rule (whitespace, and `PSA` before `Quay` —
 *               `common/terminal.ts`). The rule pricing has always used.
 *   NORMALIZED  both ends equal after SAFE normalisation: letter case,
 *               accents, and the punctuation that never names a place
 *               (`-`, `.`, `,`, `'`, `/`, brackets). Every real spelling
 *               variant seen in the documents and the customer's price list
 *               differs only in this way (`ZEMST` / `Zemst`).
 *   FUZZY       one end equal after normalisation, the other a typo of it —
 *               under the strict rule below.
 *
 * Nothing else is equivalent. There is no alias table: `Antwerp` and
 * `Antwerpen`, or `Kallo` and `Kallo (Beveren)`, are NOT matched — the
 * customer's own list prices `MECHELEN` and `MECHELEN (MUIZEN)` as two routes,
 * so a qualifier is information, not noise.
 *
 * ── DIRECTION ───────────────────────────────────────────────────────────────
 * A road is compared as given: `X → Y` never matches `Y → X`. The caller
 * passes the Trip's real driving direction (`toTripRoute`).
 *
 * ── MORE THAN ONE ───────────────────────────────────────────────────────────
 * Configurations found at the winning layer that are DIFFERENT roads are
 * AMBIGUOUS, and no price is taken from any of them. Configurations that are
 * the same road (one road in several Combinations) are all returned, and the
 * caller decides — a Combination by its pair.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const RouteMatchMethod = {
  EXACT: "EXACT",
  NORMALIZED: "NORMALIZED",
  FUZZY: "FUZZY",
  NOT_FOUND: "NOT_FOUND",
  AMBIGUOUS: "AMBIGUOUS",
} as const;

export type RouteMatchMethod =
  (typeof RouteMatchMethod)[keyof typeof RouteMatchMethod];

/**
 * When a typo may still be priced. Calibrated on every real place name in the
 * documents, the captures and the customer's price list (81 names):
 *
 *   - the closest two DIFFERENT real places are two edits apart, and all such
 *     pairs are 7 letters or shorter (`avelgem`/`evergem`, `beerse`/`beernem`,
 *     `diest`/`tielt`); from 8 letters the closest pair is three apart
 *     (`coulogne`/`soumagne`);
 *   - so ONE edit on a name of at least EIGHT letters, with nothing else
 *     within THREE edits, cannot reach another real place.
 *
 * Digits never take part: a terminal or quay number is not misspelled into
 * another one. Both ends fuzzy at once is never trusted.
 */
export const FUZZY_ROUTE_RULES = {
  maxEdits: 1,
  minLength: 8,
  minRunnerUpEdits: 3,
} as const;

/** How one configured road scored against the Trip's road. */
export interface ScoredCandidate<T> {
  readonly route: T;
  /** Edits between the normalised departures. */
  readonly departureEdits: number;
  /** Edits between the normalised destinations. */
  readonly destinationEdits: number;
}

export interface RoadMatch<T> {
  readonly method: RouteMatchMethod;
  /** The configurations of the matched road; empty unless matched. */
  readonly matches: readonly T[];
  /** The closest configurations, for a log or a person — never for pricing. */
  readonly nearest: readonly ScoredCandidate<T>[];
}

const NEAREST_REPORTED = 3;
const PUNCTUATION = /[-_.,'’/()[\]]/g;
const COMBINING_MARKS = /[̀-ͯ]/g;
const WHITESPACE_RUN = /\s+/g;
const DIGIT = /\d/;

/** The canonical terminal rule, then safe normalisation. */
export function normalizeLocation(location: string): string {
  return (toCanonicalTerminal(location) ?? "")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(PUNCTUATION, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

/** The same road for every layer: what a configuration is identified by. */
export function roadKey(road: RoadEndpoints): string {
  return `${normalizeLocation(road.departure)}→${normalizeLocation(road.destination)}`;
}

export function matchRoad<T extends RoadEndpoints>(
  road: RoadEndpoints,
  candidates: readonly T[],
): RoadMatch<T> {
  const exact = candidates.filter((candidate) => isExactRoad(candidate, road));

  if (exact.length > 0) {
    return decide(RouteMatchMethod.EXACT, exact, []);
  }

  const wanted = roadKey(road);
  const normalized = candidates.filter(
    (candidate) => roadKey(candidate) === wanted,
  );

  if (normalized.length > 0) {
    return decide(RouteMatchMethod.NORMALIZED, normalized, []);
  }

  return matchFuzzy(road, candidates);
}

function isExactRoad(left: RoadEndpoints, right: RoadEndpoints): boolean {
  return (
    toCanonicalTerminal(left.departure) === toCanonicalTerminal(right.departure) &&
    toCanonicalTerminal(left.destination) === toCanonicalTerminal(right.destination)
  );
}

function decide<T extends RoadEndpoints>(
  method: RouteMatchMethod,
  found: readonly T[],
  nearest: readonly ScoredCandidate<T>[],
): RoadMatch<T> {
  const roads = new Set(found.map(roadKey));

  return roads.size === 1
    ? { method, matches: found, nearest }
    : { method: RouteMatchMethod.AMBIGUOUS, matches: [], nearest };
}

function matchFuzzy<T extends RoadEndpoints>(
  road: RoadEndpoints,
  candidates: readonly T[],
): RoadMatch<T> {
  const scored = candidates
    .map((route) => score(route, road))
    .sort((left, right) => totalEdits(left) - totalEdits(right));
  const nearest = scored.slice(0, NEAREST_REPORTED);
  const accepted = scored.filter((candidate) => isTrustedTypo(candidate, road));

  if (accepted.length === 0) {
    return { method: RouteMatchMethod.NOT_FOUND, matches: [], nearest };
  }

  const best = accepted[0];
  const contested = scored.some(
    (other) =>
      roadKey(other.route) !== roadKey(best.route) &&
      sharesAnchor(other, best) &&
      totalEdits(other) < FUZZY_ROUTE_RULES.minRunnerUpEdits,
  );

  if (contested) {
    return { method: RouteMatchMethod.AMBIGUOUS, matches: [], nearest };
  }

  return decide(RouteMatchMethod.FUZZY, accepted.map((candidate) => candidate.route), nearest);
}

function score<T extends RoadEndpoints>(route: T, road: RoadEndpoints): ScoredCandidate<T> {
  return {
    route,
    departureEdits: editDistance(
      normalizeLocation(route.departure),
      normalizeLocation(road.departure),
    ),
    destinationEdits: editDistance(
      normalizeLocation(route.destination),
      normalizeLocation(road.destination),
    ),
  };
}

/** One end equal, the other a single safe typo of it. */
function isTrustedTypo<T extends RoadEndpoints>(
  candidate: ScoredCandidate<T>,
  road: RoadEndpoints,
): boolean {
  const departureExact = candidate.departureEdits === 0;
  const destinationExact = candidate.destinationEdits === 0;

  if (departureExact === destinationExact) {
    return false;
  }

  return departureExact
    ? isSafeTypo(candidate.route.destination, road.destination, candidate.destinationEdits)
    : isSafeTypo(candidate.route.departure, road.departure, candidate.departureEdits);
}

function isSafeTypo(configured: string, given: string, edits: number): boolean {
  const left = normalizeLocation(configured);
  const right = normalizeLocation(given);

  return (
    edits <= FUZZY_ROUTE_RULES.maxEdits &&
    !DIGIT.test(left) &&
    !DIGIT.test(right) &&
    Math.min(left.length, right.length) >= FUZZY_ROUTE_RULES.minLength
  );
}

/** Whether two candidates agree exactly on the same end. */
function sharesAnchor<T>(left: ScoredCandidate<T>, right: ScoredCandidate<T>): boolean {
  return (
    (left.departureEdits === 0 && right.departureEdits === 0) ||
    (left.destinationEdits === 0 && right.destinationEdits === 0)
  );
}

function totalEdits<T>(candidate: ScoredCandidate<T>): number {
  return candidate.departureEdits + candidate.destinationEdits;
}

/** Optimal string alignment: insertions, deletions, substitutions, swaps. */
export function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distance: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)),
  );

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;

      distance[row][column] = Math.min(
        distance[row - 1][column] + 1,
        distance[row][column - 1] + 1,
        distance[row - 1][column - 1] + cost,
      );

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distance[row][column] = Math.min(distance[row][column], distance[row - 2][column - 2] + 1);
      }
    }
  }

  return distance[rows - 1][columns - 1];
}

/**
 * Which configured COMBINATION a pair of Trip roads is.
 *
 * Each road is matched on its own against every Combination leg, with the
 * layers above; a road that is not found, or is ambiguous, leaves the pair
 * unidentified. Then the PAIR decides: the Combination whose two legs are the
 * two matched roads, one leg each. One such Combination is the answer; none is
 * "this pair is not configured"; several are ambiguous, and none is chosen.
 * A shared leg therefore never decides on its own which Combination applies.
 */
export interface CombinationLegs<TLeg extends RoadEndpoints> {
  readonly legs: readonly TLeg[];
}

export type CombinationPairMatch<TGroup, TLeg> =
  | {
      readonly kind: "MATCHED";
      readonly group: TGroup;
      /** The leg each Trip road matched, in the order the roads were given. */
      readonly legs: readonly [TLeg, TLeg];
      /** The weaker of the two roads' methods. */
      readonly method: RouteMatchMethod;
      /** How each road matched its leg, in the order the roads were given. */
      readonly methods: readonly [RouteMatchMethod, RouteMatchMethod];
    }
  | {
      readonly kind: "LEG_NOT_IDENTIFIED" | "PAIR_NOT_CONFIGURED" | "AMBIGUOUS";
      readonly roads: readonly [RoadMatch<TLeg>, RoadMatch<TLeg>];
    };

const METHOD_STRENGTH: Record<RouteMatchMethod, number> = {
  EXACT: 0,
  NORMALIZED: 1,
  FUZZY: 2,
  NOT_FOUND: 3,
  AMBIGUOUS: 3,
};

export function matchCombinationPair<
  TGroup extends CombinationLegs<RoadEndpoints>,
  TLeg extends RoadEndpoints = TGroup["legs"][number],
>(
  roads: readonly [RoadEndpoints, RoadEndpoints],
  groups: readonly TGroup[],
): CombinationPairMatch<TGroup, TLeg> {
  const allLegs = groups.flatMap((group) => group.legs as readonly TLeg[]);
  const matched = [matchRoad(roads[0], allLegs), matchRoad(roads[1], allLegs)] as const;

  if (matched.some((road) => road.matches.length === 0)) {
    return { kind: "LEG_NOT_IDENTIFIED", roads: matched };
  }

  const [first, second] = matched.map((road) => new Set(road.matches));
  const pairs = groups.flatMap((group) => {
    const legs = group.legs as readonly TLeg[];
    const one = legs.find((leg) => first.has(leg));
    const other = legs.find((leg) => second.has(leg) && leg !== one);

    return one && other ? [{ group, legs: [one, other] as const }] : [];
  });

  if (pairs.length !== 1) {
    return { kind: pairs.length === 0 ? "PAIR_NOT_CONFIGURED" : "AMBIGUOUS", roads: matched };
  }

  const method =
    METHOD_STRENGTH[matched[0].method] >= METHOD_STRENGTH[matched[1].method]
      ? matched[0].method
      : matched[1].method;

  return {
    kind: "MATCHED",
    group: pairs[0].group,
    legs: pairs[0].legs,
    method,
    methods: [matched[0].method, matched[1].method],
  };
}
