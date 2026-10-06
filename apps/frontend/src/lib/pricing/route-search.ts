import type {
  CombinationRouteConfiguration,
  RouteConfiguration,
} from "@/lib/api/route-configuration";

/**
 * Finding routes on the Routeprijzen page by what an operator remembers of
 * them: a piece of Van or Naar — "869", "GENT".
 *
 * ── A FILTER OF WHAT IS ALREADY ON SCREEN ───────────────────────────────────
 * Both lists are loaded whole (configuration is not paginated), so searching is
 * filtering in the browser: no request per keystroke and no second notion of
 * which routes exist. It is display only — nothing here decides which route a
 * Trip is priced against; that is the backend's canonical matching.
 *
 * Case-insensitive, and a plain "contains": the operator types part of a
 * name. Surrounding spaces are ignored, and an empty search matches everything.
 */

function normalise(text: string): string {
  return text.trim().toLocaleLowerCase();
}

function mentions(text: string, query: string): boolean {
  return normalise(text).includes(query);
}

/** Whether an ordinary route's Van or Naar contains the search. */
export function matchesRouteSearch(route: RouteConfiguration, search: string): boolean {
  const query = normalise(search);

  return (
    query === "" ||
    mentions(route.departure, query) ||
    mentions(route.destination, query)
  );
}

/**
 * Whether either leg of a Combination contains the search, in Van or Naar.
 *
 * The Combination is ONE result: a match in either leg shows the whole record,
 * never one leg on its own. Over ST has no Van or Naar and is not searched.
 */
export function matchesCombinationSearch(
  combination: CombinationRouteConfiguration,
  search: string,
): boolean {
  return (
    normalise(search) === "" ||
    combination.legs.some((leg) => matchesRouteSearch(leg, search))
  );
}
