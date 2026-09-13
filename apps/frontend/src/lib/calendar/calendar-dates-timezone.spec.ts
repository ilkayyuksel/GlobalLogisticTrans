import {
  addDays,
  endOfWeek,
  isCurrentWeek,
  startOfWeek,
  today,
  weekDays,
} from "./calendar-dates";

/**
 * The Agenda opens on the operator's own calendar day, not on UTC's.
 *
 * The moments are built from LOCAL clock values, so each expectation holds in
 * whatever zone the tests run in. On a machine east of UTC — Brussels — 00:30
 * local is still the previous day in UTC, and a today() built on toISOString
 * would answer yesterday: the Agenda and the Dashboard would show the wrong
 * day for the first hours after midnight.
 */
describe("today() around midnight", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ["00:30 on 14 September", new Date(2026, 8, 14, 0, 30), "2026-09-14"],
    ["23:30 on 13 September", new Date(2026, 8, 13, 23, 30), "2026-09-13"],
    ["noon on 14 September", new Date(2026, 8, 14, 12, 0), "2026-09-14"],
  ])("is the local day at %s", (_moment, now, expected) => {
    jest.useFakeTimers({ now });

    expect(today()).toBe(expected);
  });

  /** Across the daylight-saving changes, a day is still one day. */
  it("steps whole days without a timezone moving them", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", -1)).toBe("2026-10-24");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });
});

/** The Agenda's week: Monday to Sunday, computed on dates alone. */
describe("the week around a date", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs Monday to Sunday", () => {
    expect(weekDays("2026-09-16")).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
  });

  /** Sunday belongs to the week that began the Monday before, not the next one. */
  it("puts a Sunday in the week it ends", () => {
    expect(startOfWeek("2026-09-20")).toBe("2026-09-14");
    expect(endOfWeek("2026-09-14")).toBe("2026-09-20");
  });

  it("crosses a month boundary without losing a day", () => {
    expect(weekDays("2026-10-01")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  /** 25 October 2026 is the last day of summer time in Europe. */
  it("keeps seven days across a daylight-saving change", () => {
    expect(weekDays("2026-10-25")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(startOfWeek(addDays("2026-10-25", 1))).toBe("2026-10-26");
  });

  /** Just after local midnight on a Monday, "this week" is already the new one. */
  it.each([
    ["00:30 on Monday 14 September", new Date(2026, 8, 14, 0, 30), "2026-09-14"],
    ["23:30 on Sunday 13 September", new Date(2026, 8, 13, 23, 30), "2026-09-07"],
  ])("knows the current week at %s", (_moment, now, expectedMonday) => {
    jest.useFakeTimers({ now });

    expect(startOfWeek(today())).toBe(expectedMonday);
    expect(isCurrentWeek(expectedMonday)).toBe(true);
  });
});
