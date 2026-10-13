import { Driver, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import {
  VehicleAssignmentService,
  VehicleOnDate,
  assignmentKey,
} from "../vehicle-assignments/vehicle-assignment.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { CreateTripDto } from "./dto/create-trip.dto";
import { ImportedTripData } from "./import-trips.command";
import { TripDriverPinningService } from "./trip-driver-pinning.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRevisionService } from "./trip-revision.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * A Trip keeps the driver it was planned with.
 *
 * Truck A is Piet's until 23 August and Ahmet's from the 24th. A Trip that
 * stores no driver SHOWS whoever has the truck on its date — so moving the date
 * across the 24th, or giving it another truck, would quietly hand the work to
 * somebody else. These tests run the real Trip and revision services, and the
 * real pinning service, against one in-memory Trip.
 */

const TRIP_ID = "trip-1";
const TRUCK_A = "truck-a";
const TRUCK_B = "truck-b";
const PIET = "driver-piet";
const AHMET = "driver-ahmet";
const MARC = "driver-marc";
const BOOKING = "ANRDUB2602247";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Who drives which truck on which day. */
function assignedDriver(vehicleId: string, onDate: Date): string | null {
  if (vehicleId === TRUCK_B) {
    return MARC;
  }

  return onDate.getTime() < day("2026-08-24").getTime() ? PIET : AHMET;
}

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    pdfDocumentId: null,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    bookingNumber: BOOKING,
    containerNumber: null,
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "Lokeren",
    direction: "DELIVERY",
    originalPlanningDate: day("2026-08-20"),
    planningDate: day("2026-08-20"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeEndsNextDay: false,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: day("2026-08-01"),
    updatedAt: day("2026-08-01"),
    ...overrides,
  } as Trip;
}

