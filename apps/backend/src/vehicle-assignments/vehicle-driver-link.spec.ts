import { Driver, Trip } from "@prisma/client";

import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { isInEffectOn } from "./assignment-period";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";
import { InMemoryAssignmentRepository } from "./vehicle-assignment.repository.double";
import { VehicleAssignmentService } from "./vehicle-assignment.service";
import { VehicleDriverLinkService } from "./vehicle-driver-link.service";

/**
 * Linking a driver to a truck from the management page, and ending a link.
 *
 * The REAL services against an in-memory assignment table that also holds
 * Trips, so what is asserted is the outcome: who drives which truck today, what
 * history is left, and which driver every Trip ends up with.
 *
 * Today is pinned to Tuesday 25 August 2026.
 */

const TODAY = "2026-08-25";
const YESTERDAY = "2026-08-24";

const TRUCK_A = "aaaaaaaa-1111-4111-8111-111111111111";
const TRUCK_B = "aaaaaaaa-2222-4222-8222-222222222222";
const PIET = "bbbbbbbb-2222-4222-8222-222222222222";
const AHMET = "cccccccc-3333-4333-8333-333333333333";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function driver(id: string): Driver {
  return { id, name: id, isActive: true } as Driver;
}

function trip(id: string, planningDate: string, vehicleId: string, driverId: string | null = null): Trip {
  return { id, planningDate: day(planningDate), vehicleId, driverId } as unknown as Trip;
}

