/**
 * The location code the operator's sheet prints for a delivery destination.
 *
 * ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────────────
 * This is EXPORT VOCABULARY. It is a spelling the operator uses in one
 * spreadsheet column, nothing more.
 *
 * It is NOT terminal master data, NOT a canonical-name layer, and NOT a
 * mechanism anything outside this export may consult. The terminal a transport
 * order printed IS the terminal, everywhere in this system, and pricing matches
 * routes on the stored city by exact string. Neither of those facts changes
 * because a spreadsheet column spells a destination differently.
 *
 * Concretely, this map must never be used to:
 *   * rename, normalise or resolve a terminal;
 *   * key a RoutePricing or RouteCost lookup;
 *   * decide anything an operator sees outside the Excel export.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHY IT IS A LIST AND NOT A RULE ─────────────────────────────────────────
 * The codes cannot be computed. `Lessines` becomes `BEBAXLES` and `Zeebrugge`
 * becomes `BEQ869`; no rule connects the two, and the second one collides with
 * the quay's own code. They are simply the strings the operator writes, so they
 * are simply listed, and a destination that is not listed keeps its own name.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Destination city → the code the sheet prints for it.
 *
 * Keys are upper-cased so a lookup does not depend on how a document happened
 * to capitalise a city. Nothing else about the stored city is touched: the
 * value shown when there is no entry is the city exactly as stored.
 *
 * Extending this is one line. Adding a destination here changes only what the
 * Excel export prints.
 */
const LOCATION_CODES_BY_DESTINATION: ReadonlyMap<string, string> = new Map([
  ["ZEEBRUGGE", "BEQ869"],
  ["LESSINES", "BEBAXLES"],
]);

/** The prefix that precedes a code in the Endpoint column. */
export const LOCATION_PREFIX = "LOCATION";

/**
 * The Endpoint label for a destination, or null when none is configured.
 *
 * Null means "this destination has no export code" — the caller then shows the
 * stored city, which is the Trip's own value rather than an invented one.
 */
export function toLocationLabel(destinationCity: string): string | null {
  const code = LOCATION_CODES_BY_DESTINATION.get(
    destinationCity.trim().toUpperCase(),
  );

  return code === undefined ? null : `${LOCATION_PREFIX} ${code}`;
}
