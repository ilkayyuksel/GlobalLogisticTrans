import {
  formatWaitingTime,
  isNextDayImplied,
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
   * An operator reads a clock twice, so these are the two times they read.
   * Only 06:00 → 20:00 counts, on each day the window touches. The same cases
   * are asserted in the backend's `waiting-window.spec.ts`, which computes the
   * value that is actually stored.
   *
   * Equal times without "volgende dag" are ZERO rather than 24 hours: reading
   * a mistyped repeat as a day would bill one.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("the waiting window", () => {
    it.each([
      ["10:00", "12:30", 150],
      ["11:00", "13:30", 150],
      ["08:15", "08:45", 30],
      ["10:00", "12:00", 120],
      ["05:00", "07:00", 60],
      ["06:00", "20:00", 840],
      ["00:00", "23:59", 840],
    ])("reads %s to %s on the same day as %i minutes", (begin, end, totalMinutes) => {
      expect(waitingWindowMinutes(begin, end)).toEqual({ totalMinutes });
    });

    it.each([
      ["10:00", "08:00", 720],
      ["10:00", "12:00", 960],
      ["22:00", "02:00", 0],
      ["06:00", "06:00", 840],
      ["20:00", "06:00", 0],
      ["10:00", "10:00", 840],
    ])("reads %s to %s the next day as %i minutes", (begin, end, totalMinutes) => {
      expect(waitingWindowMinutes(begin, end, true)).toEqual({ totalMinutes });
    });

    /** An end before its begin can only be the next day, ticked or not. */
    it.each([
      ["10:00", "08:00", 720],
      ["22:00", "02:00", 0],
      ["23:59", "00:00", 0],
    ])("reads %s to %s as the next day even unticked", (begin, end, totalMinutes) => {
      expect(waitingWindowMinutes(begin, end)).toEqual({ totalMinutes });
      expect(isNextDayImplied(begin, end)).toBe(true);
    });

    it.each([
      ["10:00", "12:00"],
      ["10:00", "10:00"],
      ["", "10:00"],
      ["10:00", ""],
    ])("does not imply the next day for %p to %p", (begin, end) => {
      expect(isNextDayImplied(begin, end)).toBe(false);
    });

    it.each(["00:00", "10:00", "23:59"])(
      "reads %s to itself as zero, never as a day",
      (time) => {
        expect(waitingWindowMinutes(time, time)).toEqual({ totalMinutes: 0 });
      },
    );

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
      ["22:00", "02:00", "0 min"],
      ["19:00", "07:30", "2 u 30 min"],
      ["10:00", "11:15", "1 u 15 min"],
    ])("shows %s to %s as %p", (begin, end, formatted) => {
      const { totalMinutes } = waitingWindowMinutes(begin, end);

      expect(formatWaitingTime(totalMinutes)).toBe(formatted);
    });
  });
});
