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
