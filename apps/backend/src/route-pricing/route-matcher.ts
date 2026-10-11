import { toCanonicalTerminal } from "../common/terminal";
import {
  cityEndOf,
  roadForms,
  type RoadForms,
  type TerminalEnd,
} from "./location-forms";
import {
  NAME_SIMILARITY_RULES,
  editDistance,
  isTrustedTypo,
  similarity,
} from "./name-similarity";
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
 *               At the CITY end also the confirmed city equivalents
 *               (`common/city-aliases.ts`: `Antwerp` = `Antwerpen`, `St` =
 *               `Saint`), and — only when the whole name matched nothing — a
 *               qualifier in brackets given on ONE side only (`Melsele` =
 *               `Melsele (Beveren)`); two different qualifiers never match.
 *   FUZZY       one end equal, the other a typo by the calibrated similarity
 *               scores (`name-similarity.ts`) — the city end when the terminal
 *               end is known — with a clear margin over the runner-up.
 *
 * Terminal ALIASES the owner confirmed (`common/terminal-aliases.ts` — `Quay`,
 * `PSA Quay`, `Kaai` for `Quay 869`) are part of NORMALIZED and FUZZY, and only
 * at the TERMINAL end of the Trip's road (`terminalEnd`): never at the city,
 * never as a word inside a longer value, never for another quay number.
 *
 * Nothing else is equivalent: `Kallo` and `Kallo Noord`, a village and the
 * town in whose brackets it stands (`Muizen` / `Mechelen (Muizen)`), `Sint`
 * and `St` — none is an alias. How a road's ends are read: `location-forms.ts`.
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
 * When a typo may still be priced — see `name-similarity.ts` for the scores
 * and their calibration on the real place names. A typo is trusted on ONE end
 * only: the city end when the Trip's terminal end is known (the terminal must
 * match exactly, through its confirmed aliases), either end otherwise. Both
 * ends fuzzy at once is never trusted.
 */
export const FUZZY_ROUTE_RULES = NAME_SIMILARITY_RULES;

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

export { normalizeLocation } from "./location-forms";
export { editDistance } from "./name-similarity";
export type { TerminalEnd } from "./location-forms";

/** A Trip's road as the matcher compares it: in its driving direction. */
export interface TripRoad extends RoadEndpoints {
  /**
   * Which end is the terminal. Absent: neither end is known to be the
   * terminal or the city, so no alias, qualifier or city rule applies.
   */
  readonly terminalEnd?: TerminalEnd;
}

/** The same road for every layer: what a configuration is identified by. */
export function roadKey(road: RoadEndpoints, terminalEnd?: TerminalEnd): string {
  const forms = roadForms(road, terminalEnd);

  return `${forms.departure.full}→${forms.destination.full}`;
}

export function matchRoad<T extends RoadEndpoints>(
  road: TripRoad,
  candidates: readonly T[],
  options: { readonly everySpellingOfTheRoad?: boolean } = {},
): RoadMatch<T> {
  const wanted = roadKey(road, road.terminalEnd);
  const sameRoad = candidates.filter(
    (candidate) => roadKey(candidate, road.terminalEnd) === wanted,
  );
  const exact = candidates.filter((candidate) => isExactRoad(candidate, road));

  if (exact.length > 0) {
    /*
     * For a Combination every configured spelling of the road is a candidate
     * leg — the PAIR decides between them — so an exact spelling must not hide
     * an aliased one that belongs to the right Combination.
     */
    return decide(
      RouteMatchMethod.EXACT,
      options.everySpellingOfTheRoad ? sameRoad : exact,
      [],
      road.terminalEnd,
    );
  }

  if (sameRoad.length > 0) {
    return decide(RouteMatchMethod.NORMALIZED, sameRoad, [], road.terminalEnd);
  }

  const qualified = matchByOptionalQualifier(road, candidates);

  if (qualified.length > 0) {
    return decide(RouteMatchMethod.NORMALIZED, qualified, [], road.terminalEnd);
  }

  return matchFuzzy(road, candidates);
}

/**
 * ── A QUALIFIER IN BRACKETS IS OPTIONAL — UNLESS IT DECIDES ─────────────────
 * Reached only when nothing matched the WHOLE city name, so a full match is
 * always preferred. The terminal end must be equal; at the city end:
 *   the same name, and the qualifier given on one side only — `Melsele` is
 *     `Melsele (Beveren)`, and `Melsele (Beveren)` is `Melsele`;
 *   two DIFFERENT qualifiers are two places — `Melsele (Beveren)` is never
 *     `Melsele (X)`.
 * Several compatible configurations that are different roads are AMBIGUOUS
 * (`decide`): `Melsele` against `Melsele (Beveren)` and `Melsele (X)` picks
 * neither.
 */
