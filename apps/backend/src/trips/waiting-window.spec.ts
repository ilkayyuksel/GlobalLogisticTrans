import {
  toWaitingTimeWrite,
  waitingWindowEndsNextDay,
  waitingWindowMinutes,
} from "./waiting-window";

/**
 * The waiting time a window counts for, and what gets stored.
 *
 * ── THE COLUMNS DESCRIBE ONE FACT ───────────────────────────────────────────
 * Pricing bills from the minutes; the two times and the day flag say where
 * that figure came from. They can never disagree because the minutes are
 * DERIVED here and are not accepted from a caller — which is what these tests
 * hold in place.
 *
 * ── ONLY 06:00 → 20:00 COUNTS ───────────────────────────────────────────────
 * The examples below are the product's own rules, and the same ones are
 * asserted in the frontend's `waiting-time.spec.ts`. If the two ever drift, one
 * of the two suites goes red.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A Prisma TIME value: only the clock reading matters. */
function at(clock: string): Date {
  return new Date(`1970-01-01T${clock}:00.000Z`);
}

const SAME_DAY = false;
const NEXT_DAY = true;

describe("the waiting window", () => {
  describe("the counted minutes", () => {
    it.each([
      // The business's own examples.
      ["10:00", "12:00", SAME_DAY, 120],
      ["10:00", "08:00", NEXT_DAY, 720],
      ["10:00", "12:00", NEXT_DAY, 960],
      ["22:00", "02:00", NEXT_DAY, 0],
      ["05:00", "07:00", SAME_DAY, 60],
      ["06:00", "20:00", SAME_DAY, 840],
      // The window's own edges.
      ["06:00", "06:00", NEXT_DAY, 840],
      ["20:00", "06:00", NEXT_DAY, 0],
      ["00:00", "23:59", SAME_DAY, 840],
      ["19:45", "20:15", SAME_DAY, 15],
      ["05:30", "06:15", SAME_DAY, 15],
      ["10:00", "12:15", SAME_DAY, 135],
      ["09:30", "09:45", SAME_DAY, 15],
      ["00:00", "23:59", NEXT_DAY, 1680],
    ])("%s → %s, next day %s, counts %i minutes", (begin, end, nextDay, minutes) => {
      expect(waitingWindowMinutes(at(begin), at(end), nextDay)).toBe(minutes);
    });

    /**
     * An end before its begin cannot be the same day, so it is the next one
     * whether or not the flag says so — the meaning it always had.
     */
    it.each([
      ["10:00", "08:00", 720],
      ["22:00", "02:00", 0],
      ["23:59", "00:00", 0],
    ])("reads %s → %s as next day even without the flag", (begin, end, minutes) => {
      expect(waitingWindowMinutes(at(begin), at(end), SAME_DAY)).toBe(minutes);
      expect(waitingWindowEndsNextDay(at(begin), at(end), SAME_DAY)).toBe(true);
    });

    /**
     * Equal times without the flag are ZERO, never a day: a mistyped repeat
     * must not bill one. With the flag they are a full day, of which 06–20
     * counts.
     */
    it("counts equal times as zero on the same day and as a day with the flag", () => {
      expect(waitingWindowMinutes(at("10:00"), at("10:00"), SAME_DAY)).toBe(0);
      expect(waitingWindowMinutes(at("10:00"), at("10:00"), NEXT_DAY)).toBe(840);
    });

    it("never counts more than the window or less than nothing", () => {
      for (let hour = 0; hour < 24; hour += 1) {
        for (const other of [0, 6, 12, 18, 23]) {
          for (const nextDay of [SAME_DAY, NEXT_DAY]) {
            const minutes = waitingWindowMinutes(
              at(`${String(hour).padStart(2, "0")}:00`),
              at(`${String(other).padStart(2, "0")}:00`),
              nextDay,
            );

            expect(minutes).toBeGreaterThanOrEqual(0);
            expect(minutes).toBeLessThanOrEqual(2 * 14 * 60);
          }
        }
      }
    });
  });

  describe("what gets written", () => {
    it("stores both times, the day and the counted minutes", () => {
      expect(toWaitingTimeWrite(at("08:00"), at("10:15"), undefined)).toEqual({
        waitingTimeStart: at("08:00"),
        waitingTimeEnd: at("10:15"),
        waitingTimeEndsNextDay: false,
        waitingTimeMinutes: 135,
      });
    });

    it("stores a next-day window as next day", () => {
      expect(toWaitingTimeWrite(at("10:00"), at("12:00"), NEXT_DAY)).toEqual({
        waitingTimeStart: at("10:00"),
        waitingTimeEnd: at("12:00"),
        waitingTimeEndsNextDay: true,
        waitingTimeMinutes: 960,
      });
    });

    /** Switching the flag off again is a same-day window, priced as one. */
    it("stores the same times as same day once the flag is off", () => {
      expect(toWaitingTimeWrite(at("10:00"), at("12:00"), SAME_DAY)).toMatchObject({
        waitingTimeEndsNextDay: false,
        waitingTimeMinutes: 120,
      });
    });

    /** The stored flag is the effective day, so readers can take it at its word. */
    it("stores an end before its begin as next day", () => {
      expect(toWaitingTimeWrite(at("10:00"), at("08:00"), SAME_DAY)).toMatchObject({
        waitingTimeEndsNextDay: true,
        waitingTimeMinutes: 720,
      });
    });

    /** Removing the entry clears everything, so nothing is left half-stated. */
    it("clears everything when the window is cleared", () => {
      expect(toWaitingTimeWrite(null, null, undefined)).toEqual({
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeEndsNextDay: false,
        waitingTimeMinutes: null,
      });
    });

    /** An update that says nothing about waiting time writes nothing about it. */
    it("writes nothing when neither time was sent", () => {
      expect(toWaitingTimeWrite(undefined, undefined, undefined)).toEqual({});
    });

    it("stores a zero duration rather than nothing for equal times", () => {
      expect(toWaitingTimeWrite(at("10:00"), at("10:00"), undefined)).toEqual({
        waitingTimeStart: at("10:00"),
        waitingTimeEnd: at("10:00"),
        waitingTimeEndsNextDay: false,
        waitingTimeMinutes: 0,
      });
    });

    /**
     * A half-filled window never reaches here — the service refuses it — but if
     * one did, it is treated as a removal rather than as a duration from midnight.
     */
    it("treats a half-cleared window as a removal", () => {
      expect(toWaitingTimeWrite(at("08:00"), null, NEXT_DAY)).toEqual({
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeEndsNextDay: false,
        waitingTimeMinutes: null,
      });
    });
  });
});
