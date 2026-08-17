import { Driver, Trip, Vehicle } from "@prisma/client";

import { DriverService } from "../drivers/driver.service";
import { EffectiveDriverSource } from "./dto/trip-response.dto";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { VehicleAssignmentService, assignmentKey } from "../vehicle-assignments/vehicle-assignment.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { TripRepository } from "./trip.repository";

/**
 * Effective-driver resolution.
 *
 * The rule under test: `trip.driverId` is an OVERRIDE, and when it is absent
 * the driver comes from the VehicleAssignment covering the Trip's planning
 * date. Getting this wrong puts a plausible but wrong name on a Trip, which is
 * why every branch is covered explicitly.
 */

const VEHICLE_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const OTHER_VEHICLE_ID = "3d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const OVERRIDE_DRIVER_ID = "4d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const ASSIGNED_DRIVER_ID = "5d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    planningDate: day("2026-03-15"),
    vehicleId: null,
    driverId: null,
    ...overrides,
  } as unknown as Trip;
}

function buildVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: VEHICLE_ID,
    licensePlate: "1-ABC-123",
    displayColor: "#2563EB",
    isActive: true,
    ...overrides,
  } as Vehicle;
}

function buildDriver(id: string, overrides: Partial<Driver> = {}): Driver {
  return {
    id,
    name: id === OVERRIDE_DRIVER_ID ? "Override Driver" : "Assigned Driver",
    isActive: true,
    ...overrides,
  } as Driver;
}

