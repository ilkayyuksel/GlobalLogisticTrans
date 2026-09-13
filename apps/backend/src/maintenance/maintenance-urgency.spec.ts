import { Maintenance, MaintenanceStatus, Prisma } from "@prisma/client";

import { toUtcDate } from "../common/dates";
import {
  MaintenanceUrgencyLevel,
  maintenanceUrgency,
} from "./maintenance-urgency";

/**
 * The one rule that decides "te laat", "vandaag" and "gepland".
 *
 * Every case from the specification is listed by its letter. The inputs are a
 * status, the record's maintenance date and — to prove it changes nothing — the
 * next maintenance date and the kilometre fields.
 */

const TODAY = toUtcDate("2026-09-14");

function record(
  status: MaintenanceStatus,
  maintenanceDate: string,
  overrides: Partial<Maintenance> = {},
): Maintenance {
  return {
    id: "maintenance-1",
    vehicleId: "vehicle-1",
    trailerId: null,
    status,
    maintenanceType: "Onderhoud",
    maintenanceDate: toUtcDate(maintenanceDate),
    description: "Grote beurt",
    mileage: null,
    cost: null,
    workshop: null,
    notes: null,
    nextMaintenanceDate: null,
    nextMaintenanceMileage: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const { OVERDUE, TODAY: TODAY_LEVEL, UPCOMING } = MaintenanceUrgencyLevel;

describe("maintenance urgency", () => {
  describe("a PLANNED record", () => {
    it("A. planned for today is TODAY", () => {
      expect(maintenanceUrgency(record("PLANNED", "2026-09-14"), TODAY)).toEqual({
        level: TODAY_LEVEL,
        daysOverdue: 0,
      });
    });

    it("B. planned for yesterday is 1 day late", () => {
      expect(maintenanceUrgency(record("PLANNED", "2026-09-13"), TODAY)).toEqual({
        level: OVERDUE,
        daysOverdue: 1,
      });
    });

    it("C. planned 5 days ago is 5 days late", () => {
      expect(maintenanceUrgency(record("PLANNED", "2026-09-09"), TODAY)).toEqual({
        level: OVERDUE,
        daysOverdue: 5,
      });
    });

    it("D. planned for tomorrow is upcoming", () => {
      expect(maintenanceUrgency(record("PLANNED", "2026-09-15"), TODAY)).toEqual({
        level: UPCOMING,
        daysOverdue: 0,
      });
    });

    it("counts the specification's example: 10/09 on 14/09 is 4 days late", () => {
      expect(
        maintenanceUrgency(record("PLANNED", "2026-09-10"), TODAY)?.daysOverdue,
      ).toBe(4);
    });

    it.each([
      ["across a month end", "2026-08-30", "2026-09-02", 3],
      ["across a year end", "2026-12-30", "2027-01-02", 3],
      ["across a leap day", "2028-02-27", "2028-03-01", 3],
      ["across the spring clock change", "2026-03-28", "2026-03-30", 2],
      ["across the autumn clock change", "2026-10-24", "2026-10-26", 2],
    ])("counts calendar days %s", (_case, planned, today, days) => {
      expect(
        maintenanceUrgency(record("PLANNED", planned), toUtcDate(today)),
      ).toEqual({ level: OVERDUE, daysOverdue: days });
    });
  });

  describe("a record that is not open work", () => {
    it("E. COMPLETED and planned for today is no warning", () => {
      expect(maintenanceUrgency(record("COMPLETED", "2026-09-14"), TODAY)).toBeNull();
    });

    it("F. COMPLETED and dated yesterday is never late", () => {
      expect(maintenanceUrgency(record("COMPLETED", "2026-09-13"), TODAY)).toBeNull();
    });

    it("G. CANCELLED and planned for today is no warning", () => {
      expect(maintenanceUrgency(record("CANCELLED", "2026-09-14"), TODAY)).toBeNull();
    });

    it("H. CANCELLED in the future is not shown", () => {
      expect(maintenanceUrgency(record("CANCELLED", "2026-10-01"), TODAY)).toBeNull();
    });

    it("CANCELLED in the past is not late either", () => {
      expect(maintenanceUrgency(record("CANCELLED", "2026-09-01"), TODAY)).toBeNull();
    });

    /*
     * I. The application has never given IN_PROGRESS a warning of its own —
     * the old due rule simply did not exclude it — and work under way is not
     * waiting for its date. So it has no urgency, today or late.
     */
    it.each(["2026-09-14", "2026-09-01", "2026-10-01"])(
      "I. IN_PROGRESS on %s has no urgency",
      (date) => {
        expect(maintenanceUrgency(record("IN_PROGRESS", date), TODAY)).toBeNull();
      },
    );
  });

  describe("the next maintenance date is not what decides", () => {
    it("J. a date equal to the next date is judged by the planned date", () => {
      const sameDates = record("PLANNED", "2026-09-20", {
        nextMaintenanceDate: toUtcDate("2026-09-20"),
      });

      expect(maintenanceUrgency(sameDates, TODAY)).toEqual({
        level: UPCOMING,
        daysOverdue: 0,
      });
    });

    it("K. today and next today give one TODAY, not two warnings", () => {
      const both = record("PLANNED", "2026-09-14", {
        nextMaintenanceDate: toUtcDate("2026-09-14"),
      });

      expect(maintenanceUrgency(both, TODAY)).toEqual({
        level: TODAY_LEVEL,
        daysOverdue: 0,
      });
    });

    /*
     * L. The record is PLANNED for a day that has passed: that planned work
     * was not done. The next date is the plan for the cycle after it, so it
     * cannot make the current one "not late".
     */
    it("L. a past date with a future next date is late", () => {
      const late = record("PLANNED", "2026-09-10", {
        nextMaintenanceDate: toUtcDate("2027-03-14"),
      });

      expect(maintenanceUrgency(late, TODAY)).toEqual({
        level: OVERDUE,
        daysOverdue: 4,
      });
    });

    it("a next date in the past does not make an upcoming record late", () => {
      const upcoming = record("PLANNED", "2026-09-20", {
        nextMaintenanceDate: toUtcDate("2026-01-01"),
      });

      expect(maintenanceUrgency(upcoming, TODAY)?.level).toBe(UPCOMING);
    });
  });

  describe("kilometres", () => {
    /** The rule does not read them, so no reading can change the answer. */
    it.each([
      [null, null],
      [0, 0],
      [245_000, 275_000],
      [300_000, 275_000],
      [9_999_999, 1],
    ])("gives the same urgency with mileage %s and next mileage %s", (mileage, next) => {
      const withKilometres = record("PLANNED", "2026-09-12", {
        mileage,
        nextMaintenanceMileage: next,
        cost: new Prisma.Decimal("10.00"),
      });

      expect(maintenanceUrgency(withKilometres, TODAY)).toEqual({
        level: OVERDUE,
        daysOverdue: 2,
      });
    });

    it("never makes a future record due, however far past its next mileage", () => {
      const future = record("PLANNED", "2026-12-01", {
        mileage: 500_000,
        nextMaintenanceMileage: 100_000,
      });

      expect(maintenanceUrgency(future, TODAY)?.level).toBe(UPCOMING);
    });
  });
});
