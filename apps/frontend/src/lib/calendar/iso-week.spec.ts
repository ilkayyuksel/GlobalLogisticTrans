import { isoWeekOf } from "./iso-week";

/** ISO-8601 weeks, Monday-first; the year turns on the week's Thursday. */
describe("isoWeekOf", () => {
  it.each([
    ["2026-10-12", 42], // Monday
    ["2026-10-18", 42], // Sunday: still the same week
    ["2026-10-19", 43],
    ["2026-01-01", 1], // Thursday: week 1 itself
    ["2026-12-28", 53], // 2026 has 53 weeks
    ["2026-12-31", 53],
    ["2027-01-01", 53], // Friday: still week 53 of 2026
    ["2027-01-03", 53], // Sunday
    ["2027-01-04", 1], // Monday: week 1 of 2027
    ["2024-12-30", 1], // Monday: already week 1 of 2025
    ["2021-01-03", 53], // Sunday: week 53 of 2020
    ["2024-02-29", 9], // leap day
  ])("puts %s in week %i", (date, week) => {
    expect(isoWeekOf(date)).toBe(week);
  });

  it.each([[null], [""], ["18/10/2026"], ["2026-02-30"]])("has no week for %p", (date) => {
    expect(isoWeekOf(date)).toBeNull();
  });
});
