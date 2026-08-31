/**
 * The one place country names are decided.
 *
 * Kept in a single table because the rule is configuration, not logic: adding a
 * country must be a one-line change in one file, and country handling must
 * never be spread across the extractors.
 *
 * `F` and `FR` both mean France. That is not a typo — the real documents use
 * both, `F-62119 DOURGES` on one order and `FR-59166 Bousbecque` on another,
 * so the map has to accept each. `pdfParserRules.md` prints only `FR-`; the
 * fixtures disagree and win.
 *
 * The country NAMES are the ones the Backend stores on a Trip. They are English
 * because `destination_country` already holds English names.
 */
export const COUNTRY_BY_POSTCODE_PREFIX: Readonly<Record<string, string>> = {
  B: "Belgium",
  BE: "Belgium",
  D: "Germany",
  DE: "Germany",
  F: "France",
  FR: "France",
  L: "Luxembourg",
  LU: "Luxembourg",
  NL: "Netherlands",
};

/**
 * Country names the documents print on their own line, mapped to the spelling
 * the Backend stores.
 *
 * Only exact, known names are accepted. Anything else is treated as not being a
 * country at all, which is what stops a remark in the same column from being
 * stored as one.
 */
const COUNTRY_BY_PRINTED_NAME: Readonly<Record<string, string>> = {
  belgië: "Belgium",
  belgie: "Belgium",
  belgium: "Belgium",
  belgique: "Belgium",
  deutschland: "Germany",
  duitsland: "Germany",
  france: "France",
  frankrijk: "France",
  germany: "Germany",
  luxembourg: "Luxembourg",
  nederland: "Netherlands",
  netherlands: "Netherlands",
};

/** The stored country name for a printed one, or null when unrecognised. */
export function countryFromName(printed: string): string | null {
  return COUNTRY_BY_PRINTED_NAME[printed.trim().toLocaleLowerCase()] ?? null;
}

/**
 * Whether a value is a country name and therefore can never be a city.
 *
 * ── THE INVARIANT THIS EXISTS FOR ───────────────────────────────────────────
 * A destination city must never be France, Belgium, Netherlands, Luxembourg or
 * Germany. A country stored as a destination produces a route like
 * `Quay 869 -> Belgium`, which matches no configured route and tells an
 * operator nothing about where a truck is going.
 *
 * It is ONE predicate rather than a check repeated in each extraction rule,
 * because an invariant that is spelled out in five places is an invariant that
 * holds in four of them after the next change.
 *
 * It reads the same vocabulary every other country decision reads, so the
 * forbidden set cannot drift from the recognised set: the table above defines
 * exactly those five countries, and their local spellings resolve to the same
 * five. Nothing else is a country as far as this parser is concerned.
 *
 * Case-insensitive and trimmed, so `Belgium`, `belgium` and ` BELGIUM ` are one
 * answer.
 */
export function isCountryName(value: string): boolean {
  return countryFromName(value) !== null;
}

/**
 * Splits a trailing country off a line that ends in one: `Kallo, Belgium`.
 *
 * ── WHY THIS IS STRUCTURAL AND NOT A STRING CLEANUP ─────────────────────────
 * Some orders print the city and the country on one line, with a comma or just
 * a space between them. Stored as read, the destination becomes
 * `Kallo, Belgium` and the route reads `Quay 869 -> Kallo, Belgium`.
 *
 * The split happens ONLY when the trailing words are EXACTLY one of the country
 * names the vocabulary above knows, and only when something remains in front of
 * them. That is what makes it structure-aware rather than a `replace(",
 * Belgium", "")`: a city whose name merely contains those letters is untouched,
 * because the check is an exact lookup of the trailing token and not a
 * substring search.
 *
 * Returns null when the line does not end in a country, when nothing precedes
 * it — `Belgium` alone names no city, and inventing one would be worse than
 * reporting the address unreadable — or when what precedes it is itself a
 * country.
 */
export function splitTrailingCountry(
  line: string,
): { readonly rest: string; readonly country: string } | null {
  const trimmed = line.trim();

  /*
   * Longest first: `Netherlands` is one word, but a two-word name would be
   * missed entirely by a single-word check, and the loop must not stop at a
   * shorter suffix that happens to match.
   */
  for (const words of [2, 1]) {
    const parts = trimmed.split(/\s+/);

    if (parts.length <= words) {
      continue;
    }

    const country = countryFromName(parts.slice(-words).join(" "));

    if (country === null) {
      continue;
    }

    // The separator is punctuation of the address, not part of the city.
    const rest = parts.slice(0, -words).join(" ").replace(/[,;]+$/, "").trim();

    if (rest.length === 0 || countryFromName(rest) !== null) {
      return null;
    }

    return { rest, country };
  }

  return null;
}
