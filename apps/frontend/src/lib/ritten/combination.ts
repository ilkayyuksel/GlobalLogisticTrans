import { spreadOrder, type Rgb } from "./combination-spread";

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
 *
 * ── THE COLOUR DEPENDS ON THE COMPANY IT KEEPS ──────────────────────────────
 * Which colour a group gets is not decided by its id alone. Two groups on one day
 * must be plainly different, and only something that can see both of them can
 * promise that — see `combinationPalette`. The id still decides which Trips are
 * the SAME group; it no longer decides, by itself, which colour that is.
 */

/** How many characters of the id the short label keeps. */
const LABEL_HEX_LENGTH = 4;

/**
 * The palette's own colours, as `globals.css` states them.
 *
 * The light theme's values: the dark theme carries lighter variants of the same
 * ten hues, so which colours look alike is the same question in both. These are
 * the IDENTITY of each family — the interface renders them at a tenth strength
 * behind text and the spreadsheet lays them over white, and both derive from
 * here.
 */
export const COMBINATION_RGB: readonly Rgb[] = [
  { red: 37, green: 99, blue: 235 }, // 1  blue
  { red: 234, green: 88, blue: 12 }, // 2  orange
  { red: 22, green: 163, blue: 74 }, // 3  green
  { red: 192, green: 38, blue: 211 }, // 4  magenta
  { red: 8, green: 145, blue: 178 }, // 5  cyan
  { red: 220, green: 38, blue: 38 }, // 6  red
  { red: 124, green: 58, blue: 237 }, // 7  violet
  { red: 202, green: 138, blue: 4 }, // 8  amber
  { red: 219, green: 39, blue: 119 }, // 9  pink
  { red: 101, green: 163, blue: 13 }, // 10 lime
];

/**
 * Blue first, because the first group of a day should read as a primary.
 *
 * Only the starting point is chosen; every colour after it is decided by how
 * far it sits from the ones already handed out.
 */
const FIRST_COLOUR_INDEX = 0;

/**
 * The order the palette is handed out in: least alike first.
 *
 * DERIVED from the colours rather than written down, so it cannot fall out of
 * step with them. Editing a token in `globals.css` and here changes the order
 * with it, which a hand-kept list would not do — and a stale order is exactly
 * how a list of ten distinct colours starts handing out two greens in a row.
 */
export const COMBINATION_SPREAD_ORDER = spreadOrder(
  COMBINATION_RGB,
  FIRST_COLOUR_INDEX,
);

/** Sorts after any real planning date, so undated groups come last. */
const UNSCHEDULED = "9999-12-31";

/**
 * Matches the number of `--color-combination-*` tokens.
 *
 * TEN. The earlier six held violet beside indigo and teal beside lime, so two
 * groups on one screen could land on shades of a single colour — which is exactly
 * what a group marker must never do. Beyond ten, colours repeat: a tenth distinct
 * hue that still takes dark text is about the practical limit, and reusing one is
 * better than adding a colour nobody can tell from its neighbour.
 *
 * The ORDER they are handed out in is no longer this list's order — that is
 * `COMBINATION_SPREAD_ORDER`, computed from the colours themselves.
 */
export const COMBINATION_COLOR_COUNT = 10;

/** "G-4F2A" — short enough for a table cell, long enough to stay unique. */
export function combinationLabel(tripGroupId: string): string {
  const hex = tripGroupId.replace(/-/g, "").slice(0, LABEL_HEX_LENGTH);

  return `G-${hex.toUpperCase()}`;
}

/**
 * Which colour this group gets when nothing is known about the others, 1-based.
 *
 * A sum of character codes rather than a random pick: the same group lands on the
 * same colour every time it is rendered, anywhere, with no context at all.
 *
 * ── AND WHY THAT IS NOT ENOUGH ON ITS OWN ─────────────────────────────────────
 * It spreads groups evenly over the palette and says nothing about which groups
 * are seen TOGETHER. Two groups on one day can therefore land on green and lime —
 * the two entries that look most alike of any pair in the palette — and an
 * operator sees two greens. Which is the whole point of a group colour lost.
 *
 * So this is the FALLBACK, used for a group whose neighbours are unknown, and
 * `combinationPalette` is what a list or an export uses.
 */
export function combinationColorIndex(tripGroupId: string): number {
  let total = 0;

  for (const character of tripGroupId) {
    total += character.charCodeAt(0);
  }

  return (total % COMBINATION_COLOR_COUNT) + 1;
}

/** Where one group was seen: enough of a Trip to place it on a day. */
export interface GroupOccurrence {
  readonly tripGroupId: string | null;
  readonly planningDate: string | null;
}

