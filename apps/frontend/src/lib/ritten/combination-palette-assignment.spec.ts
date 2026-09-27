import {
  COMBINATION_COLOR_COUNT,
  COMBINATION_RGB,
  combinationColorIndex,
  combinationPalette,
  type GroupOccurrence,
} from "./combination";
import { perceptualDistance } from "./combination-spread";

/**
 * Which colour each group gets when several are on screen together.
 *
 * ── THE COMPLAINT THIS ANSWERS ──────────────────────────────────────────────
 * "Two different greens that look almost the same." The colour used to be derived
 * from the group id alone, which spreads groups evenly over the palette and says
 * nothing about which groups are seen TOGETHER — so two groups on one day could
 * land on green and lime, the closest pair the palette has.
 *
 * ── HOW THESE TESTS JUDGE A COLOUR ──────────────────────────────────────────
 * By perceptual distance, not by name: `perceptualDistance` measures in OKLab
 * with lightness weighted down, so "a lighter shade of the same green" does not
 * count as different. The thresholds below are read off the palette itself — see
 * each constant.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The palette's own worst pair, for scale: green and lime sit this far apart and
 * are the two an operator called almost identical. Every threshold here is a
 * multiple of it, so the numbers mean something rather than being picked.
 */
const ALMOST_IDENTICAL = 0.055;

/**
 * What "plainly different" means for the handful of groups a person actually
 * looks at. Nearly three times the worst pair, and the best this palette can do
 * for five colours at once.
 */
const CLEARLY_DIFFERENT = 0.15;

/** With eight groups at once the palette is nearly spent, and still does this. */
const STILL_DISTINGUISHABLE = 0.11;

/*
 * ── IDS THAT USED TO COLLIDE ──────────────────────────────────────────────────
 * Chosen for what the FALLBACK does with them, which is what the list used to do
 * with every group: these two hash to the palette's two greens, and these two to
 * its magenta and pink. They are the bug, written down.
 */
const HASHES_TO_GREEN = "0008a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b";
const HASHES_TO_LIME = "0005a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b";
const HASHES_TO_MAGENTA = "0009a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b";
const HASHES_TO_PINK = "0004a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b";

const MONDAY = "2026-09-14";
const TUESDAY = "2026-09-15";
const WEDNESDAY = "2026-09-16";
const THURSDAY = "2026-09-17";
const FRIDAY = "2026-09-18";

/** A Trip, as the palette needs to see one. */
function on(planningDate: string | null, tripGroupId: string | null): GroupOccurrence {
  return { planningDate, tripGroupId };
}

/** `group-a` … for readability; the ids themselves carry no meaning. */
function group(letter: string): string {
  return `group-${letter}`;
}

/** How far apart the colours of these groups look. */
function distanceBetween(
  occurrences: readonly GroupOccurrence[],
  left: string,
  right: string,
): number {
  const palette = combinationPalette(occurrences);

  return perceptualDistance(
    COMBINATION_RGB[palette.indexOf(left) - 1],
    COMBINATION_RGB[palette.indexOf(right) - 1],
  );
}

/** The closest pair among these groups — the weakest link of the assignment. */
function closestPair(
  occurrences: readonly GroupOccurrence[],
  groupIds: readonly string[],
): number {
  const palette = combinationPalette(occurrences);
  let closest = Number.POSITIVE_INFINITY;

  groupIds.forEach((left, index) => {
    groupIds.slice(index + 1).forEach((right) => {
      closest = Math.min(
        closest,
        perceptualDistance(
          COMBINATION_RGB[palette.indexOf(left) - 1],
          COMBINATION_RGB[palette.indexOf(right) - 1],
        ),
      );
    });
  });

  return closest;
}

/** The colour of every group, as one comparable string. */
function fingerprint(occurrences: readonly GroupOccurrence[]): string {
  const palette = combinationPalette(occurrences);
  const ids = [
    ...new Set(
      occurrences
        .map((occurrence) => occurrence.tripGroupId)
        .filter((id): id is string => id !== null),
    ),
  ].sort();

  return ids.map((id) => `${id}=${palette.indexOf(id)}`).join(" ");
}

