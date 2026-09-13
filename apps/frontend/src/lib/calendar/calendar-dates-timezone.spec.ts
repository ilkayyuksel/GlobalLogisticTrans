import { addDays, today } from "./calendar-dates";

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
