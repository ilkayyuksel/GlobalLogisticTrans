import { VehicleAssignment } from "@prisma/client";

import { assignmentInEffect, isInEffectOn } from "./assignment-period";

/**
 * The assignment period rule.
 *
 * Boundary days get the most attention here: an off-by-one at either end puts
 * the wrong driver on a Trip, and nothing downstream would notice — the answer
 * would simply be a different, plausible name.
 */

const VEHICLE_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function assignment(
  validFrom: string,
  validTo: string | null,
  overrides: Partial<VehicleAssignment> = {},
): VehicleAssignment {
  return {
    id: `assignment-${validFrom}`,
    vehicleId: VEHICLE_ID,
    driverId: "driver-1",
    validFrom: day(validFrom),
    validTo: validTo === null ? null : day(validTo),
    notes: null,
    createdAt: day("2026-01-01"),
    updatedAt: day("2026-01-01"),
    ...overrides,
  } as VehicleAssignment;
}

describe("isInEffectOn", () => {
  describe("a closed period", () => {
    const period = assignment("2026-03-10", "2026-03-20");

    it.each([
      ["2026-03-10", true, "the first day, which is included"],
      ["2026-03-15", true, "a day inside the period"],
      ["2026-03-20", true, "the last day, which is included"],
      ["2026-03-09", false, "the day before it starts"],
      ["2026-03-21", false, "the day after it ends"],
    ])("%s -> %s (%s)", (date, expected) => {
      expect(isInEffectOn(period, day(date))).toBe(expected);
    });
  });

  describe("an open-ended period", () => {
    const period = assignment("2026-03-10", null);

    it("covers its first day", () => {
      expect(isInEffectOn(period, day("2026-03-10"))).toBe(true);
    });

    it("covers a date far in the future", () => {
      expect(isInEffectOn(period, day("2030-01-01"))).toBe(true);
    });

    it("does not cover a date before it starts", () => {
      expect(isInEffectOn(period, day("2026-03-09"))).toBe(false);
    });
  });

  describe("a single-day period", () => {
    it("covers exactly that day and nothing else", () => {
      const period = assignment("2026-03-10", "2026-03-10");

      expect(isInEffectOn(period, day("2026-03-10"))).toBe(true);
      expect(isInEffectOn(period, day("2026-03-09"))).toBe(false);
      expect(isInEffectOn(period, day("2026-03-11"))).toBe(false);
    });
  });
});

describe("assignmentInEffect", () => {
  it("returns null when nothing covers the date", () => {
    const candidates = [assignment("2026-01-01", "2026-01-31")];

    expect(assignmentInEffect(candidates, day("2026-03-10"))).toBeNull();
  });

  it("returns null when there are no candidates at all", () => {
    expect(assignmentInEffect([], day("2026-03-10"))).toBeNull();
  });

  it("picks the one covering the date from a history", () => {
    const candidates = [
      assignment("2026-01-01", "2026-01-31", { id: "january" }),
      assignment("2026-02-01", "2026-02-28", { id: "february" }),
      assignment("2026-03-01", null, { id: "march" }),
    ];

    expect(assignmentInEffect(candidates, day("2026-02-14"))?.id).toBe(
      "february",
    );
  });

  it("picks the open-ended one for a later date", () => {
    const candidates = [
      assignment("2026-01-01", "2026-01-31", { id: "january" }),
      assignment("2026-03-01", null, { id: "march" }),
    ];

    expect(assignmentInEffect(candidates, day("2026-06-01"))?.id).toBe("march");
  });

  /**
   * The create and update rules prevent overlaps, but a direct database edit
   * could still produce one. The most recently started assignment wins, which
   * is the same answer the single-assignment lookup gives with its
   * `orderBy: { validFrom: "desc" }`.
   */
  it("prefers the most recently started when two overlap", () => {
    const candidates = [
      assignment("2026-01-01", null, { id: "older" }),
      assignment("2026-02-01", null, { id: "newer" }),
    ];

    expect(assignmentInEffect(candidates, day("2026-03-01"))?.id).toBe("newer");
  });

  it("is not affected by the order candidates arrive in", () => {
    const candidates = [
      assignment("2026-02-01", null, { id: "newer" }),
      assignment("2026-01-01", null, { id: "older" }),
    ];

    expect(assignmentInEffect(candidates, day("2026-03-01"))?.id).toBe("newer");
  });

  it("ignores candidates for the date even when one is adjacent", () => {
    const candidates = [
      assignment("2026-01-01", "2026-03-09", { id: "before" }),
      assignment("2026-03-11", null, { id: "after" }),
    ];

    expect(assignmentInEffect(candidates, day("2026-03-10"))).toBeNull();
  });
});
