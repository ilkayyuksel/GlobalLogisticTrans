import {
  toWaitingTimeWrite,
  waitingWindowMinutes,
} from "./waiting-window";

/**
 * The duration between two clock times, and what gets stored.
 *
 * ── THE THREE COLUMNS DESCRIBE ONE FACT ─────────────────────────────────────
 * Pricing bills from the minutes; the two times say where that figure came
 * from. They can never disagree because the minutes are DERIVED here and are
 * not accepted from a caller — which is what these tests hold in place.
 *
 * The three examples below are the product's own rules, and the same three are
 * asserted in the frontend's `waiting-time.spec.ts`. If the two ever drift, one
 * of the two suites goes red.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A Prisma TIME value: only the clock reading matters. */
function at(clock: string): Date {
  return new Date(`1970-01-01T${clock}:00.000Z`);
}

describe("the waiting window", () => {
  describe("the duration between two times", () => {
    it("counts a window inside one day", () => {
      expect(waitingWindowMinutes(at("10:00"), at("12:15"))).toBe(135);
    });

    /** Past midnight the end is the next morning, not a negative number. */
    it("counts a window that crosses midnight", () => {
      expect(waitingWindowMinutes(at("22:00"), at("02:00"))).toBe(240);
    });

    /**
     * Equal times are ZERO, never twenty-four hours. "It waited exactly a day"
     * and "it did not wait" look identical in two time fields, and reading it
     * as a day would bill a full day for a mistyped repeat.
     */
    it("counts equal times as zero", () => {
      expect(waitingWindowMinutes(at("10:00"), at("10:00"))).toBe(0);
    });

    it.each([
      ["00:00", "00:00", 0],
      ["23:59", "23:59", 0],
      ["00:00", "23:59", 1439],
      ["23:59", "00:00", 1],
      ["08:00", "10:15", 135],
      ["09:30", "09:45", 15],
    ])("%s → %s is %i minutes", (begin, end, minutes) => {
      expect(waitingWindowMinutes(at(begin), at(end))).toBe(minutes);
    });

    /** Unrepresentable by construction: the midnight rule absorbs it. */
    it("never produces a negative duration", () => {
      for (let hour = 0; hour < 24; hour += 1) {
        for (const other of [0, 6, 12, 18, 23]) {
          const minutes = waitingWindowMinutes(
            at(`${String(hour).padStart(2, "0")}:00`),
            at(`${String(other).padStart(2, "0")}:00`),
          );

          expect(minutes).toBeGreaterThanOrEqual(0);
          expect(minutes).toBeLessThan(24 * 60);
        }
      }
    });
  });

  describe("what gets written", () => {
    it("stores both times and the duration between them", () => {
      expect(toWaitingTimeWrite(at("08:00"), at("10:15"))).toEqual({
        waitingTimeStart: at("08:00"),
        waitingTimeEnd: at("10:15"),
        waitingTimeMinutes: 135,
      });
    });

    /** Removing the entry clears all three, so nothing is left half-stated. */
    it("clears all three when the window is cleared", () => {
      expect(toWaitingTimeWrite(null, null)).toEqual({
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeMinutes: null,
      });
    });

    /** An update that says nothing about waiting time writes nothing about it. */
    it("writes nothing when neither time was sent", () => {
      expect(toWaitingTimeWrite(undefined, undefined)).toEqual({});
    });

    it("stores a zero duration rather than nothing for equal times", () => {
      expect(toWaitingTimeWrite(at("10:00"), at("10:00"))).toEqual({
        waitingTimeStart: at("10:00"),
        waitingTimeEnd: at("10:00"),
        waitingTimeMinutes: 0,
      });
    });

    it("stores the crossing-midnight duration", () => {
      expect(toWaitingTimeWrite(at("22:00"), at("02:00"))).toMatchObject({
        waitingTimeMinutes: 240,
      });
    });

    /**
     * A half-filled window never reaches here — the DTO refuses it — but if one
     * did, it is treated as a removal rather than as a duration from midnight.
     */
    it("treats a half-cleared window as a removal", () => {
      expect(toWaitingTimeWrite(at("08:00"), null)).toEqual({
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeMinutes: null,
      });
    });
  });
});
