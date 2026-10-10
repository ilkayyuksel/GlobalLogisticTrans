import type { RouteMatch, RouteMatchLeg } from "@/lib/api/types";

/**
 * How a stored route match reads on screen — wording and emphasis only.
 *
 * Nothing here matches a route or decides whether one applies: the backend
 * recorded that when it calculated the price, and this only presents what it
 * recorded. Shared by the detail panel and the Ritten Tarief cell so the two
 * never describe one price differently.
 */

/** A road in its driving direction, as it was configured then. */
export function formatRoad(leg: Pick<RouteMatchLeg, "departure" | "destination">): string {
  return `${leg.departure} → ${leg.destination}`;
}

/**
 * Which emphasis a match deserves.
 *
 *   matched      a configured route, matched exactly or after normalisation;
 *   approximate  a configured route, matched despite one typo — worth a look;
 *   unmatched    no reliable route: the route components are € 0;
 *   unknown      an older calculation that recorded nothing.
 */
export type RouteMatchTone = "matched" | "approximate" | "unmatched" | "unknown";

export function routeMatchTone(routeMatch: RouteMatch | null | undefined): RouteMatchTone {
  switch (routeMatch?.method ?? null) {
    case null:
      return "unknown";
    case "NOT_FOUND":
    case "AMBIGUOUS":
      return "unmatched";
    case "FUZZY":
      return "approximate";
    default:
      return "matched";
  }
}

/** The legs in reading order: Leg 1 before Leg 2. */
export function legsInOrder(routeMatch: RouteMatch): RouteMatchLeg[] {
  return [...routeMatch.legs].sort(
    (left, right) => (left.legPosition ?? 0) - (right.legPosition ?? 0),
  );
}