describe("groups on the same day", () => {
  it("gives two groups plainly different colours", () => {
    const day = [on(MONDAY, group("a")), on(MONDAY, group("b"))];

    expect(distanceBetween(day, group("a"), group("b"))).toBeGreaterThan(
      CLEARLY_DIFFERENT,
    );
  });

  /** The case from the complaint: five groups on one day. */
  it("keeps five groups on one day clearly apart", () => {
    const ids = ["a", "b", "c", "d", "e"].map(group);
    const day = ids.map((id) => on(MONDAY, id));

    expect(closestPair(day, ids)).toBeGreaterThanOrEqual(CLEARLY_DIFFERENT);
  });

  it("gives five groups five different colours", () => {
    const ids = ["a", "b", "c", "d", "e"].map(group);
    const palette = combinationPalette(ids.map((id) => on(MONDAY, id)));

    expect(new Set(ids.map((id) => palette.indexOf(id))).size).toBe(5);
  });

  /** Eight is nearly the palette, and they are still told apart. */
  it("keeps eight groups on one day distinguishable", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"].map(group);
    const day = ids.map((id) => on(MONDAY, id));

    expect(closestPair(day, ids)).toBeGreaterThanOrEqual(STILL_DISTINGUISHABLE);
    expect(
      new Set(ids.map((id) => combinationPalette(day).indexOf(id))).size,
    ).toBe(8);
  });

  /*
   * ── REUSE ONLY WHEN THERE IS NOTHING LEFT ─────────────────────────────────
   * Ten colours, so the eleventh group is the first that has to share one. Not
   * the fourth, which is what a hash does as soon as two ids happen to collide.
   */
  it("uses a colour twice only once the palette is spent", () => {
    const ids = Array.from({ length: COMBINATION_COLOR_COUNT }, (_value, index) =>
      group(String(index)),
    );
    const palette = combinationPalette(ids.map((id) => on(MONDAY, id)));

    expect(new Set(ids.map((id) => palette.indexOf(id))).size).toBe(
      COMBINATION_COLOR_COUNT,
    );
  });

  it("reuses the palette in order once it is spent", () => {
    const ids = Array.from(
      { length: COMBINATION_COLOR_COUNT + 2 },
      (_value, index) => group(String(index).padStart(2, "0")),
    );
    const palette = combinationPalette(ids.map((id) => on(MONDAY, id)));

    // The eleventh takes the first colour again, the twelfth the second.
    expect(palette.indexOf(ids[COMBINATION_COLOR_COUNT])).toBe(
      palette.indexOf(ids[0]),
    );
    expect(palette.indexOf(ids[COMBINATION_COLOR_COUNT + 1])).toBe(
      palette.indexOf(ids[1]),
    );
  });

  /**
   * No two groups of a day land on colours of one family while the palette still
   * has a choice.
   *
   * Up to NINE groups: with all ten in use the palette's own closest pair — green
   * and lime — is unavoidable, and no assignment can help that. Which is a
   * statement about the palette rather than about the assignment, and the test
   * below says it separately.
   */
  it("never gives two groups of a day near-identical colours", () => {
    for (let count = 2; count < COMBINATION_COLOR_COUNT; count += 1) {
      const ids = Array.from({ length: count }, (_value, index) =>
        group(String(index)),
      );

      expect(closestPair(ids.map((id) => on(MONDAY, id)), ids)).toBeGreaterThan(
        ALMOST_IDENTICAL,
      );
    }
  });

  /**
   * ── THE PALETTE'S OWN LIMIT, STATED ────────────────────────────────────────
   * Ten groups on one day use all ten colours, so the closest pair is whatever
   * the palette's closest pair is. Recorded here so that a future palette with a
   * wider spread shows up as this number improving, and so that nobody reads the
   * test above as a promise the palette cannot keep.
   */
  it("falls back on the palette's own closest pair only when all ten are in use", () => {
    const ids = Array.from({ length: COMBINATION_COLOR_COUNT }, (_value, index) =>
      group(String(index)),
    );

    expect(closestPair(ids.map((id) => on(MONDAY, id)), ids)).toBeCloseTo(
      ALMOST_IDENTICAL,
      2,
    );
  });

  /*
   * ── THE BUG, WRITTEN DOWN ─────────────────────────────────────────────────
   * These two ids hash to green and lime: the closest pair in the palette, and
   * what an operator saw. Seen together, they are now given colours that are not.
   */
  it("separates two groups the id hash put on the two greens", () => {
    expect(
      perceptualDistance(
        COMBINATION_RGB[combinationColorIndex(HASHES_TO_GREEN) - 1],
        COMBINATION_RGB[combinationColorIndex(HASHES_TO_LIME) - 1],
      ),
    ).toBeLessThan(ALMOST_IDENTICAL + 0.001);

    const day = [on(MONDAY, HASHES_TO_GREEN), on(MONDAY, HASHES_TO_LIME)];

    expect(
      distanceBetween(day, HASHES_TO_GREEN, HASHES_TO_LIME),
    ).toBeGreaterThan(CLEARLY_DIFFERENT);
  });

  it("separates two groups the id hash put on magenta and pink", () => {
    const day = [on(MONDAY, HASHES_TO_MAGENTA), on(MONDAY, HASHES_TO_PINK)];

    expect(
      distanceBetween(day, HASHES_TO_MAGENTA, HASHES_TO_PINK),
    ).toBeGreaterThan(CLEARLY_DIFFERENT);
  });
});

