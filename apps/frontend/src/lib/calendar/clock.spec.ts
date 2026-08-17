import {
  BOARD_END_HOUR,
  BOARD_START_HOUR,
  boardHours,
  hourPercent,
  layOutRanges,
  overlaps,
  toClockLabel,
  toMinutes,
  toTimeRange,
} from "./clock";

/**
 * The timeline geometry.
 *
 * Presentation maths only — no business rule is under test here. What matters
 * is that a Trip lands where its stored times say, that a missing time produces
 * no position at all, and that overlapping Trips are never drawn on top of one
 * another.
 */

describe("toMinutes", () => {
  it.each([
    ["00:00:00", 0],
    ["07:30:00", 450],
    ["23:59:00", 1439],
    ["07:30", 450],
  ])("reads %s as %s minutes", (clockTime, expected) => {
    expect(toMinutes(clockTime)).toBe(expected);
  });

  /** A fabricated position is worse than admitting there is none. */
  it.each([null, "", "nonsense", "7:30", "25:00:00", "07:61:00"])(
    "returns null for %p rather than guessing",
    (value) => {
      expect(toMinutes(value)).toBeNull();
    },
  );
});

describe("toTimeRange", () => {
  it("builds a range when both ends are known", () => {
    expect(toTimeRange("07:30:00", "15:00:00")).toEqual({
      startMinute: 450,
      endMinute: 900,
    });
  });

  /**
   * A duration must never be inferred. One end alone says nothing about how
   * long a Trip takes.
   */
  it.each([
    ["07:30:00", null],
    [null, "15:00:00"],
    [null, null],
  ])("returns null for start=%p end=%p", (start, end) => {
    expect(toTimeRange(start, end)).toBeNull();
  });
});

describe("the hour scale", () => {
  it("covers the configured working day", () => {
    const hours = boardHours();

    expect(hours[0]).toBe(BOARD_START_HOUR);
    expect(hours[hours.length - 1]).toBe(BOARD_END_HOUR);
  });

  it("places the first hour at the left edge and the last at the right", () => {
    expect(hourPercent(BOARD_START_HOUR)).toBe(0);
    expect(hourPercent(BOARD_END_HOUR)).toBe(100);
  });

  it("places a mid-morning hour proportionally", () => {
    // 05:00–22:00 is 17 hours; 09:00 is 4 hours in.
    expect(hourPercent(9)).toBeCloseTo((4 / 17) * 100, 5);
  });
});

describe("overlaps", () => {
  it("reports two intervals that share time", () => {
    expect(
      overlaps(
        { startMinute: 480, endMinute: 720 },
        { startMinute: 600, endMinute: 900 },
      ),
    ).toBe(true);
  });

  /** Half-open, matching the backend: touching is not overlapping. */
  it("does not report intervals that merely touch", () => {
    expect(
      overlaps(
        { startMinute: 480, endMinute: 720 },
        { startMinute: 720, endMinute: 900 },
      ),
    ).toBe(false);
  });

  it("reports containment", () => {
    expect(
      overlaps(
        { startMinute: 480, endMinute: 1080 },
        { startMinute: 600, endMinute: 700 },
      ),
    ).toBe(true);
  });
});

