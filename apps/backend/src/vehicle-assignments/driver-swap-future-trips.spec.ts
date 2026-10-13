import { Driver, Trip, TripDriverSource, TripStatus } from "@prisma/client";

import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { EffectiveDriverSource } from "../trips/dto/trip-response.dto";
import { TripPlanningDataService } from "../trips/trip-planning-data.service";
import { TripRepository } from "../trips/trip.repository";
import { VehicleService } from "../vehicles/vehicle.service";
import { CurrentAssignmentService } from "./current-assignment.service";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";
import { InMemoryAssignmentRepository } from "./vehicle-assignment.repository.double";
import { VehicleAssignmentService } from "./vehicle-assignment.service";
import { VehicleDriverLinkService } from "./vehicle-driver-link.service";

/**
 * Ahmed drives truck A; Fatih replaces him from today.
 *
 * ── THE OWNER'S RULE (13 October 2026) ──────────────────────────────────────
 * Finished work keeps Ahmed. Work not yet finished, planned in Fatih's period,
 * shows Fatih — unless a driver was chosen for that Trip. Asserted on what the
 * API shows (`effectiveDriver`, from the REAL resolver) and on what the Trip
 * stores, after the REAL link service ran against the in-memory tables.
 *
 * Today is pinned to Tuesday 25 August 2026.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TODAY = "2026-08-25";
const TRUCK_A = "aaaaaaaa-1111-4111-8111-111111111111";
const TRUCK_B = "aaaaaaaa-2222-4222-8222-222222222222";
const AHMED = "bbbbbbbb-1111-4111-8111-111111111111";
const FATIH = "bbbbbbbb-2222-4222-8222-222222222222";
const MARC = "bbbbbbbb-3333-4333-8333-333333333333";
const NAMES: Record<string, string> = { [AHMED]: "Ahmed", [FATIH]: "Fatih", [MARC]: "Marc" };

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function driver(id: string): Driver {
  return { id, name: NAMES[id], isActive: true } as Driver;
}

describe("a driver swap and the Trips of the truck", () => {
  let repository: InMemoryAssignmentRepository;
  let links: VehicleDriverLinkService;
  let assignments: VehicleAssignmentService;
  let planningData: TripPlanningDataService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T09:30:00.000Z`));
    repository = new InMemoryAssignmentRepository(driver);

    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as AppLoggerService;
    const exists = { findById: jest.fn().mockResolvedValue({}) };
    const store = repository as unknown as VehicleAssignmentRepository;

    assignments = new VehicleAssignmentService(
      store,
      exists as unknown as VehicleService,
      exists as unknown as DriverService,
      logger,
    );
    links = new VehicleDriverLinkService(
      store,
      exists as unknown as VehicleService,
      exists as unknown as DriverService,
      logger,
    );
    planningData = new TripPlanningDataService(
      { findManyByIds: jest.fn().mockResolvedValue(new Map()) } as unknown as VehicleService,
      {
        findManyByIds: jest.fn((ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, driver(id)])))),
      } as unknown as DriverService,
      assignments,
      {
        findCustomPropertiesForTrips: jest.fn().mockResolvedValue([]),
        findAppliedUpdateHistory: jest.fn().mockResolvedValue([]),
      } as unknown as TripRepository,
      { findForTrips: jest.fn().mockResolvedValue(new Map()) } as unknown as CostConfirmationService,
      { findForTrips: () => Promise.resolve(new Map()) } as unknown as EffectivePricingService,
    );

    void repository.create({ vehicleId: TRUCK_A, driverId: AHMED, validFrom: day("2026-08-01"), validTo: null, notes: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function trip(id: string, planningDate: string, overrides: Partial<Trip> = {}): Trip {
    const created = {
      id,
      planningDate: day(planningDate),
      vehicleId: TRUCK_A,
      driverId: null,
      driverSource: null,
      status: TripStatus.OPEN,
      ...overrides,
    } as unknown as Trip;
    repository.trips.push(created);

    return created;
  }

  /** What the Rittenlijst and the Trip detail show for a Trip. */
  async function shown(subject: Trip) {
    const { effectiveDriver } = await planningData.resolveOne(subject);

    return effectiveDriver ? { name: effectiveDriver.name, source: effectiveDriver.source } : null;
  }

  const swapToFatih = () => links.link({ vehicleId: TRUCK_A, driverId: FATIH });

  it("1. Fatih becomes the truck's current driver; Ahmed's period stays as history", async () => {
    await swapToFatih();

    expect(repository.rows.map((row) => [row.driverId, row.validTo?.toISOString().slice(0, 10) ?? null])).toEqual([
      [AHMED, "2026-08-24"],
      [FATIH, null],
    ]);
  });

  it("2/7. future OPEN Trips in Fatih's period show Fatih, from the vehicle assignment", async () => {
    const today = trip("open-today", TODAY);
    const nextWeek = trip("open-next-week", "2026-09-01");

    await swapToFatih();

    expect(await shown(today)).toEqual({ name: "Fatih", source: EffectiveDriverSource.VehicleAssignment });
    expect(await shown(nextWeek)).toEqual({ name: "Fatih", source: EffectiveDriverSource.VehicleAssignment });
    expect([today.driverId, nextWeek.driverId]).toEqual([null, null]);
  });

  it("6. an OPEN Trip dated before Fatih's period still shows Ahmed, the driver of its own date", async () => {
    const yesterday = trip("open-yesterday", "2026-08-24");

    await swapToFatih();

    expect(await shown(yesterday)).toEqual({ name: "Ahmed", source: EffectiveDriverSource.VehicleAssignment });
  });

  it("3. a CLOSED Trip in Fatih's period keeps Ahmed, recorded as such", async () => {
    const finished = trip("closed-today", TODAY, { status: TripStatus.CLOSED });

    await swapToFatih();

    expect(finished).toMatchObject({ driverId: AHMED, driverSource: TripDriverSource.AUTOMATIC });
    expect(await shown(finished)).toEqual({ name: "Ahmed", source: EffectiveDriverSource.Recorded });
  });

  it("4. a driver chosen for an OPEN Trip stays chosen", async () => {
    const chosen = trip("chosen", "2026-09-01", { driverId: MARC, driverSource: TripDriverSource.MANUAL });

    await swapToFatih();

    expect(await shown(chosen)).toEqual({ name: "Marc", source: EffectiveDriverSource.Override });
  });

  it("8. a stored driver of unknown origin is never replaced, and says so", async () => {
    const legacy = trip("legacy", "2026-09-01", { driverId: AHMED, driverSource: TripDriverSource.UNKNOWN });

    await swapToFatih();

    expect(legacy).toMatchObject({ driverId: AHMED, driverSource: TripDriverSource.UNKNOWN });
    expect(await shown(legacy)).toEqual({ name: "Ahmed", source: EffectiveDriverSource.StoredUnknownOrigin });
  });

  it("13. the vehicle list and today's Trip name the same driver", async () => {
    const today = trip("open-today", TODAY);

    await swapToFatih();

    const current = await new CurrentAssignmentService(
      repository as unknown as VehicleAssignmentRepository,
    ).findCurrentDriversForVehicles([TRUCK_A]);
    expect(current.get(TRUCK_A)?.name).toBe("Fatih");
    expect((await shown(today))?.name).toBe("Fatih");
  });

  it("5. Trips of truck B are untouched", async () => {
    const other = trip("truck-b", TODAY, { vehicleId: TRUCK_B, status: TripStatus.CLOSED });

    await swapToFatih();

    expect(other.driverId).toBeNull();
  });

  it("11. ending Fatih's link later leaves his OPEN Trips without a driver, his finished ones with him", async () => {
    await swapToFatih();
    const fatihsLink = repository.rows.find((row) => row.driverId === FATIH)!;
    jest.setSystemTime(new Date("2026-08-28T09:00:00.000Z"));
    const open = trip("open-later", "2026-08-30");
    const finished = trip("closed-later", "2026-08-28", { status: TripStatus.CLOSED });

    await assignments.end(fatihsLink.id, {});

    expect(await shown(open)).toBeNull();
    expect(await shown(finished)).toEqual({ name: "Fatih", source: EffectiveDriverSource.Recorded });
  });
});
