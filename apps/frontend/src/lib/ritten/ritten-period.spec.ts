import {
  addMonths,
  endOfMonth,
  fromMonthInputValue,
  guaranteedDates,
  isCurrentPeriod,
  periodEnd,
  periodQuery,
  periodStart,
  shiftPeriod,
  startOfMonth,
  toMonthInputValue,
} from "./period";
import { buildSections } from "./sections";
import {
  combinationClasses,
  combinationColorIndex,
  combinationLabel,
} from "./combination";
import type { Trip } from "@/lib/api/types";

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

/**
 * The arithmetic behind Dag, Week and Maand.
 *
 * Dates are calendar strings from end to end. These tests are the guard against
 * a local timezone creeping in — the day boundaries here are the ones the
 * backend's DATE column means, not the ones a browser in Antwerp or Istanbul
 * would infer.
 */

function trip(id: string, planningDate: string): Trip {
  return { id, planningDate } as Trip;
}

describe("Ritten periods", () => {
  describe("the query sent to the backend", () => {
    it("asks for one exact day in Day view", () => {
      expect(periodQuery("day", "2026-08-13")).toEqual({
        planningDate: "2026-08-13",
      });
    });

    it("asks for Monday to Sunday in Week view", () => {
      expect(periodQuery("week", "2026-08-13")).toEqual({
        planningDateFrom: "2026-08-10",
        planningDateTo: "2026-08-16",
      });
    });

    it("asks for the whole month in Month view", () => {
      expect(periodQuery("month", "2026-08-13")).toEqual({
        planningDateFrom: "2026-08-01",
        planningDateTo: "2026-08-31",
      });
    });

    /** Both would be ambiguous: the backend documents planningDate as winning. */
    it("never sends a day and a range together", () => {
      expect(periodQuery("day", "2026-08-13")).not.toHaveProperty(
        "planningDateFrom",
      );
    });
  });

  describe("month boundaries", () => {
    it.each([
      ["2026-08-13", "2026-08-31"],
      ["2026-02-05", "2026-02-28"],
      ["2028-02-05", "2028-02-29"],
      ["2026-12-31", "2026-12-31"],
    ])("ends the month of %s on %s", (anchor, expected) => {
      expect(endOfMonth(anchor)).toBe(expected);
    });

    it("starts every month on the first", () => {
      expect(startOfMonth("2026-08-13")).toBe("2026-08-01");
    });
  });

  describe("moving between periods", () => {
    it("steps one day at a time in Day view", () => {
      expect(shiftPeriod("day", "2026-08-13", 1)).toBe("2026-08-14");
      expect(shiftPeriod("day", "2026-08-01", -1)).toBe("2026-07-31");
    });

    it("steps to the Monday of the next week in Week view", () => {
      expect(shiftPeriod("week", "2026-08-13", 1)).toBe("2026-08-17");
      expect(shiftPeriod("week", "2026-08-13", -1)).toBe("2026-08-03");
    });

    it("steps to the first of the next month in Month view", () => {
      expect(shiftPeriod("month", "2026-08-13", 1)).toBe("2026-09-01");
      expect(shiftPeriod("month", "2026-01-15", -1)).toBe("2025-12-01");
    });

    /** Without the clamp, one month after 31 January would be 3 March. */
    it("clamps a day-of-month that the target month does not have", () => {
      expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    });
  });

  describe("knowing where 'now' is", () => {
    it.each([
      ["day", "2026-08-13", true],
      ["day", "2026-08-14", false],
      ["week", "2026-08-10", true],
      ["week", "2026-08-16", true],
      ["week", "2026-08-17", false],
      ["month", "2026-08-31", true],
      ["month", "2026-09-01", false],
    ] as const)("%s view at %s is current: %s", (view, anchor, expected) => {
      expect(isCurrentPeriod(view, anchor)).toBe(expected);
    });
  });

  describe("the dates a view always shows", () => {
    it("is the one day in Day view", () => {
      expect(guaranteedDates("day", "2026-08-13")).toEqual(["2026-08-13"]);
    });

    it("is all seven days in Week view, Monday first", () => {
      expect(guaranteedDates("week", "2026-08-13")).toEqual([
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
        "2026-08-15",
        "2026-08-16",
      ]);
    });

    /** A month prints the days that hold work, not thirty-one empty headings. */
    it("is nothing in Month view", () => {
      expect(guaranteedDates("month", "2026-08-13")).toEqual([]);
    });
  });

  describe("the month picker value", () => {
    it("round-trips through the input format", () => {
      expect(toMonthInputValue("2026-08-13")).toBe("2026-08");
      expect(fromMonthInputValue("2026-08")).toBe("2026-08-01");
    });

    it("refuses anything that is not a month", () => {
      expect(fromMonthInputValue("")).toBeNull();
      expect(fromMonthInputValue("2026")).toBeNull();
    });
  });

  describe("period edges", () => {
    it("treats a single day as its own start and end", () => {
      expect(periodStart("day", "2026-08-13")).toBe("2026-08-13");
      expect(periodEnd("day", "2026-08-13")).toBe("2026-08-13");
    });
  });
});