describe("a Trip keeps the driver it was planned with", () => {
  let trip: Trip;
  let trips: TripService;
  let revisions: TripRevisionService;

  beforeEach(() => {
    trip = buildTrip();

    const write = (data: Partial<Trip>): Trip => {
      const defined = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      );
      trip = { ...trip, ...defined } as Trip;
      return trip;
    };
    const tripTable = {
      findById: jest.fn(() => Promise.resolve(trip)),
      findByIdentity: jest.fn().mockResolvedValue(null),
      findManyByBookingNumberAndOriginalDate: jest.fn(() => Promise.resolve([trip])),
      findManyByGroupId: jest.fn().mockResolvedValue([]),
      create: jest.fn((data: Partial<Trip>) => Promise.resolve(write(data))),
      update: jest.fn((_id: string, data: Partial<Trip>) => Promise.resolve(write(data))),
      pinDriver: jest.fn((_id: string, driverId: string) => {
        if (trip.driverId !== null) {
          return Promise.resolve(false);
        }
        write({ driverId });
        return Promise.resolve(true);
      }),
      recordHistory: jest.fn().mockResolvedValue(undefined),
      runTripWriteTransaction: jest.fn(),
    };
    tripTable.runTripWriteTransaction.mockImplementation(
      (work: (repositories: unknown) => unknown) =>
        work({ trips: tripTable, customProperties: {} }),
    );

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;
    const assignments = {
      findDriversForVehiclesOnDates: (requests: readonly VehicleOnDate[]) =>
        Promise.resolve(
          new Map(
            requests.map((request) => [
              assignmentKey(request.vehicleId, request.onDate),
              { id: assignedDriver(request.vehicleId, request.onDate) } as Driver,
            ]),
          ),
        ),
    } as unknown as VehicleAssignmentService;
    const pinning = new TripDriverPinningService(assignments, logger);
    const automaticFlat = {
      applyToNewTrip: jest.fn(),
      synchronise: jest.fn(),
    } as unknown as AutomaticFlatPropertyService;
    const recalculation = stubPricingRecalculation();

    trips = new TripService(
      tripTable as unknown as TripRepository,
      { findById: jest.fn().mockResolvedValue({ isActive: true }) } as unknown as VehicleService,
      { findById: jest.fn().mockResolvedValue({ isActive: true }) } as unknown as DriverService,
      {
        resolveOne: jest.fn().mockResolvedValue({ vehicle: null, effectiveDriver: null }),
      } as unknown as TripPlanningDataService,
      pinning,
      automaticFlat,
      recalculation,
      { publish: jest.fn() } as unknown as DomainEventBus,
      logger,
    );
    revisions = new TripRevisionService(
      tripTable as unknown as TripRepository,
      automaticFlat,
      recalculation,
      pinning,
      logger,
    );
  });

  /** A later order for the same transport, on another date. */
  function revisedTo(planningDate: string): ImportedTripData {
    return {
      bookingNumber: BOOKING,
      containerNumber: null,
      containerType: "45PH",
      terminal: "Quay 869",
      destinationCity: "Lokeren",
      destinationCountry: "Belgium",
      planningDate,
      startTime: null,
      endTime: null,
      direction: "DELIVERY",
      parserMetadata: { direction: "DELIVERY" },
    } as ImportedTripData;
  }

  describe("11. a new Trip", () => {
    it("stores the driver of its truck on its date", async () => {
      await trips.create({ vehicleId: TRUCK_A, planningDate: "2026-08-20" } as CreateTripDto);

      expect(trip.driverId).toBe(PIET);
    });

    it("keeps a driver given explicitly", async () => {
      await trips.create({
        vehicleId: TRUCK_A,
        driverId: MARC,
        planningDate: "2026-08-20",
      } as CreateTripDto);

      expect(trip.driverId).toBe(MARC);
    });

    it("stores nothing without a truck or a date", async () => {
      await trips.create({ planningDate: "2026-08-20" } as CreateTripDto);
      expect(trip.driverId).toBeNull();

      await trips.create({ vehicleId: TRUCK_A } as CreateTripDto);
      expect(trip.driverId).toBeNull();
    });
  });

  describe("10. a planning date that moves", () => {
    it("by hand: the Trip keeps the driver it showed", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A });

      await trips.update(TRIP_ID, { planningDate: "2026-08-26" });

      expect(trip).toMatchObject({ planningDate: day("2026-08-26"), driverId: PIET });
    });

    it("by a revised document: the Trip keeps the driver it showed", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A });

      await revisions.applyDocumentRevision(revisedTo("2026-08-26"));

      expect(trip).toMatchObject({ planningDate: day("2026-08-26"), driverId: PIET });
    });

    it("never replaces a driver the Trip already stores", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A, driverId: MARC });

      await trips.update(TRIP_ID, { planningDate: "2026-08-26" });
      await revisions.applyDocumentRevision(revisedTo("2026-08-27"));

      expect(trip.driverId).toBe(MARC);
    });

    it("writes nothing when the date does not move", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A });

      await trips.update(TRIP_ID, { internalNotes: "bel vooraf" });

      expect(trip.driverId).toBeNull();
    });
  });

  describe("9. another truck", () => {
    it("keeps the driver the Trip showed", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A });

      await trips.update(TRIP_ID, { vehicleId: TRUCK_B });

      expect(trip).toMatchObject({ vehicleId: TRUCK_B, driverId: PIET });
    });

    it("a Trip with no truck yet gets the driver of the truck it is given", async () => {
      await trips.update(TRIP_ID, { vehicleId: TRUCK_B });

      expect(trip.driverId).toBe(MARC);
    });
  });

  describe("12. an explicit driver change on the Trip", () => {
    it("is applied as given, and nothing is pinned over it", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A, driverId: PIET });

      await trips.update(TRIP_ID, { driverId: AHMET, planningDate: "2026-08-10" });

      expect(trip.driverId).toBe(AHMET);
    });

    it("clearing it is honoured too", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A, driverId: PIET });

      await trips.update(TRIP_ID, { driverId: null, planningDate: "2026-08-26" });

      expect(trip.driverId).toBeNull();
    });
  });
});