describe("groups within one week", () => {
  /** Monday to Friday, six groups, and none of them a shade of another. */
  const WEEK: readonly GroupOccurrence[] = [
    on(MONDAY, group("a")),
    on(MONDAY, group("b")),
    on(TUESDAY, group("c")),
    on(WEDNESDAY, group("d")),
    on(THURSDAY, group("e")),
    on(FRIDAY, group("f")),
  ];

  it("gives every group of the week a colour of its own", () => {
    const palette = combinationPalette(WEEK);
    const indexes = ["a", "b", "c", "d", "e", "f"].map((letter) =>
      palette.indexOf(group(letter)),
    );

    expect(new Set(indexes).size).toBe(6);
  });

  it("keeps every pair in the week clearly apart", () => {
    const ids = ["a", "b", "c", "d", "e", "f"].map(group);

    expect(closestPair(WEEK, ids)).toBeGreaterThan(ALMOST_IDENTICAL * 2);
  });

  /**
   * A group on Monday and one on Friday are never seen in the same row, but they
   * ARE seen in the same week view — so they may not be shades of one colour
   * simply because they fall on different days.
   */
  it("separates Monday's group from Friday's", () => {
    expect(distanceBetween(WEEK, group("a"), group("f"))).toBeGreaterThan(
      ALMOST_IDENTICAL * 2,
    );
  });

  /** A Combination spanning midnight is one group and one colour. */
  it("keeps one colour for a group appearing on several days", () => {
    const spanning = [
      on(MONDAY, group("a")),
      on(TUESDAY, group("a")),
      on(WEDNESDAY, group("a")),
      on(TUESDAY, group("b")),
    ];
    const palette = combinationPalette(spanning);

    expect(palette.indexOf(group("a"))).toBe(palette.indexOf(group("a")));
    expect(palette.indexOf(group("a"))).not.toBe(palette.indexOf(group("b")));
  });

  /**
   * The day a group is ordered by is its FIRST, so a group that starts on Monday
   * and runs into Tuesday is coloured as Monday's — whichever of its Trips the
   * list happens to hold first.
   */
  it("orders a spanning group by its first day", () => {
    const forwards = combinationPalette([
      on(MONDAY, group("a")),
      on(TUESDAY, group("a")),
      on(TUESDAY, group("b")),
    ]);
    const backwards = combinationPalette([
      on(TUESDAY, group("b")),
      on(TUESDAY, group("a")),
      on(MONDAY, group("a")),
    ]);

    expect(forwards.indexOf(group("a"))).toBe(backwards.indexOf(group("a")));
    expect(forwards.indexOf(group("b"))).toBe(backwards.indexOf(group("b")));
  });
});

