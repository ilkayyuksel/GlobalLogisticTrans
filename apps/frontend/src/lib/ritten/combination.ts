/**
 * How a TripGroup is shown in a list.
 *
 * A TripGroup has an id and nothing else — no number, no name, no colour. So
 * both the label and the colour here are DERIVED FROM THAT ID and are
 * presentation only. Nothing is invented: the label is an abbreviation of the
 * real identifier, which is why it is stable across pages, sessions and users,
 * and why two people looking at the same Combination see the same marker.
 *
 * A human-friendly group number would have to come from the backend; there is
 * no column for one today.
 */

/** How many characters of the id the short label keeps. */
const LABEL_HEX_LENGTH = 4;

/** Matches the number of `--color-combination-*` tokens. */
export const COMBINATION_COLOR_COUNT = 6;

/** "G-4F2A" — short enough for a table cell, long enough to stay unique. */
export function combinationLabel(tripGroupId: string): string {
  const hex = tripGroupId.replace(/-/g, "").slice(0, LABEL_HEX_LENGTH);

  return `G-${hex.toUpperCase()}`;
}

/**
 * Which of the six colours this group gets, 1-based.
 *
 * A sum of character codes rather than a random pick: the same group must land
 * on the same colour every time it is rendered.
 */
export function combinationColorIndex(tripGroupId: string): number {
  let total = 0;

  for (const character of tripGroupId) {
    total += character.charCodeAt(0);
  }

  return (total % COMBINATION_COLOR_COUNT) + 1;
}

/**
 * The Tailwind classes for that colour.
 *
 * Written out in full because Tailwind scans source text: a class assembled at
 * runtime as `bg-combination-${index}` would never be generated into the CSS.
 */
const COMBINATION_CLASSES: Record<number, string> = {
  1: "bg-combination-1/10 text-combination-1 ring-combination-1/30",
  2: "bg-combination-2/10 text-combination-2 ring-combination-2/30",
  3: "bg-combination-3/10 text-combination-3 ring-combination-3/30",
  4: "bg-combination-4/10 text-combination-4 ring-combination-4/30",
  5: "bg-combination-5/10 text-combination-5 ring-combination-5/30",
  6: "bg-combination-6/10 text-combination-6 ring-combination-6/30",
};

export function combinationClasses(tripGroupId: string): string {
  return COMBINATION_CLASSES[combinationColorIndex(tripGroupId)];
}

/**
 * The same six colours, as Excel needs them: solid ARGB, not CSS tokens.
 *
 * ── ONE MAPPING, TWO REPRESENTATIONS ────────────────────────────────────────
 * The INDEX is the shared part and the only part that decides anything —
 * `combinationColorIndex` derives it from the group id, so a Combination gets
 * the same colour on screen and on paper, on every page, on every day it spans
 * and for every user. What differs is only how a colour is expressed: the
 * interface needs Tailwind classes bound to `--color-combination-*`, a
 * spreadsheet needs a fill.
 *
 * The values are those tokens' own RGB, read from `globals.css`, tinted towards
 * white. A full-strength violet behind a whole row would be unreadable on
 * paper; the tint is the same idea as the interface's `/10` opacity.
 */
const COMBINATION_FILLS: Record<number, string> = {
  1: "FFE9E1FB", // violet  124 58 237
  2: "FFDCF0EE", // teal    13 148 136
  3: "FFF7E9D5", // amber   217 119 6
  4: "FFF8DFEC", // pink    219 39 119
  5: "FFDFDDF7", // indigo  79 70 229
  6: "FFE6F0D9", // lime    101 163 13
};

/**
 * The row fill for a group, or null for a Trip that belongs to none.
 *
 * Null rather than white: a standalone Trip must keep the sheet's own
 * background, and painting it white would flatten the grid lines the office
 * reads the table by.
 */
export function combinationFillArgb(tripGroupId: string | null): string | null {
  return tripGroupId === null
    ? null
    : COMBINATION_FILLS[combinationColorIndex(tripGroupId)];
}
