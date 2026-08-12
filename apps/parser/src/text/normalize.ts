import { COLUMN_TOLERANCE, Fragment, ROW_TOLERANCE } from "./extract";

/**
 * Querying positioned text.
 *
 * Every extractor asks one of three questions, and they are all here so the
 * geometry rules exist once rather than in each field:
 *
 *   - where is this label?
 *   - what sits to its RIGHT on the same row?      (`Cntr type:  45PH`)
 *   - what sits BELOW it in the same column?       (a terminal address block)
 *
 * The Eucon form is multi-column, so "the next fragment" is not a meaningful
 * question — the next fragment is often an unrelated value from another column.
 */

export function fragmentsOnPage(
  fragments: readonly Fragment[],
  page: number,
): Fragment[] {
  return fragments.filter((fragment) => fragment.page === page);
}

/** The first fragment whose text is exactly `label`. */
export function findLabel(
  fragments: readonly Fragment[],
  label: string,
): Fragment | null {
  return fragments.find((fragment) => fragment.text === label) ?? null;
}

/** The first fragment whose text begins with `prefix`. */
export function findStartingWith(
  fragments: readonly Fragment[],
  prefix: string,
): Fragment | null {
  return fragments.find((fragment) => fragment.text.startsWith(prefix)) ?? null;
}

/** Every fragment matching `pattern`, in reading order. */
export function findAllMatching(
  fragments: readonly Fragment[],
  pattern: RegExp,
): Fragment[] {
  return fragments.filter((fragment) => pattern.test(fragment.text));
}

/**
 * Fragments to the right of `anchor` on the same row, nearest first.
 *
 * A label and its value are not always emitted at an identical y — a fraction
 * of a point of drift is normal — so the row is a band, not an exact value.
 */
export function valuesRightOf(
  fragments: readonly Fragment[],
  anchor: Fragment,
): Fragment[] {
  return fragments
    .filter(
      (fragment) =>
        fragment !== anchor &&
        fragment.page === anchor.page &&
        Math.abs(fragment.y - anchor.y) <= ROW_TOLERANCE &&
        fragment.x > anchor.x,
    )
    .sort((left, right) => left.x - right.x);
}

/**
 * Fragments below `anchor` in the same column, top-down.
 *
 * `column` defaults to the anchor's own x, which is what a block label like
 * `Return to Terminal:` needs. A label whose values are indented passes the
 * value column explicitly.
 */
export function valuesBelow(
  fragments: readonly Fragment[],
  anchor: Fragment,
  column: number = anchor.x,
): Fragment[] {
  return fragments
    .filter(
      (fragment) =>
        fragment.page === anchor.page &&
        fragment.y < anchor.y - ROW_TOLERANCE &&
        Math.abs(fragment.x - column) <= COLUMN_TOLERANCE,
    )
    .sort((left, right) => right.y - left.y);
}

/** Joins fragments into one raw string, preserving reading order. */
export function joinText(fragments: readonly Fragment[]): string {
  return fragments.map((fragment) => fragment.text).join(" ").trim();
}

/**
 * Title-cases a place name: `DOURGES` becomes `Dourges`.
 *
 * Deliberately mechanical, with no dictionary and no exceptions. The rule has
 * to be reproducible and explainable years from now, and a name the operator
 * spells differently is a configuration question rather than something the
 * parser should guess at. Hyphens and apostrophes start a new word, so
 * `SAINT-OMER` becomes `Saint-Omer`.
 */
export function toTitleCase(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/(^|[\s\-'’])([\p{L}])/gu, (_match, boundary: string, letter: string) =>
      boundary + letter.toLocaleUpperCase(),
    );
}
