/**
 * What a terminal is CALLED, and when two names mean the same terminal.
 *
 * ── ONE RULE, EVERY CONSUMER ────────────────────────────────────────────────
 * The canonical route, the RoutePricing lookup and the RouteCost lookup all ask
 * the same question — "is this the same terminal?" — and they must not each
 * answer it. So the rule lives here, in `common`, rather than inside any one of
 * the modules that needs it: a second copy in a route resolver would eventually
 * disagree with the one the route display uses, and the two would describe the
 * same Trip as being on two different routes.
 *
 * Nothing here reads or writes the database. It is a pure comparison over
 * strings the callers already hold.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The `PSA` operator prefix, removed only where it prefixes a quay.
 *
 * ── WHY THE PATTERN IS THIS NARROW ──────────────────────────────────────────
 * The same physical terminal is printed two ways depending on the section a
 * Trip was read from: a COLLECTION document names it in a `Return to Terminal:`
 * address block as `PSA Quay 869`, while a DELIVERY document writes `Quay 869`
 * beside `Terminal:`. They are one place, and matching that treated them as two
 * would leave half the Trips unpriceable on a route the operator has configured.
 *
 * The prefix is stripped ONLY when the token `PSA` stands at the start and is
 * immediately followed by `Quay`. A blunt `replace("PSA", "")` would corrupt any
 * terminal whose real name happens to contain those letters — which is a silent
 * data fault, not a formatting one — and a bare leading `PSA` on some other
 * terminal name is left exactly as it was, because nothing has said the two are
 * the same place.
 * ────────────────────────────────────────────────────────────────────────────
 */
const PSA_QUAY_PREFIX = /^PSA\s+(?=Quay\b)/i;

/** Runs of whitespace, including the newlines an address block can carry. */
const WHITESPACE_RUN = /\s+/g;

/**
 * The terminal as this system names it, whichever way it was written.
 *
 * Whitespace is collapsed and trimmed first, so `PSA   Quay 869` and a value
 * that arrived with a line break both reduce to the same thing before the
 * prefix is considered.
 *
 * The NAME itself is preserved. Case is left exactly as it was written —
 * `Quay 869` stays `Quay 869` — because title-casing or upper-casing a terminal
 * would be renaming it, and only the prefix was declared removable. Matching
 * that must ignore case does so itself; see `isSameTerminal`.
 */
export function toCanonicalTerminal(terminal: string | null): string | null {
  if (terminal === null) {
    return null;
  }

  const collapsed = terminal.replace(WHITESPACE_RUN, " ").trim();

  if (collapsed === "") {
    return null;
  }

  return collapsed.replace(PSA_QUAY_PREFIX, "");
}

/**
 * Whether two terminal strings name the same terminal.
 *
 * Normalization-aware in BOTH directions, which is the whole point: a Trip
 * carrying either spelling matches configuration carrying either spelling.
 * Case is ignored HERE rather than in the canonical value, which keeps a
 * displayed name the document's own while still letting two spellings meet.
 *
 * Two absent terminals are the same absence. An absent one never matches a
 * present one — a route with no departure matches nothing, rather than
 * everything.
 */
export function isSameTerminal(
  left: string | null,
  right: string | null,
): boolean {
  const canonicalLeft = toCanonicalTerminal(left);
  const canonicalRight = toCanonicalTerminal(right);

  if (canonicalLeft === null || canonicalRight === null) {
    return canonicalLeft === canonicalRight;
  }

  return canonicalLeft.toLowerCase() === canonicalRight.toLowerCase();
}