describe("layOutRanges", () => {
  function entry(id: string, startMinute: number, endMinute: number) {
    return { item: { id }, range: { startMinute, endMinute } };
  }

  it("positions a trip according to its start time", () => {
    const [placed] = layOutRanges([entry("a", 5 * 60, 6 * 60)]);

    expect(placed.geometry.leftPercent).toBe(0);
  });

  it("gives a longer trip a wider card", () => {
    const [short, long] = layOutRanges([
      entry("short", 6 * 60, 7 * 60),
      entry("long", 8 * 60, 12 * 60),
    ]);

    expect(long.geometry.widthPercent).toBeGreaterThan(
      short.geometry.widthPercent,
    );
  });

  it("scales width to the duration", () => {
    const [placed] = layOutRanges([entry("a", 9 * 60, 13 * 60)]);

    // Four hours of a seventeen-hour board.
    expect(placed.geometry.widthPercent).toBeCloseTo((4 / 17) * 100, 5);
  });

  it("keeps a very short trip wide enough to see and click", () => {
    const [placed] = layOutRanges([entry("a", 9 * 60, 9 * 60 + 5)]);

    expect(placed.geometry.widthPercent).toBeGreaterThan(1);
  });

  /** A Trip outside the board's hours must still appear, not vanish. */
  it("clamps a trip that starts before the board's first hour", () => {
    const [placed] = layOutRanges([entry("a", 3 * 60, 7 * 60)]);

    expect(placed.geometry.leftPercent).toBe(0);
    expect(placed.geometry.widthPercent).toBeGreaterThan(0);
  });

  it("never lets a card run past the right edge", () => {
    const [placed] = layOutRanges([entry("a", 21 * 60, 26 * 60)]);

    expect(placed.geometry.leftPercent + placed.geometry.widthPercent).toBeLessThanOrEqual(
      100.0001,
    );
  });

  describe("overlapping trips", () => {
    it("puts non-overlapping trips in the same row", () => {
      const placed = layOutRanges([
        entry("a", 6 * 60, 8 * 60),
        entry("b", 9 * 60, 11 * 60),
      ]);

      expect(placed.every((entry) => entry.geometry.lane === 0)).toBe(true);
    });

    it("puts overlapping trips in different rows", () => {
      const placed = layOutRanges([
        entry("a", 8 * 60, 12 * 60),
        entry("b", 10 * 60, 14 * 60),
      ]);

      const lanes = placed.map((entry) => entry.geometry.lane).sort();

      expect(lanes).toEqual([0, 1]);
    });

    it("keeps every overlapping trip, hiding none", () => {
      const placed = layOutRanges([
        entry("a", 8 * 60, 12 * 60),
        entry("b", 9 * 60, 13 * 60),
        entry("c", 10 * 60, 14 * 60),
      ]);

      expect(placed).toHaveLength(3);
      expect(new Set(placed.map((entry) => entry.geometry.lane)).size).toBe(3);
    });

    it("reports how many rows a cluster needs", () => {
      const placed = layOutRanges([
        entry("a", 8 * 60, 12 * 60),
        entry("b", 9 * 60, 13 * 60),
      ]);

      expect(placed.every((entry) => entry.geometry.laneCount === 2)).toBe(true);
    });

    /**
     * A chain matters: A overlaps B and B overlaps C, but A and C do not touch.
     * All three must still be arranged together or A and C would collide with B.
     */
    it("treats a chain of overlaps as one cluster", () => {
      const placed = layOutRanges([
        entry("a", 8 * 60, 10 * 60),
        entry("b", 9 * 60, 12 * 60),
        entry("c", 11 * 60, 13 * 60),
      ]);

      const laneOf = (id: string) =>
        placed.find((entry) => entry.item.id === id)?.geometry.lane;

      expect(laneOf("a")).not.toBe(laneOf("b"));
      expect(laneOf("b")).not.toBe(laneOf("c"));
    });

    it("reuses a row once its previous trip has ended", () => {
      const placed = layOutRanges([
        entry("a", 8 * 60, 10 * 60),
        entry("b", 9 * 60, 11 * 60),
        entry("c", 10 * 60, 12 * 60),
      ]);

      const laneOf = (id: string) =>
        placed.find((entry) => entry.item.id === id)?.geometry.lane;

      // c starts when a ends, so it can take a's row rather than a third one.
      expect(laneOf("c")).toBe(laneOf("a"));
    });

    it("does not depend on the order the trips arrive in", () => {
      const forwards = layOutRanges([
        entry("a", 8 * 60, 12 * 60),
        entry("b", 9 * 60, 13 * 60),
      ]);
      const backwards = layOutRanges([
        entry("b", 9 * 60, 13 * 60),
        entry("a", 8 * 60, 12 * 60),
      ]);

      const laneOf = (
        placed: ReturnType<typeof layOutRanges<{ id: string }>>,
        id: string,
      ) => placed.find((entry) => entry.item.id === id)?.geometry.lane;

      expect(laneOf(forwards, "a")).toBe(laneOf(backwards, "a"));
      expect(laneOf(forwards, "b")).toBe(laneOf(backwards, "b"));
    });
  });
});

describe("toClockLabel", () => {
  it("drops the seconds a planner does not need", () => {
    expect(toClockLabel("07:30:00")).toBe("07:30");
  });

  it("returns null when there is no time", () => {
    expect(toClockLabel(null)).toBeNull();
  });
});
