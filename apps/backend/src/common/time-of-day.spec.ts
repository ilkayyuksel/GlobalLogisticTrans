import { isClockTime, toClockTime, toUtcTime } from "./time-of-day";

/**
 * A TIME column has no timezone, so a round trip must return the same wall
 * clock whatever the server's local offset. These are the boundary values the
 * Trip module's own tests do not reach.
 */
describe("time-of-day", () => {
  describe("isClockTime", () => {
    it.each(["00:00", "08:00", "23:59", "12:30:45", "00:00:00", "23:59:59"])(
      "accepts %s",
      (value) => {
        expect(isClockTime(value)).toBe(true);
      },
    );

    it.each([
      "24:00",
      "23:60",
      "12:30:60",
      "8:00",
      "08:0",
      "08",
      "08:00:00.000",
      "noon",
      "",
      " 08:00 ",
    ])("rejects %p", (value) => {
      expect(isClockTime(value)).toBe(false);
    });

    it.each([undefined, null, 800, {}, new Date()])(
      "rejects the non-string %p",
      (value) => {
        expect(isClockTime(value)).toBe(false);
      },
    );
  });

  describe("round trip", () => {
    it.each([
      ["00:00", "00:00:00"],
      ["08:00", "08:00:00"],
      ["23:59", "23:59:00"],
      ["12:30:45", "12:30:45"],
    ])("%s survives as %s", (input, expected) => {
      expect(toClockTime(toUtcTime(input))).toBe(expected);
    });

    it("anchors the value to the epoch day Prisma expects", () => {
      expect(toUtcTime("08:00").toISOString()).toBe("1970-01-01T08:00:00.000Z");
    });
  });
});
