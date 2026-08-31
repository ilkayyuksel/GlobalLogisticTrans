import { bookingNumberDigits } from "./booking-digits";

/**
 * The digit reduction the Cost Confirmation fallback compares on.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 * A transport order prints `ANRDUB2793554`. A confirmation for the same booking
 * can arrive as `DUB2793554` or as `2793554`, because it is produced by another
 * system. Matched as strings those find no Trip, and real money goes unrecorded.
 *
 * ── AND WHAT IT IS NOT ──────────────────────────────────────────────────────
 * The comparison it feeds is EXACT equality of these strings. A different
 * number, an extra digit or a missing one are all different bookings, and no
 * substring test is used anywhere near it.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the digits of a booking number", () => {
  /** The example the rule was written from, in all three printings. */
  it.each([
    ["ANRDUB2793554", "2793554"],
    ["DUB2793554", "2793554"],
    ["2793554", "2793554"],
  ])("reduces %s to %s", (printed, digits) => {
    expect(bookingNumberDigits(printed)).toBe(digits);
  });

  it("gives one answer for every printing of one booking", () => {
    const forms = ["ANRDUB2793554", "DUB2793554", "2793554"];

    expect(new Set(forms.map(bookingNumberDigits)).size).toBe(1);
  });

  /** Spacing and separators are typography, and cannot change the answer. */
  it.each([
    "ANRDUB 2793554",
    " ANRDUB2793554 ",
    "ANRDUB-2793554",
    "ANR/DUB/2793554",
    "ANRDUB.2793554",
    "anrdub2793554",
  ])("reads %p as the same booking", (printed) => {
    expect(bookingNumberDigits(printed)).toBe("2793554");
  });

  /**
   * The booking number is otherwise stored and compared EXACTLY — the slash in
   * `ANRDUB2794719 /67036944` separates the booking from the trip number. This
   * function does not change that; it exists only for the confirmation
   * fallback, and here every digit on the line counts.
   */
  it("keeps every digit, including a trip number printed after the booking", () => {
    expect(bookingNumberDigits("ANRDUB2794719 /67036944")).toBe(
      "279471967036944",
    );
  });

  /** A reference with nothing numeric identifies nothing. */
  it.each([null, undefined, "", "   ", "ANRDUB", "----", "???"])(
    "returns null for %p",
    (value) => {
      expect(bookingNumberDigits(value as string | null)).toBeNull();
    },
  );

  /**
   * The negative cases the rule names. These are DIFFERENT bookings, and the
   * equality that compares them must say so.
   */
  it.each([
    ["2793554", "2793555"],
    ["2793554", "12793554"],
    ["2793554", "27935540"],
    ["2793554", "279355"],
  ])("keeps %s and %s apart", (left, right) => {
    expect(bookingNumberDigits(left)).not.toBe(bookingNumberDigits(right));
  });

  /**
   * Stated directly, because it is the property the whole rule rests on: a
   * shorter sequence must not be found inside a longer one. If the comparison
   * were ever loosened to `includes`, this is what would break.
   */
  it("does not make a shorter booking a prefix match of a longer one", () => {
    const short = bookingNumberDigits("2793554") as string;
    const long = bookingNumberDigits("ANRDUB12793554") as string;

    expect(long).not.toBe(short);
    expect(long.includes(short)).toBe(true);
  });
});