describe("TripPlanningDataService", () => {
  let vehicleService: { findManyByIds: jest.Mock };
  let driverService: { findManyByIds: jest.Mock };
  let assignmentService: { findDriversForVehiclesOnDates: jest.Mock };
  let tripRepository: { findCustomPropertiesForTrips: jest.Mock };
  let service: TripPlanningDataService;

  beforeEach(() => {
    vehicleService = { findManyByIds: jest.fn().mockResolvedValue(new Map()) };
    driverService = { findManyByIds: jest.fn().mockResolvedValue(new Map()) };
    assignmentService = {
      findDriversForVehiclesOnDates: jest.fn().mockResolvedValue(new Map()),
    };
    // Custom Properties are resolved here too, in one query for the page.
    tripRepository = {
      findCustomPropertiesForTrips: jest.fn().mockResolvedValue([]),
    };

    service = new TripPlanningDataService(
      vehicleService as unknown as VehicleService,
      driverService as unknown as DriverService,
      assignmentService as unknown as VehicleAssignmentService,
      tripRepository as unknown as TripRepository,
    );
  });

  describe("A — an explicit override", () => {
    beforeEach(() => {
      driverService.findManyByIds.mockResolvedValue(
        new Map([[OVERRIDE_DRIVER_ID, buildDriver(OVERRIDE_DRIVER_ID)]]),
      );
    });

    it("uses the override driver", async () => {
      const trip = buildTrip({ driverId: OVERRIDE_DRIVER_ID });

      const { effectiveDriver } = await service.resolveOne(trip);

      expect(effectiveDriver).toMatchObject({
        id: OVERRIDE_DRIVER_ID,
        name: "Override Driver",
        source: EffectiveDriverSource.Override,
      });
    });

    /** An override is an override: it wins even against a valid assignment. */
    it("prefers the override over the vehicle's assignment", async () => {
      assignmentService.findDriversForVehiclesOnDates.mockResolvedValue(
        new Map([
          [
            assignmentKey(VEHICLE_ID, day("2026-03-15")),
            buildDriver(ASSIGNED_DRIVER_ID),
          ],
        ]),
      );

      const trip = buildTrip({
        driverId: OVERRIDE_DRIVER_ID,
        vehicleId: VEHICLE_ID,
      });

      const { effectiveDriver } = await service.resolveOne(trip);

      expect(effectiveDriver?.id).toBe(OVERRIDE_DRIVER_ID);
    });

    it("does not consult assignments for a trip that has an override", async () => {
      const trip = buildTrip({
        driverId: OVERRIDE_DRIVER_ID,
        vehicleId: VEHICLE_ID,
      });

      await service.resolveOne(trip);

      expect(
        assignmentService.findDriversForVehiclesOnDates,
      ).toHaveBeenCalledWith([]);
    });

    /** A trip can be given to a driver before a truck is chosen. */
    it("resolves an override even without a vehicle", async () => {
      const trip = buildTrip({ driverId: OVERRIDE_DRIVER_ID, vehicleId: null });

      const { effectiveDriver } = await service.resolveOne(trip);

      expect(effectiveDriver?.id).toBe(OVERRIDE_DRIVER_ID);
    });
  });

  describe("B — resolved through the vehicle assignment", () => {
    it("uses the driver assigned on the trip's planning date", async () => {
      assignmentService.findDriversForVehiclesOnDates.mockResolvedValue(
        new Map([
          [
            assignmentKey(VEHICLE_ID, day("2026-03-15")),
            buildDriver(ASSIGNED_DRIVER_ID),
          ],
        ]),
      );

      const trip = buildTrip({ vehicleId: VEHICLE_ID });

      const { effectiveDriver } = await service.resolveOne(trip);

      expect(effectiveDriver).toMatchObject({
        id: ASSIGNED_DRIVER_ID,
        name: "Assigned Driver",
        source: EffectiveDriverSource.VehicleAssignment,
      });
    });

    it("asks about the trip's own planning date, not today", async () => {
      const trip = buildTrip({
        vehicleId: VEHICLE_ID,
        planningDate: day("2025-11-04"),
      });

      await service.resolveOne(trip);

      expect(
        assignmentService.findDriversForVehiclesOnDates,
      ).toHaveBeenCalledWith([
        { vehicleId: VEHICLE_ID, onDate: day("2025-11-04") },
      ]);
    });

    /** No assignment covers that day: the answer is "nobody", not a guess. */
    it("yields no driver when the assignment does not cover the date", async () => {
      assignmentService.findDriversForVehiclesOnDates.mockResolvedValue(
        new Map(),
      );

      const trip = buildTrip({ vehicleId: VEHICLE_ID });

      const { effectiveDriver } = await service.resolveOne(trip);

      expect(effectiveDriver).toBeNull();
    });
  });

  describe("C — no effective driver", () => {
    it("yields null for a trip with neither override nor vehicle", async () => {
      const { effectiveDriver } = await service.resolveOne(buildTrip());

      expect(effectiveDriver).toBeNull();
    });

    it("yields null when the override driver no longer exists", async () => {
      driverService.findManyByIds.mockResolvedValue(new Map());

      const trip = buildTrip({ driverId: OVERRIDE_DRIVER_ID });

      const { effectiveDriver } = await service.resolveOne(trip);

      expect(effectiveDriver).toBeNull();
    });
  });

  describe("inactive drivers and vehicles", () => {
    /**
     * Deactivation does not rewrite who drove a Trip. The Trip domain takes the
     * same position: it re-checks active state only when an assignment CHANGES,
     * so a Trip carrying a since-deactivated driver stays valid.
     */
    it("still resolves an inactive override driver, flagged as inactive", async () => {
      driverService.findManyByIds.mockResolvedValue(
        new Map([
          [
            OVERRIDE_DRIVER_ID,
            buildDriver(OVERRIDE_DRIVER_ID, { isActive: false }),
          ],
        ]),
      );

      const trip = buildTrip({ driverId: OVERRIDE_DRIVER_ID });

      const { effectiveDriver } = await service.resolveOne(trip);

      expect(effectiveDriver).toMatchObject({
        id: OVERRIDE_DRIVER_ID,
        isActive: false,
      });
    });

    it("still resolves an inactive assigned driver", async () => {
      assignmentService.findDriversForVehiclesOnDates.mockResolvedValue(
        new Map([
          [
            assignmentKey(VEHICLE_ID, day("2026-03-15")),
            buildDriver(ASSIGNED_DRIVER_ID, { isActive: false }),
          ],
        ]),
      );

      const trip = buildTrip({ vehicleId: VEHICLE_ID });

      const { effectiveDriver } = await service.resolveOne(trip);

      expect(effectiveDriver?.isActive).toBe(false);
    });

    it("still shows an inactive vehicle, flagged as inactive", async () => {
      vehicleService.findManyByIds.mockResolvedValue(
        new Map([[VEHICLE_ID, buildVehicle({ isActive: false })]]),
      );

      const trip = buildTrip({ vehicleId: VEHICLE_ID });

      const { vehicle } = await service.resolveOne(trip);

      expect(vehicle).toMatchObject({
        licensePlate: "1-ABC-123",
        isActive: false,
      });
    });
  });

  describe("the vehicle summary", () => {
    it("carries what a planning view needs and nothing more", async () => {
      vehicleService.findManyByIds.mockResolvedValue(
        new Map([[VEHICLE_ID, buildVehicle()]]),
      );

      const { vehicle } = await service.resolveOne(
        buildTrip({ vehicleId: VEHICLE_ID }),
      );

      expect(Object.keys(vehicle ?? {}).sort()).toEqual([
        "displayColor",
        "id",
        "isActive",
        "licensePlate",
      ]);
    });

    it("is null for a trip with no vehicle", async () => {
      const { vehicle } = await service.resolveOne(buildTrip());

      expect(vehicle).toBeNull();
    });
  });

  describe("resolving a page", () => {
    /**
     * The N+1 guarantee, expressed as a test: however many Trips are resolved,
     * each collaborator is consulted exactly once.
     */
    it("consults each collaborator once for a whole page", async () => {
      const trips = Array.from({ length: 25 }, (_, index) =>
        buildTrip({
          id: `trip-${index}`,
          vehicleId: index % 2 === 0 ? VEHICLE_ID : OTHER_VEHICLE_ID,
          planningDate: day(`2026-03-${String((index % 28) + 1).padStart(2, "0")}`),
        }),
      );

      await service.resolveMany(trips);

      expect(vehicleService.findManyByIds).toHaveBeenCalledTimes(1);
      expect(driverService.findManyByIds).toHaveBeenCalledTimes(1);
      expect(
        assignmentService.findDriversForVehiclesOnDates,
      ).toHaveBeenCalledTimes(1);
    });

    it("asks for each distinct vehicle once, however many trips share it", async () => {
      const trips = Array.from({ length: 10 }, (_, index) =>
        buildTrip({ id: `trip-${index}`, vehicleId: VEHICLE_ID }),
      );

      await service.resolveMany(trips);

      expect(vehicleService.findManyByIds).toHaveBeenCalledWith([VEHICLE_ID]);
    });

    it("resolves each trip against its own planning date", async () => {
      assignmentService.findDriversForVehiclesOnDates.mockResolvedValue(
        new Map([
          [
            assignmentKey(VEHICLE_ID, day("2026-03-15")),
            buildDriver(ASSIGNED_DRIVER_ID),
          ],
        ]),
      );

      const covered = buildTrip({ id: "covered", vehicleId: VEHICLE_ID });
      const uncovered = buildTrip({
        id: "uncovered",
        vehicleId: VEHICLE_ID,
        planningDate: day("2026-09-09"),
      });

      const resolved = await service.resolveMany([covered, uncovered]);

      expect(resolved.get("covered")?.effectiveDriver?.id).toBe(
        ASSIGNED_DRIVER_ID,
      );
      expect(resolved.get("uncovered")?.effectiveDriver).toBeNull();
    });

    it("returns an entry for every trip it was given", async () => {
      const trips = [buildTrip({ id: "a" }), buildTrip({ id: "b" })];

      const resolved = await service.resolveMany(trips);

      expect([...resolved.keys()].sort()).toEqual(["a", "b"]);
    });

    it("touches nothing for an empty page", async () => {
      const resolved = await service.resolveMany([]);

      expect(resolved.size).toBe(0);
      expect(vehicleService.findManyByIds).not.toHaveBeenCalled();
      expect(
        assignmentService.findDriversForVehiclesOnDates,
      ).not.toHaveBeenCalled();
    });
  });
});
