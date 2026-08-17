import {
  formatWaitingTime,
  parseWaitingTime,
  toWaitingTimeParts,
} from "./waiting-time";

/**
 * The single conversion between stored minutes and the hours-and-minutes an
 * operator types. Every screen uses this, so every screen is only as correct as
 * these cases.
 */
describe("Waiting time", () => {
  describe("displaying", () => {
    it.each([
      [0, "0 min"],
      [15, "15 min"],
      [59, "59 min"],
      [60, "1 u"],
      [90, "1 u 30 min"],
      [120, "2 u"],
      [135, "2 u 15 min"],
      [1440, "24 u"],
    ])("shows %i minutes as %s", (minutes, expected) => {
      expect(formatWaitingTime(minutes)).toBe(expected);
    });

    /**
     * Null is not zero: one was never measured, the other was measured as
     * nothing, and a screen must be able to tell them apart.
     */
    it("keeps an unrecorded waiting time unrecorded", () => {
      expect(formatWaitingTime(null)).toBeNull();
      expect(formatWaitingTime(0)).toBe("0 min");
    });

    /** A whole hour drops the minutes; under an hour drops the hours. */
    it("never writes a zero part it does not need", () => {
      expect(formatWaitingTime(120)).not.toContain("min");
      expect(formatWaitingTime(45)).not.toContain("u");
    });
  });

  describe("splitting stored minutes for an editor", () => {
    it.each([
      [0, 0, 0],
      [15, 0, 15],
      [60, 1, 0],
      [90, 1, 30],
      [120, 2, 0],
      [135, 2, 15],
    ])("splits %i into %i hours and %i minutes", (total, hours, minutes) => {
      expect(toWaitingTimeParts(total)).toEqual({ hours, minutes });
    });

    it("has nothing to split when nothing was recorded", () => {
      expect(toWaitingTimeParts(null)).toBeNull();
    });
  });

  describe("parsing what was typed", () => {
    it.each([
      ["0", "0", 0],
      ["0", "15", 15],
      ["1", "0", 60],
      ["1", "30", 90],
      ["2", "0", 120],
      ["2", "15", 135],
      ["", "45", 45],
      ["3", "", 180],
    ])("reads %s uur %s min as %i minutes", (hours, minutes, expected) => {
      expect(parseWaitingTime(hours, minutes)).toEqual({
        totalMinutes: expected,
      });
    });

    /** Both fields empty means "not recorded", which the backend stores as null. */
    it("treats two empty fields as no waiting time", () => {
      expect(parseWaitingTime("", "")).toEqual({ totalMinutes: null });
      expect(parseWaitingTime("  ", " ")).toEqual({ totalMinutes: null });
    });

    /**
     * Refused rather than repaired: "1 uur 90 min" could be read as 2:30, but
     * rewriting what someone typed is how a mistyped 9 becomes 90 minutes of
     * billed waiting.
     */
    it("refuses minutes of 60 or more instead of normalising them", () => {
      expect(parseWaitingTime("1", "90")).toEqual({
        totalMinutes: null,
        error: "minutesOutOfRange",
      });
      expect(parseWaitingTime("0", "60")).toEqual({
        totalMinutes: null,
        error: "minutesOutOfRange",
      });
    });

    it("accepts the last valid minute", () => {
      expect(parseWaitingTime("1", "59")).toEqual({ totalMinutes: 119 });
    });

    it.each([
      ["negative hours", "-1", "0", "hoursNegative"],
      ["negative minutes", "0", "-5", "minutesOutOfRange"],
      ["fractional hours", "1.5", "0", "hoursNotWholeNumber"],
      ["fractional minutes", "0", "12.5", "minutesNotWholeNumber"],
      ["hours that are not a number", "abc", "0", "hoursNotWholeNumber"],
      ["minutes that are not a number", "0", "abc", "minutesNotWholeNumber"],
    ])("refuses %s", (_case, hours, minutes, error) => {
      expect(parseWaitingTime(hours, minutes)).toEqual({
        totalMinutes: null,
        error,
      });
    });
  });

  /** What is stored must survive a round trip through the editor unchanged. */
  describe("round trip", () => {
    it.each([0, 15, 45, 60, 90, 120, 135, 599])(
      "returns %i unchanged",
      (total) => {
        const parts = toWaitingTimeParts(total);

        expect(
          parseWaitingTime(String(parts?.hours), String(parts?.minutes)),
        ).toEqual({ totalMinutes: total });
      },
    );
  });
});
