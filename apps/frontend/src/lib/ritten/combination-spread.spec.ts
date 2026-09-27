import { COMBINATION_RGB, COMBINATION_SPREAD_ORDER } from "./combination";
import { perceptualDistance, spreadOrder, type Rgb } from "./combination-spread";

/**
 * How colour difference is measured, and the order that measurement produces.
 *
 * These are the two things the group colours now rest on, so they are tested for
 * the properties the rest relies on rather than for particular numbers: that the
 * distance behaves like a distance, that it does not mistake a change of lightness
 * for a change of colour, and that the order is a deterministic permutation whose
 * first entries are the ones hardest to confuse.
 */

const BLUE: Rgb = { red: 37, green: 99, blue: 235 };
const GREEN: Rgb = { red: 22, green: 163, blue: 74 };
const LIME: Rgb = { red: 101, green: 163, blue: 13 };
const ORANGE: Rgb = { red: 234, green: 88, blue: 12 };

describe("perceptual distance", () => {
  it("is nothing between a colour and itself", () => {
    expect(perceptualDistance(BLUE, BLUE)).toBe(0);
  });

  it("does not depend on which colour is named first", () => {
    expect(perceptualDistance(BLUE, GREEN)).toBeCloseTo(
      perceptualDistance(GREEN, BLUE),
      12,
    );
  });

  /** The pair an operator called almost identical, and the one nobody would. */
  it("rates two greens far closer than a green and a blue", () => {
    expect(perceptualDistance(GREEN, LIME)).toBeLessThan(
      perceptualDistance(GREEN, BLUE) / 4,
    );
  });

  /**
   * The palette's extremes, measured: magenta and lime are the furthest apart at
   * 0.43, green and lime the closest at 0.054. Eight times, which is the range the
   * assignment has to work in — and the reason a hash that ignores which groups
   * are seen together can land so badly.
   */
  it("spans roughly eight times between the palette's closest and furthest pair", () => {
    const distances = COMBINATION_RGB.flatMap((left, index) =>
      COMBINATION_RGB.slice(index + 1).map((right) =>
        perceptualDistance(left, right),
      ),
    );

    expect(Math.max(...distances)).toBeCloseTo(0.431, 2);
    expect(Math.min(...distances)).toBeCloseTo(0.054, 2);
  });

  /** Blue and orange are far apart, which is why they are handed out first. */
  it("rates blue and orange as far apart", () => {
    expect(perceptualDistance(BLUE, ORANGE)).toBeGreaterThan(0.35);
  });

  /*
   * ── LIGHTNESS IS NOT A COLOUR DIFFERENCE ──────────────────────────────────
   * The complaint was about colours that differ too little. A light green beside a
   * dark green is exactly that case, and a plain Lab distance would call them far
   * apart — so lightness is weighted down, and this is the test that says so.
   */
  it("counts a change of lightness for less than a change of hue", () => {
    const darkGreen: Rgb = { red: 11, green: 82, blue: 37 };
    const sameLightnessBlue: Rgb = { red: 26, green: 96, blue: 148 };

    expect(perceptualDistance(GREEN, darkGreen)).toBeLessThan(
      perceptualDistance(GREEN, sameLightnessBlue),
    );
  });

  it("still notices a change of lightness at all", () => {
    const darkGreen: Rgb = { red: 11, green: 82, blue: 37 };

    expect(perceptualDistance(GREEN, darkGreen)).toBeGreaterThan(0);
  });

  it("treats black and white as very different", () => {
    const black: Rgb = { red: 0, green: 0, blue: 0 };
    const white: Rgb = { red: 255, green: 255, blue: 255 };

    expect(perceptualDistance(black, white)).toBeGreaterThan(0);
  });
});

describe("the spread order", () => {
  it("is every colour, once", () => {
    expect([...COMBINATION_SPREAD_ORDER].sort((a, b) => a - b)).toEqual(
      COMBINATION_RGB.map((_color, index) => index),
    );
  });

  it("starts where it was told to", () => {
    expect(COMBINATION_SPREAD_ORDER[0]).toBe(0);
    expect(spreadOrder(COMBINATION_RGB, 3)[0]).toBe(3);
  });

  it("is the same order every time it is computed", () => {
    expect(spreadOrder(COMBINATION_RGB, 0)).toEqual([
      ...COMBINATION_SPREAD_ORDER,
    ]);
  });

  /** The property the whole thing exists for. */
  it("hands out the two most different colours first", () => {
    const [first, second] = COMBINATION_SPREAD_ORDER;
    const distances = COMBINATION_RGB.map((color) =>
      perceptualDistance(COMBINATION_RGB[first], color),
    );

    expect(perceptualDistance(COMBINATION_RGB[first], COMBINATION_RGB[second]))
      .toBe(Math.max(...distances));
  });

  /**
   * Each colour is the farthest one still available from everything handed out
   * before it — the greedy rule, asserted rather than assumed.
   */
  it("always takes the farthest remaining colour", () => {
    COMBINATION_SPREAD_ORDER.forEach((chosen, position) => {
      if (position === 0) {
        return;
      }

      const taken = COMBINATION_SPREAD_ORDER.slice(0, position);
      const remaining = COMBINATION_RGB.map((_color, index) => index).filter(
        (index) => !taken.includes(index),
      );

      const closestOf = (candidate: number) =>
        Math.min(
          ...taken.map((already) =>
            perceptualDistance(
              COMBINATION_RGB[candidate],
              COMBINATION_RGB[already],
            ),
          ),
        );

      expect(closestOf(chosen)).toBe(
        Math.max(...remaining.map((candidate) => closestOf(candidate))),
      );
    });
  });

  it("answers an empty palette with an empty order", () => {
    expect(spreadOrder([], 0)).toEqual([]);
  });

  it("answers a palette of one with that one", () => {
    expect(spreadOrder([BLUE], 0)).toEqual([0]);
  });
});
