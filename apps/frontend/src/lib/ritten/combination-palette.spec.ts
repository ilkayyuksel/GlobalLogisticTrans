import {
  COMBINATION_COLOR_COUNT,
  combinationClasses,
  combinationColorIndex,
  combinationFillArgb,
} from "./combination";

/**
 * The group palette, which the Ritten list and the BASIS sheet share.
 *
 * ── ONE MAPPING, TWO REPRESENTATIONS ────────────────────────────────────────
 * `combinationColorIndex` is the whole of the decision: it turns a group id
 * into a number, and the interface and the spreadsheet each render that number
 * their own way — Tailwind classes bound to `--color-combination-*`, or a
 * solid fill. There is no second palette and no Excel-only colour, which is
 * what keeps a Combination looking the same on screen and on paper.
 *
 * ── AND THE HUES ARE DELIBERATELY FAR APART ─────────────────────────────────
 * The palette used to hold six, with violet beside indigo and teal beside lime.
 * Two groups on one screen could land on shades of a single colour, which is
 * exactly what a group marker must never do. It is ten now, ordered so that
 * consecutive entries sit far apart on the wheel.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** `#RRGGBB` from an `AARRGGBB` fill. */
function rgbOf(argb: string): [number, number, number] {
  return [
    parseInt(argb.slice(2, 4), 16),
    parseInt(argb.slice(4, 6), 16),
    parseInt(argb.slice(6, 8), 16),
  ];
}

/** Hue in degrees, which is what "a different colour" actually means here. */
function hueOf(argb: string): number {
  const [red, green, blue] = rgbOf(argb).map((channel) => channel / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;

  if (span === 0) {
    return 0;
  }

  const hue =
    max === red
      ? ((green - blue) / span) % 6
      : max === green
        ? (blue - red) / span + 2
        : (red - green) / span + 4;

  return (hue * 60 + 360) % 360;
}

/** Relative luminance, for the readability check. */
function luminanceOf(argb: string): number {
  const [red, green, blue] = rgbOf(argb).map((channel) => {
    const value = channel / 255;

    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const EVERY_INDEX = Array.from(
  { length: COMBINATION_COLOR_COUNT },
  (_, offset) => offset + 1,
);

/** A group id that lands on a given colour index, found rather than assumed. */
function idLandingOn(index: number): string {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    const candidate = `group-${attempt}`;

    if (combinationColorIndex(candidate) === index) {
      return candidate;
    }
  }

  throw new Error(`no id lands on colour ${index}`);
}

describe("the group palette", () => {
  it("offers ten colours", () => {
    expect(COMBINATION_COLOR_COUNT).toBe(10);
  });

  it("has a fill for every index", () => {
    for (const index of EVERY_INDEX) {
      expect(combinationFillArgb(idLandingOn(index))).toMatch(
        /^FF[0-9A-F]{6}$/,
      );
    }
  });

  it("has interface classes for every index", () => {
    for (const index of EVERY_INDEX) {
      expect(combinationClasses(idLandingOn(index))).toContain(
        `bg-combination-${index}/10`,
      );
    }
  });

  describe("the colours are genuinely different", () => {
    const fills = EVERY_INDEX.map((index) =>
      combinationFillArgb(idLandingOn(index)),
    ) as string[];

    it("gives no two groups the same fill", () => {
      expect(new Set(fills).size).toBe(COMBINATION_COLOR_COUNT);
    });

    /**
     * The point of the change. Every pair must differ in HUE, not merely in
     * lightness — two shades of green are what this palette exists to avoid.
     */
    it("separates every pair by a real hue distance", () => {
      const hues = fills.map(hueOf);

      for (let left = 0; left < hues.length; left += 1) {
        for (let right = left + 1; right < hues.length; right += 1) {
          const apart = Math.abs(hues[left] - hues[right]);
          const distance = Math.min(apart, 360 - apart);

          expect(distance).toBeGreaterThanOrEqual(15);
        }
      }
    });

    /** Consecutive entries are the ones most likely to meet on one screen. */
    it("puts consecutive entries far apart", () => {
      const hues = fills.map(hueOf);

      for (let index = 1; index < hues.length; index += 1) {
        const apart = Math.abs(hues[index] - hues[index - 1]);

        expect(Math.min(apart, 360 - apart)).toBeGreaterThan(30);
      }
    });
  });

  /**
   * The sheet's text is black. A fill dark enough to fight it would trade one
   * problem for a worse one, so every one of them stays light.
   */
  it("keeps every fill light enough for dark text", () => {
    for (const index of EVERY_INDEX) {
      const argb = combinationFillArgb(idLandingOn(index)) as string;

      expect(luminanceOf(argb)).toBeGreaterThan(0.6);
    }
  });

  describe("the mapping is by identity", () => {
    const GROUP = "5c2f4d8e-1a3b-4c6d-8e9f-0a1b2c3d4e5f";

    it("gives one group the same colour every time", () => {
      expect(combinationFillArgb(GROUP)).toBe(combinationFillArgb(GROUP));
      expect(combinationColorIndex(GROUP)).toBe(combinationColorIndex(GROUP));
    });

    /** Position and date decide nothing: only the id does. */
    it("depends on nothing but the id", () => {
      const first = combinationFillArgb(GROUP);

      for (let repeat = 0; repeat < 50; repeat += 1) {
        expect(combinationFillArgb(GROUP)).toBe(first);
      }
    });

    it("gives a Trip in no group no fill at all", () => {
      expect(combinationFillArgb(null)).toBeNull();
    });

    /**
     * The interface and the sheet read the SAME index. Asserted directly, so
     * a palette added on one side without the other fails here.
     */
    it("drives both representations from one index", () => {
      for (const index of EVERY_INDEX) {
        const id = idLandingOn(index);

        expect(combinationClasses(id)).toContain(`bg-combination-${index}/10`);
        expect(combinationFillArgb(id)).toBe(
          combinationFillArgb(idLandingOn(combinationColorIndex(id))),
        );
      }
    });
  });

  /** Past ten, colours repeat — deterministically, never at random. */
  it("reuses colours only after all ten are spent", () => {
    const seen = new Map<string, string>();

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const id = `spread-${attempt}`;
      const fill = combinationFillArgb(id) as string;
      const previous = seen.get(id);

      expect(previous ?? fill).toBe(fill);
      seen.set(id, fill);
    }

    expect(new Set(seen.values()).size).toBe(COMBINATION_COLOR_COUNT);
  });
});
