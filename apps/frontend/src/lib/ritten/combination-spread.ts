/**
 * How far apart two group colours LOOK, and the order that keeps them apart.
 *
 * ── WHY NOT RGB DISTANCE ────────────────────────────────────────────────────
 * Two colours can be far apart in RGB and look the same, and close in RGB and
 * look different: the channels are a way of driving a screen, not a model of
 * seeing. Sorting a palette by RGB distance is how a list of ten "distinct"
 * colours ends up holding three greens.
 *
 * So the distance here is measured in OKLab, which is built for exactly this
 * question — equal steps in it are meant to look like equal steps — and no
 * dependency is needed for it: the conversion is a dozen coefficients.
 *
 * ── AND WHY LIGHTNESS COUNTS FOR LESS ───────────────────────────────────────
 * A light green and a dark green are far apart in any Lab metric and are still
 * two greens. What makes a group marker recognisable at a glance is its FAMILY —
 * the a/b plane, which carries hue and colourfulness — so lightness is weighted
 * down rather than out. Down, not out: a colour that differs in lightness as
 * well as hue is genuinely easier to tell apart, and the weight says so without
 * letting lightness alone pass for a difference.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A palette entry, as the CSS tokens state it: three 0-255 channels. */
export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/**
 * How much a difference in lightness counts against one in hue.
 *
 * Half. Two colours of one hue that differ only in lightness then read as
 * roughly half as different as two hues do, which is about how they behave on
 * screen: a row tinted light green beside one tinted dark green is a puzzle,
 * while green beside blue is not.
 */
const LIGHTNESS_WEIGHT = 0.5;

/** The sRGB transfer function, undone. Lab wants light, not signal. */
function toLinear(channel: number): number {
  const value = channel / 255;

  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

/**
 * sRGB to OKLab, by Björn Ottosson's published matrices.
 *
 * Kept as plain arithmetic rather than a library: it is one function, it has no
 * edge cases, and a colour-space dependency in a bundle that needs nothing else
 * from it is a poor trade.
 */
function toOklab(color: Rgb): { lightness: number; green: number; blue: number } {
  const red = toLinear(color.red);
  const green = toLinear(color.green);
  const blue = toLinear(color.blue);

  const long = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const medium = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const short = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );

  return {
    lightness: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    // The a axis: green to red.
    green: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    // The b axis: blue to yellow.
    blue: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  };
}

/**
 * How different two colours look, as one number.
 *
 * Larger is more different. The scale is OKLab's own, where about 0.02 is the
 * smallest difference most people notice and a change of family runs to 0.2 and
 * beyond — so the numbers are small, and comparisons between them are what
 * matters rather than their size.
 */
export function perceptualDistance(left: Rgb, right: Rgb): number {
  const first = toOklab(left);
  const second = toOklab(right);

  const lightness = (first.lightness - second.lightness) * LIGHTNESS_WEIGHT;
  const green = first.green - second.green;
  const blue = first.blue - second.blue;

  return Math.sqrt(lightness * lightness + green * green + blue * blue);
}

/**
 * The order to hand a palette out in, so that the colours given out first are
 * the ones that look least alike.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Greedy farthest-point: after the starting colour, each next entry is the
 * remaining one whose CLOSEST already-chosen neighbour is as far away as
 * possible. Two groups therefore never get neighbouring slots of a hand-written
 * list — they get the two colours that are hardest to confuse, then the third
 * that is hardest to confuse with either, and so on.
 *
 * It is not the mathematically optimal spread of every subset, and it does not
 * need to be: what matters is that the FIRST few colours handed out are plainly
 * different, because that is the case a person actually looks at.
 *
 * ── DETERMINISTIC ───────────────────────────────────────────────────────────
 * Same palette, same starting point, same order — every render, every export,
 * every machine. A tie goes to the lower index, so even a perfectly symmetric
 * palette cannot make it wobble.
 */
export function spreadOrder(
  palette: readonly Rgb[],
  startIndex = 0,
): readonly number[] {
  if (palette.length === 0) {
    return [];
  }

  const order = [startIndex];
  const remaining = palette
    .map((_color, index) => index)
    .filter((index) => index !== startIndex);

  while (remaining.length > 0) {
    let bestPosition = 0;
    let bestDistance = -1;

    remaining.forEach((candidate, position) => {
      const closest = Math.min(
        ...order.map((chosen) =>
          perceptualDistance(palette[candidate], palette[chosen]),
        ),
      );

      // Strictly greater: a tie keeps the earlier candidate, which is the lower
      // palette index, so the order cannot depend on iteration order.
      if (closest > bestDistance) {
        bestDistance = closest;
        bestPosition = position;
      }
    });

    order.push(remaining[bestPosition]);
    remaining.splice(bestPosition, 1);
  }

  return order;
}