function matchByOptionalQualifier<T extends RoadEndpoints>(
  road: TripRoad,
  candidates: readonly T[],
): T[] {
  const cityEnd = cityEndOf(road.terminalEnd);

  if (cityEnd === null || road.terminalEnd === undefined) {
    return [];
  }

  const terminalSide = road.terminalEnd;
  const wanted = roadForms(road, terminalSide);

  return candidates.filter((candidate) => {
    const forms = roadForms(candidate, terminalSide);
    const city = forms[cityEnd];
    const wantedCity = wanted[cityEnd];

    return (
      forms[terminalSide].full === wanted[terminalSide].full &&
      city.base === wantedCity.base &&
      (city.qualifier === null || wantedCity.qualifier === null)
    );
  });
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
  terminalEnd: TerminalEnd | undefined,
): RoadMatch<T> {
  const roads = new Set(found.map((road) => roadKey(road, terminalEnd)));

  return roads.size === 1
    ? { method, matches: found, nearest }
    : { method: RouteMatchMethod.AMBIGUOUS, matches: [], nearest };
}

/** A candidate with the end that may be a typo, and its similarity there. */
interface FuzzyCandidate<T> {
  readonly scored: ScoredCandidate<T>;
  /** The end that is not exact, when exactly one end is. */
  readonly fuzzyEnd: TerminalEnd | null;
  readonly similarity: number;
  readonly trusted: boolean;
}

function matchFuzzy<T extends RoadEndpoints>(
  road: TripRoad,
  candidates: readonly T[],
): RoadMatch<T> {
  const given = roadForms(road, road.terminalEnd);
  const allowedEnd = cityEndOf(road.terminalEnd);
  const assessed = candidates
    .map((route) => assess(route, road, given, allowedEnd))
    .sort((left, right) => right.similarity - left.similarity);
  const nearest = [...assessed]
    .map((candidate) => candidate.scored)
    .sort((left, right) => totalEdits(left) - totalEdits(right))
    .slice(0, NEAREST_REPORTED);
  const best = assessed.find((candidate) => candidate.trusted);

  if (!best) {
    return { method: RouteMatchMethod.NOT_FOUND, matches: [], nearest };
  }

  // Another road on the same exact end that is nearly as close: neither.
  const bestKey = roadKey(best.scored.route, road.terminalEnd);
  const contested = assessed.some(
    (other) =>
      other.fuzzyEnd === best.fuzzyEnd &&
      roadKey(other.scored.route, road.terminalEnd) !== bestKey &&
      other.similarity > best.similarity - NAME_SIMILARITY_RULES.minRunnerUpGap,
  );

  if (contested) {
    return { method: RouteMatchMethod.AMBIGUOUS, matches: [], nearest };
  }

  return decide(
    RouteMatchMethod.FUZZY,
    assessed
      .filter((candidate) => candidate.trusted && roadKey(candidate.scored.route, road.terminalEnd) === bestKey)
      .map((candidate) => candidate.scored.route),
    nearest,
    road.terminalEnd,
  );
}

function assess<T extends RoadEndpoints>(
  route: T,
  road: TripRoad,
  given: RoadForms,
  allowedEnd: TerminalEnd | null,
): FuzzyCandidate<T> {
  const configured = roadForms(route, road.terminalEnd);
  const scored: ScoredCandidate<T> = {
    route,
    departureEdits: editDistance(configured.departure.full, given.departure.full),
    destinationEdits: editDistance(configured.destination.full, given.destination.full),
  };
  const fuzzyEnd: TerminalEnd | null =
    scored.departureEdits === 0 && scored.destinationEdits > 0
      ? "destination"
      : scored.destinationEdits === 0 && scored.departureEdits > 0
        ? "departure"
        : null;

  if (fuzzyEnd === null || (allowedEnd !== null && fuzzyEnd !== allowedEnd)) {
    return { scored, fuzzyEnd, similarity: 0, trusted: false };
  }

  const left = configured[fuzzyEnd].full;
  const right = given[fuzzyEnd].full;

  return {
    scored,
    fuzzyEnd,
    similarity: similarity(left, right),
    trusted: isTrustedTypo(left, right),
  };
}

function totalEdits<T>(candidate: ScoredCandidate<T>): number {
  return candidate.departureEdits + candidate.destinationEdits;
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
  roads: readonly [TripRoad, TripRoad],
  groups: readonly TGroup[],
): CombinationPairMatch<TGroup, TLeg> {
  const allLegs = groups.flatMap((group) => group.legs as readonly TLeg[]);
  const everySpelling = { everySpellingOfTheRoad: true };
  const matched = [
    matchRoad(roads[0], allLegs, everySpelling),
    matchRoad(roads[1], allLegs, everySpelling),
  ] as const;

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
