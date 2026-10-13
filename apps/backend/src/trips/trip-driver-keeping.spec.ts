import { Driver, Trip, TripDriverSource, TripStatus } from "@prisma/client";

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
 * Which driver a Trip STORES (owner's rule, 13 October 2026).
 *
 * Truck A is Piet's until 23 August and Ahmet's from the 24th. A Trip storing
 * no driver SHOWS whoever has the truck on its date.
 *
 *   not yet finished → stores nothing unless a driver is CHOSEN for it, so it
 *     follows its truck and date wherever they move;
 *   CLOSED           → keeps the driver it showed, stored as AUTOMATIC when its
 *     truck or date moves;
 *   MANUAL / UNKNOWN → never touched by any automatic path.
 *
 * The real Trip and revision services and the real pinning service, against
 * one in-memory Trip.
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
    driverSource: null,
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

describe("which driver a Trip stores", () => {
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
      // The repository's compare-and-set: CLOSED and storing no driver only.
      pinDriver: jest.fn((_id: string, driverId: string) => {
        if (trip.driverId !== null || trip.status !== TripStatus.CLOSED) {
          return Promise.resolve(false);
        }
        write({ driverId, driverSource: TripDriverSource.AUTOMATIC });
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

  describe("12. a new Trip", () => {
    it("stores no driver: it follows its truck on its date", async () => {
      await trips.create({ vehicleId: TRUCK_A, planningDate: "2026-08-20" } as CreateTripDto);

      expect(trip).toMatchObject({ driverId: null, driverSource: null });
    });

    it("stores a driver given explicitly, as MANUAL", async () => {
      await trips.create({
        vehicleId: TRUCK_A,
        driverId: MARC,
        planningDate: "2026-08-20",
      } as CreateTripDto);

      expect(trip).toMatchObject({ driverId: MARC, driverSource: TripDriverSource.MANUAL });
    });
  });

  describe("6/7. a Trip not yet finished follows its truck and date", () => {
    it("by hand: a new date stores nothing", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A });

      await trips.update(TRIP_ID, { planningDate: "2026-08-26" });

      expect(trip).toMatchObject({ planningDate: day("2026-08-26"), driverId: null });
    });

    it("by hand: another truck stores nothing", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A });

      await trips.update(TRIP_ID, { vehicleId: TRUCK_B });

      expect(trip).toMatchObject({ vehicleId: TRUCK_B, driverId: null });
    });

    it("8. by a revised document: a new date stores nothing", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A });

      await revisions.applyDocumentRevision(revisedTo("2026-08-26"));

      expect(trip).toMatchObject({ planningDate: day("2026-08-26"), driverId: null });
    });
  });

  describe("3. a CLOSED Trip keeps the driver it showed", () => {
    it("when its date moves", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A, status: TripStatus.CLOSED });

      await trips.update(TRIP_ID, { planningDate: "2026-08-26" });

      expect(trip).toMatchObject({ driverId: PIET, driverSource: TripDriverSource.AUTOMATIC });
    });

    it("when it is given another truck", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A, status: TripStatus.CLOSED });

      await trips.update(TRIP_ID, { vehicleId: TRUCK_B });

      expect(trip).toMatchObject({ driverId: PIET, driverSource: TripDriverSource.AUTOMATIC });
    });

    it("writes nothing when neither moves", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A, status: TripStatus.CLOSED });

      await trips.update(TRIP_ID, { internalNotes: "bel vooraf" });

      expect(trip.driverId).toBeNull();
    });
  });

  describe("4/9/10. a chosen driver is never touched automatically", () => {
    it.each([TripDriverSource.MANUAL, TripDriverSource.UNKNOWN])(
      "a %s driver stays through a date change by hand and by a document",
      async (driverSource) => {
        trip = buildTrip({ vehicleId: TRUCK_A, driverId: MARC, driverSource });

        await trips.update(TRIP_ID, { planningDate: "2026-08-26" });
        await revisions.applyDocumentRevision(revisedTo("2026-08-27"));

        expect(trip).toMatchObject({ driverId: MARC, driverSource });
      },
    );

    it("a CLOSED Trip's MANUAL driver stays through a truck change", async () => {
      trip = buildTrip({
        vehicleId: TRUCK_A,
        driverId: MARC,
        driverSource: TripDriverSource.MANUAL,
        status: TripStatus.CLOSED,
      });

      await trips.update(TRIP_ID, { vehicleId: TRUCK_B });

      expect(trip).toMatchObject({ driverId: MARC, driverSource: TripDriverSource.MANUAL });
    });
  });

  describe("an explicit driver change on the Trip", () => {
    it("is applied as given, as MANUAL, and nothing is kept over it", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A, status: TripStatus.CLOSED });

      await trips.update(TRIP_ID, { driverId: AHMET, planningDate: "2026-08-10" });

      expect(trip).toMatchObject({ driverId: AHMET, driverSource: TripDriverSource.MANUAL });
    });

    it("a clear removes the driver and its source: the Trip follows its truck", async () => {
      trip = buildTrip({ vehicleId: TRUCK_A, driverId: PIET, driverSource: TripDriverSource.UNKNOWN });

      await trips.update(TRIP_ID, { driverId: null });

      expect(trip).toMatchObject({ driverId: null, driverSource: null });
    });
  });
});