describe("Ritten date sections", () => {
  it("keeps all seven days of a week, empty ones included", () => {
    const sections = buildSections("week", "2026-08-13", [
      trip("a", "2026-08-11"),
    ]);

    expect(sections).toHaveLength(7);
    expect(sections[0].date).toBe("2026-08-10");
    expect(sections[0].trips).toEqual([]);
    expect(sections[1].trips.map((item) => item.id)).toEqual(["a"]);
  });

  it("keeps only the days that hold work in a month", () => {
    const sections = buildSections("month", "2026-08-01", [
      trip("a", "2026-08-07"),
      trip("b", "2026-08-02"),
      trip("c", "2026-08-07"),
    ]);

    expect(sections.map((section) => section.date)).toEqual([
      "2026-08-02",
      "2026-08-07",
    ]);
    expect(sections[1].trips.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("keeps the Trips in the order the backend returned them", () => {
    const sections = buildSections("day", "2026-08-13", [
      trip("second", "2026-08-13"),
      trip("first", "2026-08-13"),
    ]);

    expect(sections[0].trips.map((item) => item.id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("shows a Trip whose date falls outside the period rather than dropping it", () => {
    const sections = buildSections("day", "2026-08-13", [
      trip("a", "2026-08-13"),
      trip("stray", "2026-09-01"),
    ]);

    expect(sections.map((section) => section.date)).toEqual([
      "2026-08-13",
      "2026-09-01",
    ]);
  });

  it("returns one empty section for a day with no Trips", () => {
    expect(buildSections("day", "2026-08-13", [])).toEqual([
      { date: "2026-08-13", trips: [] },
    ]);
  });
});

describe("Combination markers", () => {
  const GROUP = "97777777-7777-4777-8777-777777777777";

  it("abbreviates the real group id", () => {
    expect(combinationLabel(GROUP)).toBe("G-9777");
  });

  it("gives the same group the same colour every time", () => {
    expect(combinationColorIndex(GROUP)).toBe(combinationColorIndex(GROUP));
    expect(combinationClasses(GROUP)).toBe(combinationClasses(GROUP));
  });

  it("stays inside the palette that has tokens defined", () => {
    const indexes = [
      GROUP,
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "abcdefab-cdef-4bcd-8bcd-efabcdefabcd",
    ].map(combinationColorIndex);

    expect(indexes.every((index) => index >= 1 && index <= 6)).toBe(true);
  });

  /** Two Combinations on one screen must be tellable apart. */
  it("gives different groups different labels", () => {
    expect(combinationLabel("11111111-1111-4111-8111-111111111111")).not.toBe(
      combinationLabel(GROUP),
    );
  });
});
