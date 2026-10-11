/**
 * How alike two place names are — the scores behind a trusted typo.
 *
 * ── TWO MEASURES, BOTH REQUIRED ─────────────────────────────────────────────
 *   similarity  1 − (edits ÷ longer length), the edits being optimal string
 *               alignment: a letter added, removed, changed, or two
 *               neighbours swapped. How much of the name had to change.
 *   ordered     2 × (longest common subsequence) ÷ (both lengths): how many
 *               letters the two share IN THE SAME ORDER. Scattered common
 *               letters do not count; a shared fragment of a longer name
 *               does not reach it either, because the rest is missing.
 * Plus: the same first letter, and no digits at all — a number is not
 * misspelled into another one.
 *
 * ── CALIBRATED ON THE REAL NAMES (OCTOBER 2026) ─────────────────────────────
 * Over the 90 different real places in the customer's price list, the planning
 * sheets, the captures and the documents, the two closest DIFFERENT places
 * score 0.750 (`evergem` / `wevelgem`, `genk` / `gent`), the next 0.714
 * (`beerse` / `beernem`, `avelgem` / `evergem`). Known one-letter typos score
 * 0.857 (`lokren`) to 0.938 (`sint gilis waas`). So:
 *   both measures ≥ 0.85 — 0.10 above the closest real pair; one edit is
 *     trusted from seven letters, two only from fourteen;
 *   the runner-up (another road on the same exact end) must score at least
 *     0.10 less, or the match is AMBIGUOUS.
 * The calibration test re-checks every pair of real names against this rule.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const NAME_SIMILARITY_RULES = {
  minSimilarity: 0.85,
  minOrderedSimilarity: 0.85,
  minRunnerUpGap: 0.1,
} as const;

const DIGIT = /\d/;

/** Optimal string alignment: insertions, deletions, substitutions, swaps. */
export function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distance: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)),
  );

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;

      distance[row][column] = Math.min(
        distance[row - 1][column] + 1,
        distance[row][column - 1] + 1,
        distance[row - 1][column - 1] + cost,
      );

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        distance[row][column] = Math.min(distance[row][column], distance[row - 2][column - 2] + 1);
      }
    }
  }

  return distance[rows - 1][columns - 1];
}

/** The longest run of letters both names share in the same order. */
export function longestCommonSubsequence(left: string, right: string): number {
  let previous = new Array<number>(right.length + 1).fill(0);

  for (const letter of left) {
    const current = [0];

    for (let column = 1; column <= right.length; column += 1) {
      current[column] =
        letter === right[column - 1]
          ? previous[column - 1] + 1
          : Math.max(previous[column], current[column - 1]);
    }

    previous = current;
  }

  return previous[right.length];
}

/** 1 − edits ÷ longer length; 1 for two equal names. */
export function similarity(left: string, right: string): number {
  const longer = Math.max(left.length, right.length);

  return longer === 0 ? 1 : 1 - editDistance(left, right) / longer;
}

/** The share of letters both names have in the same order. */
export function orderedSimilarity(left: string, right: string): number {
  const total = left.length + right.length;

  return total === 0 ? 1 : (2 * longestCommonSubsequence(left, right)) / total;
}

/** Whether `given` may be priced as a typo of `configured` (both normalised). */
export function isTrustedTypo(configured: string, given: string): boolean {
  return (
    configured !== given &&
    !DIGIT.test(configured) &&
    !DIGIT.test(given) &&
    configured[0] === given[0] &&
    similarity(configured, given) >= NAME_SIMILARITY_RULES.minSimilarity &&
    orderedSimilarity(configured, given) >= NAME_SIMILARITY_RULES.minOrderedSimilarity
  );
}
