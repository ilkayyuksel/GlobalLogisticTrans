import {
  DAYS_PER_WEEK,
  endOfWeek,
  formatCalendarDate,
  isCurrentWeek,
  startOfWeek,
  toWeekLabel,
  today,
  weekDays,
} from "./calendar-dates";

/**
 * Week arithmetic.
 *
 * Deterministic and timezone-free: every calculation runs on `YYYY-MM-DD`
 * strings at UTC midnight, so an operator west of UTC cannot be shown the wrong
 * week. The Sunday cases get the most attention — `getUTCDay()` calls Sunday 0,
 * which is the classic way a Monday-first week ends up off by seven days.
 */

describe("formatCalendarDate", () => {
  it("writes a calendar date the way this business reads it", () => {
    expect(formatCalendarDate("2026-08-14")).toBe("14/08/2026");
  });

  it("keeps the leading zeroes, so every date is the same width", () => {
    expect(formatCalendarDate("2026-01-05")).toBe("05/01/2026");
  });

  it("has nothing to show for a date that was never set", () => {
    expect(formatCalendarDate(null)).toBeNull();
  });

  // Better to show the raw value than to invent "NaN/NaN/NaN" from it.
  it.each(["", "not a date", "2026-08", "2026-08-14T09:00:00.000Z"])(
    "passes %p through unchanged rather than guessing",
    (value) => {
      expect(formatCalendarDate(value)).toBe(value);
    },
  );
});

describe("startOfWeek", () => {
  // 2026-08-10 is a Monday.
  it.each([
    ["2026-08-10", "Monday"],
    ["2026-08-11", "Tuesday"],
    ["2026-08-13", "Thursday"],
    ["2026-08-15", "Saturday"],
    ["2026-08-16", "Sunday"],
  ])("resolves %s (%s) to that week's Monday", (date) => {
    expect(startOfWeek(date)).toBe("2026-08-10");
  });

  /** A Sunday belongs to the week that began six days earlier, not the next. */
  it("does not push a Sunday into the following week", () => {
    expect(startOfWeek("2026-08-16")).toBe("2026-08-10");
    expect(startOfWeek("2026-08-17")).toBe("2026-08-17");
  });

  it("is stable when applied twice", () => {
    expect(startOfWeek(startOfWeek("2026-08-13"))).toBe("2026-08-10");
  });

  it("crosses a month boundary", () => {
    // 2026-09-01 is a Tuesday; its Monday is in August.
    expect(startOfWeek("2026-09-01")).toBe("2026-08-31");
  });

  it("crosses a year boundary", () => {
    // 2027-01-01 is a Friday.
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
  });
});

describe("weekDays", () => {
  it("returns seven days", () => {
    expect(weekDays("2026-08-13")).toHaveLength(DAYS_PER_WEEK);
  });

  it("runs Monday to Sunday", () => {
    expect(weekDays("2026-08-13")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("gives the same seven days for any date in that week", () => {
    expect(weekDays("2026-08-10")).toEqual(weekDays("2026-08-16"));
  });

  it("produces consecutive dates across a month end", () => {
    expect(weekDays("2026-09-02")).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("endOfWeek", () => {
  it("is the Sunday of that week", () => {
    expect(endOfWeek("2026-08-13")).toBe("2026-08-16");
  });

  it("is six days after the Monday", () => {
    const days = weekDays("2026-08-13");

    expect(endOfWeek("2026-08-13")).toBe(days[days.length - 1]);
  });
});

describe("isCurrentWeek", () => {
  it("is true for today", () => {
    expect(isCurrentWeek(today())).toBe(true);
  });

  it("is true for every day of this week", () => {
    for (const day of weekDays(today())) {
      expect(isCurrentWeek(day)).toBe(true);
    }
  });

  it("is false for a distant week", () => {
    expect(isCurrentWeek("2020-01-01")).toBe(false);
  });
});

describe("toWeekLabel", () => {
  it("names the month once when the week stays inside it", () => {
    expect(toWeekLabel("2026-08-13")).toBe("10 – 16 August 2026");
  });

  it("names both months when the week spans two", () => {
    expect(toWeekLabel("2026-09-02")).toBe("31 August – 6 September 2026");
  });
});
