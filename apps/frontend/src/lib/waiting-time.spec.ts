import {
  formatWaitingTime,
  toWaitingTimeParts,
  waitingWindowMinutes,
} from "./waiting-time";

/**
 * The single conversion between the two clock times an operator reads and the
 * minutes the database stores, and back again for display. Every screen uses
 * this, so every screen is only as correct as these cases.
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

  /**
   * ── THE WINDOW, AND THE DAY IT MUST NOT INVENT ────────────────────────────
   * An operator reads a clock twice, so these are the two times they read. The
   * fields carry a time of day and nothing else, which is why every window is
   * shorter than a day — and why equal times are ZERO rather than 24 hours.
   *
   * That last one is the expensive mistake: "the truck waited exactly a day"
   * and "it did not wait" look identical in two time fields, and reading it as
   * a day would bill twenty-four hours for a mistyped repeat.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("the waiting window", () => {
    it.each([
      ["10:00", "12:30", 150],
      ["11:00", "13:30", 150],
      ["08:15", "08:45", 30],
      ["00:00", "23:59", 1439],
    ])("reads %s to %s as %i minutes", (begin, end, totalMinutes) => {
      expect(waitingWindowMinutes(begin, end)).toEqual({ totalMinutes });
    });

    /** Past midnight the end is on the next day. */
    it.each([
      ["22:00", "02:00", 240],
      ["23:30", "00:30", 60],
      ["23:59", "00:00", 1],
    ])("crosses midnight: %s to %s is %i minutes", (begin, end, totalMinutes) => {
      expect(waitingWindowMinutes(begin, end)).toEqual({ totalMinutes });
    });

    it.each(["00:00", "10:00", "23:59"])(
      "reads %s to itself as zero, never as a day",
      (time) => {
        expect(waitingWindowMinutes(time, time)).toEqual({ totalMinutes: 0 });
      },
    );

    it("never produces a negative duration", () => {
      // The bug this rule exists for: 22:00 → 02:00 as a plain subtraction is
      // minus twenty hours.
      expect(waitingWindowMinutes("22:00", "02:00").totalMinutes).toBe(240);
    });

    it("never reaches a full day", () => {
      for (const [begin, end] of [
        ["00:00", "23:59"],
        ["12:00", "11:59"],
        ["23:59", "23:58"],
      ]) {
        expect(waitingWindowMinutes(begin, end).totalMinutes).toBeLessThan(
          24 * 60,
        );
      }
    });

    it("treats two blank fields as no waiting time recorded", () => {
      expect(waitingWindowMinutes("", "")).toEqual({ totalMinutes: null });
      expect(waitingWindowMinutes("  ", " ")).toEqual({ totalMinutes: null });
    });

    /** Half a window is refused, not guessed at: an end alone is not zero. */
    it.each([
      ["", "12:30", "beginInvalid"],
      ["10:00", "", "endInvalid"],
    ])("refuses %p to %p", (begin, end, error) => {
      expect(waitingWindowMinutes(begin, end)).toEqual({
        totalMinutes: null,
        error,
      });
    });

    it.each([
      ["24:00", "01:00", "beginInvalid"],
      ["10:60", "11:00", "beginInvalid"],
      ["1000", "11:00", "beginInvalid"],
      ["10:00", "25:00", "endInvalid"],
      ["10:00", "half twaalf", "endInvalid"],
    ])("refuses %p to %p as not a clock time", (begin, end, error) => {
      expect(waitingWindowMinutes(begin, end)).toEqual({
        totalMinutes: null,
        error,
      });
    });
  });

  /** What the window produces is what the column shows. */
  describe("from a window to what the operator reads", () => {
    it.each([
      ["10:00", "12:30", "2 u 30 min"],
      ["10:00", "10:00", "0 min"],
      ["22:00", "02:00", "4 u"],
      ["10:00", "11:15", "1 u 15 min"],
    ])("shows %s to %s as %p", (begin, end, formatted) => {
      const { totalMinutes } = waitingWindowMinutes(begin, end);

      expect(formatWaitingTime(totalMinutes)).toBe(formatted);
    });
  });
});
