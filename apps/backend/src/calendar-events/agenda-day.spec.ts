import {
  AGENDA_DAY_END,
  AGENDA_DAY_START,
  DEFAULT_DURATION_MINUTES,
  agendaSlotProblem,
  minuteOfTimeColumn,
  resolveEndMinute,
  toClockLabelOfMinute,
  toMinuteOfDay,
  toTimeColumn,
} from "./agenda-day";

const at = (clockTime: string) => toMinuteOfDay(clockTime);
const slot = (start: string, end: string) => ({
  startMinute: at(start),
  endMinute: at(end),
});

/** The Agenda's rules for placing an item in its day. */
describe("the Agenda's day", () => {
  it("runs from 06:00 to 23:00", () => {
    expect(AGENDA_DAY_START).toBe("06:00");
    expect(AGENDA_DAY_END).toBe("23:00");
  });

  describe("an item without an end", () => {
    it("lasts exactly one hour", () => {
      expect(DEFAULT_DURATION_MINUTES).toBe(60);
      expect(resolveEndMinute(at("10:00"), null)).toBe(at("11:00"));
      expect(resolveEndMinute(at("10:45"), null)).toBe(at("11:45"));
    });

    it("keeps the end it was given", () => {
      expect(resolveEndMinute(at("10:00"), at("12:30"))).toBe(at("12:30"));
    });
  });

  describe("what an item may be", () => {
    it.each([
      ["06:00", "07:00"],
      ["22:00", "23:00"],
      ["10:00", "10:01"],
      ["06:00", "23:00"],
    ])("accepts %s–%s", (start, end) => {
      expect(agendaSlotProblem(slot(start, end))).toBeNull();
    });

    it.each([
      ["10:00", "10:00"],
      ["10:00", "09:30"],
    ])("refuses %s–%s: the end is not after the start", (start, end) => {
      expect(agendaSlotProblem(slot(start, end))).toBe("END_NOT_AFTER_START");
    });

    it.each([
      ["05:00", "06:00"],
      ["05:59", "07:00"],
      ["22:30", "23:30"],
      ["22:00", "23:01"],
    ])("refuses %s–%s: outside the Agenda's day", (start, end) => {
      expect(agendaSlotProblem(slot(start, end))).toBe("OUTSIDE_AGENDA_DAY");
    });

    /** 23:00 without an end would last until midnight, past the day. */
    it("refuses the default hour when it would run past 23:00", () => {
      const start = at("22:30");

      expect(
        agendaSlotProblem({ startMinute: start, endMinute: resolveEndMinute(start, null) }),
      ).toBe("OUTSIDE_AGENDA_DAY");
    });
  });

  describe("clock times", () => {
    it("works in minutes and drops seconds", () => {
      expect(toMinuteOfDay("10:15")).toBe(615);
      expect(toMinuteOfDay("10:15:59")).toBe(615);
      expect(toClockLabelOfMinute(615)).toBe("10:15");
      expect(toClockLabelOfMinute(at("06:00"))).toBe("06:00");
    });
  });

  /**
   * DATE and TIME columns carry no timezone and every conversion here is UTC, so
   * 07:00 is stored and read back as 07:00 whatever zone the server runs in.
   *
   * Jest cannot switch the process's zone from inside a test, so this pins the
   * exact UTC-anchored value — which any local-time conversion breaks on a
   * machine outside UTC. To check another zone, run the file with TZ set, e.g.
   * `TZ=Pacific/Auckland`.
   */
  it("stores a wall-clock time without moving it", () => {
    const stored = toTimeColumn(at("07:00"));

    expect(stored.toISOString()).toBe("1970-01-01T07:00:00.000Z");
    expect(minuteOfTimeColumn(stored)).toBe(at("07:00"));
    expect(toTimeColumn(at("22:59")).toISOString()).toBe(
      "1970-01-01T22:59:00.000Z",
    );
  });
});