describe("linking a driver to a vehicle", () => {
  let repository: InMemoryAssignmentRepository;
  let links: VehicleDriverLinkService;
  let assignments: VehicleAssignmentService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T09:30:00.000Z`));
    repository = new InMemoryAssignmentRepository(driver);

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as AppLoggerService;
    const vehicles = { findById: jest.fn().mockResolvedValue({}) } as unknown as VehicleService;
    const drivers = { findById: jest.fn().mockResolvedValue({}) } as unknown as DriverService;
    const store = repository as unknown as VehicleAssignmentRepository;

    links = new VehicleDriverLinkService(store, vehicles, drivers, logger);
    assignments = new VehicleAssignmentService(store, vehicles, drivers, logger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** An open-ended assignment that began on `from`. */
  function given(vehicleId: string, driverId: string, from: string): void {
    void repository.create({ vehicleId, driverId, validFrom: day(from), validTo: null, notes: null });
  }

  /** Who drives each truck today, as the assignment table says. */
  function driversToday(): Record<string, string> {
    return Object.fromEntries(
      repository.rows
        .filter((row) => isInEffectOn(row, day(TODAY)))
        .map((row) => [row.vehicleId, row.driverId]),
    );
  }

  it("1. links a free driver to a free truck from today, open-ended", async () => {
    const result = await links.link({ vehicleId: TRUCK_A, driverId: PIET });

    expect(result).toMatchObject({
      outcome: "LINKED",
      assignment: { vehicleId: TRUCK_A, driverId: PIET, validFrom: TODAY, validTo: null },
      endedAssignments: [],
    });
    expect(driversToday()).toEqual({ [TRUCK_A]: PIET });
  });

  it("2. moves a driver from truck A to truck B", async () => {
    given(TRUCK_A, PIET, "2026-08-01");

    const result = await links.link({ vehicleId: TRUCK_B, driverId: PIET });

    expect(result.endedAssignments).toEqual([
      expect.objectContaining({ vehicleId: TRUCK_A, driverId: PIET, validTo: YESTERDAY }),
    ]);
    expect(driversToday()).toEqual({ [TRUCK_B]: PIET });
  });

  it("3. replaces the current driver of a truck", async () => {
    given(TRUCK_A, PIET, "2026-08-01");

    await links.link({ vehicleId: TRUCK_A, driverId: AHMET });

    expect(driversToday()).toEqual({ [TRUCK_A]: AHMET });
  });

  it("4/5. ends both the truck's driver and the driver's truck, then links", async () => {
    given(TRUCK_A, PIET, "2026-08-01");
    given(TRUCK_B, AHMET, "2026-08-01");

    const result = await links.link({ vehicleId: TRUCK_A, driverId: AHMET });

    expect(result.endedAssignments.map((ended) => [ended.vehicleId, ended.validTo])).toEqual(
      expect.arrayContaining([
        [TRUCK_A, YESTERDAY],
        [TRUCK_B, YESTERDAY],
      ]),
    );
    expect(driversToday()).toEqual({ [TRUCK_A]: AHMET });
  });

  it("5. ends a conflicting assignment planned to start later", async () => {
    given(TRUCK_B, AHMET, "2026-09-01");

    await links.link({ vehicleId: TRUCK_A, driverId: AHMET });

    const planned = repository.rows.find((row) => row.vehicleId === TRUCK_B);
    // Ended before it began: kept, in effect on no day.
    expect(planned?.validTo).toEqual(day("2026-08-31"));
    expect(planned?.validFrom).toEqual(day("2026-09-01"));
  });

  it("6. an identical link changes nothing and creates no duplicate", async () => {
    given(TRUCK_A, PIET, "2026-08-01");

    const result = await links.link({ vehicleId: TRUCK_A, driverId: PIET });

    expect(result.outcome).toBe("ALREADY_LINKED");
    expect(result.assignment.validFrom).toBe("2026-08-01");
    expect(repository.rows).toHaveLength(1);
  });

  it("8. keeps every earlier assignment as history", async () => {
    given(TRUCK_A, PIET, "2026-08-01");

    await links.link({ vehicleId: TRUCK_A, driverId: AHMET });
    await links.link({ vehicleId: TRUCK_A, driverId: PIET });

    expect(repository.rows.map((row) => row.driverId)).toEqual([PIET, AHMET, PIET]);
    // Ahmet's link began and ended today: never in effect, still recorded.
    expect(repository.rows[1]).toMatchObject({ validFrom: day(TODAY), validTo: day(YESTERDAY) });
    expect(driversToday()).toEqual({ [TRUCK_A]: PIET });
  });

  describe("9. Trips keep their driver through a new link", () => {
    it("pins the driver a Trip showed on the days the old link gives up", async () => {
      given(TRUCK_A, PIET, "2026-08-01");
      const today = trip("today", TODAY, TRUCK_A);
      const nextWeek = trip("next-week", "2026-09-01", TRUCK_A);
      const lastWeek = trip("last-week", "2026-08-18", TRUCK_A);
      repository.trips.push(today, nextWeek, lastWeek);

      await links.link({ vehicleId: TRUCK_A, driverId: AHMET });

      expect(today.driverId).toBe(PIET);
      expect(nextWeek.driverId).toBe(PIET);
      // Still covered by Piet's period, so it needs nothing written.
      expect(lastWeek.driverId).toBeNull();
    });

    it("never overwrites a driver a Trip already stores", async () => {
      given(TRUCK_A, PIET, "2026-08-01");
      const chosen = trip("chosen", "2026-09-01", TRUCK_A, AHMET);
      repository.trips.push(chosen);

      await links.link({ vehicleId: TRUCK_A, driverId: AHMET });

      expect(chosen.driverId).toBe(AHMET);
    });

    it("leaves Trips of other trucks alone", async () => {
      given(TRUCK_A, PIET, "2026-08-01");
      const other = trip("other", TODAY, TRUCK_B);
      repository.trips.push(other);

      await links.link({ vehicleId: TRUCK_A, driverId: AHMET });

      expect(other.driverId).toBeNull();
    });
  });

  describe("7. ending an assignment", () => {
    it("makes it inactive from today: yesterday is its last day", async () => {
      given(TRUCK_A, PIET, "2026-08-01");
      const today = trip("today", TODAY, TRUCK_A);
      repository.trips.push(today);

      const ended = await assignments.end(repository.rows[0].id, {});

      expect(ended.validTo).toBe(YESTERDAY);
      expect(driversToday()).toEqual({});
      expect(today.driverId).toBe(PIET);
    });

    it("keeps one that began today as history, in effect on no day", async () => {
      given(TRUCK_A, PIET, TODAY);

      const ended = await assignments.end(repository.rows[0].id, {});

      expect(ended).toMatchObject({ validFrom: TODAY, validTo: YESTERDAY });
      expect(repository.rows).toHaveLength(1);
      expect(driversToday()).toEqual({});
    });

    it("after midnight, ends as of the new day", async () => {
      given(TRUCK_A, PIET, "2026-08-01");
      jest.setSystemTime(new Date("2026-08-26T00:00:01.000Z"));

      const ended = await assignments.end(repository.rows[0].id, {});

      expect(ended.validTo).toBe(TODAY);
    });
  });
});