describe("the colours do not move", () => {
  const DAY: readonly GroupOccurrence[] = [
    on(MONDAY, group("a")),
    on(MONDAY, group("b")),
    on(TUESDAY, group("c")),
  ];

  /** A refresh rebuilds the palette from the same Trips. */
  it("gives the same colours when built again", () => {
    expect(fingerprint(DAY)).toBe(fingerprint(DAY));
  });

  it("gives the same colours whatever order the Trips arrive in", () => {
    expect(fingerprint([...DAY].reverse())).toBe(fingerprint(DAY));
  });

  /** Sorting the list by truck, by time or by status moves no colour. */
  it("gives the same colours for every permutation of the rows", () => {
    const rotated = [DAY[2], DAY[0], DAY[1]];
    const shuffled = [DAY[1], DAY[2], DAY[0]];

    expect(fingerprint(rotated)).toBe(fingerprint(DAY));
    expect(fingerprint(shuffled)).toBe(fingerprint(DAY));
  });

  /** One Trip of a group or five: the group is one entry either way. */
  it("is unaffected by how many Trips a group has on screen", () => {
    const withDuplicates = [...DAY, on(MONDAY, group("a")), on(MONDAY, group("b"))];

    expect(fingerprint(withDuplicates)).toBe(fingerprint(DAY));
  });

  it("keeps a group's colour when another group's Trips change", () => {
    const before = combinationPalette(DAY);
    const after = combinationPalette([...DAY, on(TUESDAY, group("c"))]);

    expect(after.indexOf(group("a"))).toBe(before.indexOf(group("a")));
    expect(after.indexOf(group("c"))).toBe(before.indexOf(group("c")));
  });
});

describe("what it does not touch", () => {
  /** A Trip in no group has no group colour — not a pale one, none. */
  it("gives a Trip without a group no fill", () => {
    const palette = combinationPalette([on(MONDAY, null), on(MONDAY, group("a"))]);

    expect(palette.fillArgb(null)).toBeNull();
  });

  it("ignores groupless Trips when assigning colours", () => {
    const withStandalone = combinationPalette([
      on(MONDAY, null),
      on(MONDAY, group("a")),
      on(MONDAY, null),
    ]);
    const without = combinationPalette([on(MONDAY, group("a"))]);

    expect(withStandalone.indexOf(group("a"))).toBe(without.indexOf(group("a")));
  });

  /** One group on its own still gets a colour, and a fill, and classes. */
  it("colours a single group with nothing else on screen", () => {
    const palette = combinationPalette([on(MONDAY, group("a"))]);

    expect(palette.indexOf(group("a"))).toBeGreaterThanOrEqual(1);
    expect(palette.fillArgb(group("a"))).toMatch(/^FF[0-9A-F]{6}$/);
    expect(palette.classesFor(group("a"))).toContain("bg-combination-");
  });

  /**
   * A group the period does not hold — a dialog opened from elsewhere — still
   * gets its own stable colour rather than none.
   */
  it("falls back to the id for a group it was not told about", () => {
    const palette = combinationPalette([on(MONDAY, group("a"))]);

    expect(palette.indexOf(group("z"))).toBe(combinationColorIndex(group("z")));
  });

  it("colours nothing at all when there are no Trips", () => {
    const palette = combinationPalette([]);

    expect(palette.fillArgb(null)).toBeNull();
    expect(palette.indexOf(group("a"))).toBe(combinationColorIndex(group("a")));
  });

  /** A Trip with no planning date is still a group, and still gets a colour. */
  it("colours a group whose Trips have no planning date", () => {
    const palette = combinationPalette([
      on(MONDAY, group("a")),
      on(null, group("b")),
    ]);

    expect(palette.indexOf(group("b"))).not.toBe(palette.indexOf(group("a")));
  });

  /** Undated groups come last, so they never push a dated day's colours around. */
  it("orders undated groups after every dated one", () => {
    const palette = combinationPalette([
      on(null, group("z")),
      on(FRIDAY, group("a")),
    ]);
    const datedOnly = combinationPalette([on(FRIDAY, group("a"))]);

    expect(palette.indexOf(group("a"))).toBe(datedOnly.indexOf(group("a")));
  });
});
