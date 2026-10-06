import {
  formatLocalDateTime,
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
} from "./local-date-time";

/**
 * An instant shown and typed as the operator's LOCAL clock.
 *
 * Pinned to Brussels, where the bug lived: a zone that is not UTC is the only
 * place a UTC clock read as local shows itself. Node applies a changed TZ to
 * every Date created afterwards.
 */
describe("local date-times", () => {
  const originalZone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/Brussels";
  });

  afterAll(() => {
    process.env.TZ = originalZone;
  });

  /** The runtime case: stored 22:00Z, which is midnight in Brussels in October. */
  it("fills the input with the local clock, not the UTC one", () => {
    expect(toLocalDateTimeInput("2026-10-01T22:00:00.000Z")).toBe("2026-10-02T00:00");
  });

  it.each([
    ["across the UTC/local date boundary", "2026-10-01T22:00:00.000Z"],
    ["on an ordinary afternoon", "2026-10-02T12:35:00.000Z"],
    ["in winter time", "2026-01-15T07:05:00.000Z"],
  ])("round-trips %s without moving", (_, instant) => {
    let value = instant;

    for (let save = 0; save < 3; save += 1) {
      value = fromLocalDateTimeInput(toLocalDateTimeInput(value)) as string;
    }

    expect(value).toBe(instant);
  });

  it("sends the instant of the local time that was typed", () => {
    expect(fromLocalDateTimeInput("2026-10-02T00:15")).toBe("2026-10-01T22:15:00.000Z");
  });

  it("shows the same local clock the input holds", () => {
    expect(formatLocalDateTime("2026-10-01T22:00:00.000Z")).toBe("2026-10-02 00:00");
  });

  it.each([null, ""])("treats %p as no value", (value) => {
    expect(toLocalDateTimeInput(value)).toBe("");
    expect(formatLocalDateTime(value)).toBeNull();
  });

  it("sends null for an emptied input", () => {
    expect(fromLocalDateTimeInput("")).toBeNull();
  });

  it("shows nothing rather than NaN for an unreadable value", () => {
    expect(toLocalDateTimeInput("not a date")).toBe("");
  });
});