/**
 * The colours for one set of groups seen together.
 *
 * The same object answers for the interface and for a spreadsheet, so a
 * Combination cannot be blue in the list and green on paper.
 */
export interface CombinationPalette {
  /** 1-based, and the same for a group however often it is asked for. */
  readonly indexOf: (tripGroupId: string) => number;
  readonly classesFor: (tripGroupId: string) => string;
  readonly fillArgb: (tripGroupId: string | null) => string | null;
}

/**
 * Assigns colours to the groups of one visible period.
 *
 * ── THE PROBLEM IT SOLVES ───────────────────────────────────────────────────
 * A colour derived from a group's id alone knows nothing about the other groups
 * on the screen, so two of them can land on the palette's two greens. Nothing is
 * wrong with either colour; they are simply wrong TOGETHER, and only something
 * that sees both can tell.
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────
 * The groups of the period are put in a fixed order and handed the palette in
 * spread order — least alike first. Two consequences follow from the ordering
 * being BY DAY:
 *
 *   same day   groups of one day are consecutive in the order, so they receive
 *              consecutive spread slots: the colours that are hardest to confuse.
 *   same week  every group of the period gets a slot of its own until the palette
 *              runs out, so Monday's group and Friday's differ as well.
 *
 * ── AND IT DOES NOT WOBBLE ──────────────────────────────────────────────────
 * The order is (earliest day the group appears, then group id) — never the order
 * rows arrived in, were sorted into, or are exported in. So a refresh, a change
 * of sort, a change of export order and a second render all produce the same
 * colours, and one group keeps one colour across every day it spans.
 *
 * A group the period does not contain falls back to `combinationColorIndex`,
 * which is what keeps a dialog for something off-screen from having no colour at
 * all.
 */
export function combinationPalette(
  occurrences: readonly GroupOccurrence[],
): CombinationPalette {
  const indexByGroup = assignColours(occurrences);

  const indexOf = (tripGroupId: string): number =>
    indexByGroup.get(tripGroupId) ?? combinationColorIndex(tripGroupId);

  return {
    indexOf,
    classesFor: (tripGroupId) => COMBINATION_CLASSES[indexOf(tripGroupId)],
    fillArgb: (tripGroupId) =>
      tripGroupId === null ? null : COMBINATION_FILLS[indexOf(tripGroupId)],
  };
}

/** Each group of the period, with the palette slot its position earns. */
function assignColours(
  occurrences: readonly GroupOccurrence[],
): Map<string, number> {
  const firstDayByGroup = new Map<string, string>();

  for (const occurrence of occurrences) {
    if (occurrence.tripGroupId === null) {
      continue;
    }

    const day = occurrence.planningDate ?? UNSCHEDULED;
    const known = firstDayByGroup.get(occurrence.tripGroupId);

    if (known === undefined || day < known) {
      firstDayByGroup.set(occurrence.tripGroupId, day);
    }
  }

  const ordered = [...firstDayByGroup.entries()].sort(
    ([leftId, leftDay], [rightId, rightDay]) =>
      leftDay === rightDay
        ? leftId.localeCompare(rightId)
        : leftDay.localeCompare(rightDay),
  );

  return new Map(
    ordered.map(([tripGroupId], position) => [
      tripGroupId,
      // The slot is 0-based in the spread order and 1-based as a colour.
      COMBINATION_SPREAD_ORDER[position % COMBINATION_COLOR_COUNT] + 1,
    ]),
  );
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
  7: "bg-combination-7/10 text-combination-7 ring-combination-7/30",
  8: "bg-combination-8/10 text-combination-8 ring-combination-8/30",
  9: "bg-combination-9/10 text-combination-9 ring-combination-9/30",
  10: "bg-combination-10/10 text-combination-10 ring-combination-10/30",
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
 * The values are those tokens' own RGB, read from `globals.css`, each laid over
 * white at 18% strength. A full-strength hue behind a whole row would be
 * unreadable on paper; this is the same idea as the interface's `/10` opacity,
 * and it keeps every fill light enough for the sheet's black text while leaving
 * the ten hues plainly different from one another.
 */
const COMBINATION_FILLS: Record<number, string> = {
  1: "FFD8E3FB", // blue     37 99 235
  2: "FFFBE1D3", // orange   234 88 12
  3: "FFD5EEDE", // green    22 163 74
  4: "FFF4D8F7", // magenta  192 38 211
  5: "FFD3EBF1", // cyan     8 145 178
  6: "FFF9D8D8", // red      220 38 38
  7: "FFE7DCFC", // violet   124 58 237
  8: "FFF5EAD2", // amber    202 138 4
  9: "FFF9D8E7", // pink     219 39 119
  10: "FFE3EED3", // lime     101 163 13
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
