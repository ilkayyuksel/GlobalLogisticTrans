import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { CreateTripDto } from "./dto/create-trip.dto";
import {
  DuplicateBookingNumberException,
  InactiveAssignmentException,
  InvalidTripStatusTransitionException,
  TripNotDeletableException,
  TripNotDeletedException,
  TripNotFoundException,
  UnknownPdfDocumentException,
} from "./exceptions/trip.exceptions";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { TripPlanningDataService } from "./trip-planning-data.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_TRIP_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const PDF_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const VEHICLE_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const DRIVER_ID = "4d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    pdfDocumentId: PDF_ID,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    direction: null,
    bookingNumber: "BK-2026-0042",
    containerNumber: null,
    containerType: "45PH",
    terminal: null,
    destinationCity: "Bousbecque",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-17T00:00:00.000Z"),
    planningDate: new Date("2026-08-17T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildCreateDto(overrides: Partial<CreateTripDto> = {}): CreateTripDto {
  return {
    pdfDocumentId: PDF_ID,
    bookingNumber: "BK-2026-0042",
    containerType: "45PH",
    destinationCity: "Bousbecque",
    destinationCountry: "France",
    originalPlanningDate: "2026-08-17",
    planningDate: "2026-08-17",
    ...overrides,
  } as CreateTripDto;
}

describe("TripService", () => {
  let repository: jest.Mocked<TripRepository>;
  let vehicleService: { findById: jest.Mock };
  let driverService: { findById: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let eventBus: { publish: jest.Mock };
  let service: TripService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findByBookingNumber: jest.fn().mockResolvedValue(null),
      pdfDocumentExists: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue(buildTrip()),
      update: jest.fn().mockResolvedValue(buildTrip()),
      setStatus: jest.fn().mockResolvedValue(buildTrip()),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    // The transaction hands the callback a repository; the double simply passes
    // the same one through so the assertions see every call.
    (repository.runInTransaction as jest.Mock).mockImplementation(
      (work: (repo: TripRepository) => Promise<unknown>) => work(repository),
    );

    vehicleService = {
      findById: jest.fn().mockResolvedValue({ id: VEHICLE_ID, isActive: true }),
    };
    driverService = {
      findById: jest.fn().mockResolvedValue({ id: DRIVER_ID, isActive: true }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };

    service = new TripService(
      repository,
      vehicleService as unknown as VehicleService,
      driverService as unknown as DriverService,
      {
        resolveOne: () =>
          Promise.resolve({ vehicle: null, effectiveDriver: null }),
        resolveMany: (trips: readonly { id: string }[]) =>
          Promise.resolve(
            new Map(
              trips.map((trip) => [
                trip.id,
                { vehicle: null, effectiveDriver: null },
              ]),
            ),
          ),
      } as unknown as TripPlanningDataService,
      eventBus as unknown as DomainEventBus,
      logger as unknown as AppLoggerService,
    );
  });

  describe("findAll", () => {
    it("hides DELETED Trips unless a status is requested", async () => {
      await service.findAll({ page: 1, pageSize: 25 });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ excludeStatuses: [TripStatus.DELETED] }),
      );
    });

    it("converts the calendar dates to UTC midnight", async () => {
      await service.findAll({
        page: 1,
        pageSize: 25,
        planningDate: "2026-08-17",
        planningDateFrom: "2026-08-10",
        planningDateTo: "2026-08-23",
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          planningDate: new Date("2026-08-17T00:00:00.000Z"),
          planningDateFrom: new Date("2026-08-10T00:00:00.000Z"),
          planningDateTo: new Date("2026-08-23T00:00:00.000Z"),
        }),
      );
    });

    it("passes the TripGroup filter through to the repository", async () => {
      await service.findAll({
        page: 1,
        pageSize: 25,
        tripGroupId: "97777777-7777-4777-8777-777777777777",
      });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          tripGroupId: "97777777-7777-4777-8777-777777777777",
        }),
      );
    });

    it("translates page and pageSize into skip and take", async () => {
      await service.findAll({ page: 3, pageSize: 10 });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it("returns pagination metadata alongside the items", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildTrip()],
        totalItems: 42,
      });

      const result = await service.findAll({ page: 2, pageSize: 25 });

      expect(result.meta).toEqual({
        page: 2,
        pageSize: 25,
        totalItems: 42,
        totalPages: 2,
      });
      expect(result.items).toHaveLength(1);
    });
  });

  describe("findById", () => {
    it("returns the Trip", async () => {
      repository.findById.mockResolvedValue(buildTrip());

      expect((await service.findById(TRIP_ID)).id).toBe(TRIP_ID);
    });

    it("throws when the Trip does not exist", async () => {
      await expect(service.findById(TRIP_ID)).rejects.toBeInstanceOf(
        TripNotFoundException,
      );
    });
  });

  describe("create", () => {
    it("rejects an unknown PDF document before writing anything", async () => {
      repository.pdfDocumentExists.mockResolvedValue(false);

      await expect(service.create(buildCreateDto())).rejects.toBeInstanceOf(
        UnknownPdfDocumentException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("stores the dates as UTC midnight and the times as UTC clock values", async () => {
      await service.create(
        buildCreateDto({ startTime: "08:00", endTime: "12:30:45" }),
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalPlanningDate: new Date("2026-08-17T00:00:00.000Z"),
          planningDate: new Date("2026-08-17T00:00:00.000Z"),
          startTime: new Date("1970-01-01T08:00:00.000Z"),
          endTime: new Date("1970-01-01T12:30:45.000Z"),
        }),
      );
    });

    it("normalises omitted optional fields to null rather than undefined", async () => {
      await service.create(buildCreateDto());

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          containerNumber: null,
          terminal: null,
          vehicleId: null,
          driverId: null,
          startTime: null,
          endTime: null,
          executionDatetime: null,
          waitingTimeMinutes: null,
          distanceKm: null,
          internalNotes: null,
        }),
      );
    });

    it("never sets a status, so the column default applies", async () => {
      await service.create(buildCreateDto());

      expect(repository.create.mock.calls[0][0]).not.toHaveProperty("status");
    });

    it("never writes parser metadata or a trip group", async () => {
      await service.create(buildCreateDto());

      const data = repository.create.mock.calls[0][0];

      expect(data).not.toHaveProperty("parserMetadata");
      expect(data).not.toHaveProperty("tripGroupId");
    });

    it("rejects a booking number already held by another Trip", async () => {
      repository.findByBookingNumber.mockResolvedValue(
        buildTrip({ id: OTHER_TRIP_ID }),
      );

      await expect(service.create(buildCreateDto())).rejects.toBeInstanceOf(
        DuplicateBookingNumberException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("ignores DELETED Trips when checking the booking number", async () => {
      await service.create(buildCreateDto());

      expect(repository.findByBookingNumber).toHaveBeenCalledWith(
        expect.objectContaining({
          statuses: expect.not.arrayContaining([TripStatus.DELETED]),
        }),
      );
    });

    it("rejects an inactive vehicle", async () => {
      vehicleService.findById.mockResolvedValue({
        id: VEHICLE_ID,
        isActive: false,
      });

      await expect(
        service.create(buildCreateDto({ vehicleId: VEHICLE_ID })),
      ).rejects.toBeInstanceOf(InactiveAssignmentException);
    });

    it("rejects an inactive driver override", async () => {
      driverService.findById.mockResolvedValue({
        id: DRIVER_ID,
        isActive: false,
      });

      await expect(
        service.create(buildCreateDto({ driverId: DRIVER_ID })),
      ).rejects.toBeInstanceOf(InactiveAssignmentException);
    });

    it("does not look up a vehicle or driver that was not supplied", async () => {
      await service.create(buildCreateDto());

      expect(vehicleService.findById).not.toHaveBeenCalled();
      expect(driverService.findById).not.toHaveBeenCalled();
    });

    /**
     * ── OVERLAPPING IS ALLOWED, DELIBERATELY ────────────────────────────────
     * A Vehicle used to be refused when another Trip already occupied its
     * interval. The business removed that rule: real planning overlaps, and
     * deciding whether an overlap is intentional is the planner's job. These
     * tests exist so the refusal cannot quietly return.
     * ────────────────────────────────────────────────────────────────────────
     */
    it("accepts a Trip on a Vehicle already busy in that interval", async () => {
      await expect(
        service.create(
          buildCreateDto({
            vehicleId: VEHICLE_ID,
            startTime: "08:00",
            endTime: "12:00",
          }),
        ),
      ).resolves.toBeDefined();

      expect(repository.create).toHaveBeenCalled();
    });

    it("never asks the database whether the Vehicle is free", async () => {
      await service.create(
        buildCreateDto({
          vehicleId: VEHICLE_ID,
          startTime: "08:00",
          endTime: "12:00",
        }),
      );

      expect("findVehicleOverlaps" in repository).toBe(false);
    });

    /** Everything else about assignment still applies. */
    it("still refuses an inactive Vehicle", async () => {
      vehicleService.findById.mockResolvedValue({
        id: VEHICLE_ID,
        isActive: false,
      } as never);

      await expect(
        service.create(buildCreateDto({ vehicleId: VEHICLE_ID })),
      ).rejects.toBeInstanceOf(InactiveAssignmentException);
    });

    it("runs the checks and the insert in one transaction", async () => {
      await service.create(buildCreateDto());

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    });

    it("logs identifiers only, never business values", async () => {
      await service.create(
        buildCreateDto({
          containerNumber: "MSKU1234567",
          internalNotes: "call the customer",
          distanceKm: 132.5,
        }),
      );

      expect(logger.log).toHaveBeenCalledWith("Trip created", {
        tripId: TRIP_ID,
        status: TripStatus.OPEN,
        pdfDocumentId: PDF_ID,
      });
    });
  });

  describe("update", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildTrip());
    });

    it("throws when the Trip does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update(TRIP_ID, {})).rejects.toBeInstanceOf(
        TripNotFoundException,
      );
    });

    it("leaves omitted fields undefined so Prisma does not touch them", async () => {
      await service.update(TRIP_ID, { containerNumber: "MSKU1234567" });

      expect(repository.update).toHaveBeenCalledWith(TRIP_ID, {
        containerNumber: "MSKU1234567",
        planningDate: undefined,
        vehicleId: undefined,
        driverId: undefined,
        waitingTimeMinutes: undefined,
        distanceKm: undefined,
        executionDatetime: undefined,
        internalNotes: undefined,
      });
    });

    it("passes an explicit null through so the column is cleared", async () => {
      await service.update(TRIP_ID, {
        containerNumber: null,
        waitingTimeMinutes: null,
        distanceKm: null,
        internalNotes: null,
        executionDatetime: null,
        vehicleId: null,
        driverId: null,
      });

      expect(repository.update).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({
          containerNumber: null,
          waitingTimeMinutes: null,
          distanceKm: null,
          internalNotes: null,
          executionDatetime: null,
          vehicleId: null,
          driverId: null,
        }),
      );
    });

    it("converts a moved planning date to UTC midnight", async () => {
      await service.update(TRIP_ID, { planningDate: "2026-08-18" });

      expect(repository.update).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({
          planningDate: new Date("2026-08-18T00:00:00.000Z"),
        }),
      );
    });

    it("re-checks eligibility only when the vehicle actually changes", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ vehicleId: VEHICLE_ID }),
      );

      await service.update(TRIP_ID, { vehicleId: VEHICLE_ID });

      expect(vehicleService.findById).not.toHaveBeenCalled();
    });

    it("re-checks eligibility when the vehicle changes", async () => {
      vehicleService.findById.mockResolvedValue({
        id: VEHICLE_ID,
        isActive: false,
      });

      await expect(
        service.update(TRIP_ID, { vehicleId: VEHICLE_ID }),
      ).rejects.toBeInstanceOf(InactiveAssignmentException);
    });

    it("allows unassigning a vehicle that has since been deactivated", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ vehicleId: VEHICLE_ID }),
      );

      await service.update(TRIP_ID, { vehicleId: null });

      expect(vehicleService.findById).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
    });

    /** Moving a Trip onto a busy truck, or onto a busy day, is the planner's call. */
    it("moves a Trip onto a Vehicle that is already busy", async () => {
      await expect(
        service.update(TRIP_ID, { vehicleId: VEHICLE_ID }),
      ).resolves.toBeDefined();

      expect(repository.update).toHaveBeenCalled();
    });

    it("moves a Trip to another day without a booking check", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({
          vehicleId: VEHICLE_ID,
          startTime: new Date("1970-01-01T08:00:00.000Z"),
          endTime: new Date("1970-01-01T12:00:00.000Z"),
        }),
      );

      await service.update(TRIP_ID, { planningDate: "2026-08-18" });

      expect(repository.update).toHaveBeenCalled();
    });

    it("logs the changed field names but never their values", async () => {
      await service.update(TRIP_ID, {
        containerNumber: "MSKU1234567",
        internalNotes: "call the customer",
      });

      expect(logger.log).toHaveBeenCalledWith("Trip updated", {
        tripId: TRIP_ID,
        changedFields: ["containerNumber", "internalNotes"],
      });
    });
  });

  describe("changeStatus", () => {
    it.each([
      [TripStatus.OPEN, TripStatus.CLOSED],
      [TripStatus.OPEN, TripStatus.CANCELLED],
      [TripStatus.CANCELLED, TripStatus.OPEN],
    ])("moves %s to %s", async (from, to) => {
      repository.findById.mockResolvedValue(buildTrip({ status: from }));
      repository.setStatus.mockResolvedValue(buildTrip({ status: to }));

      const result = await service.changeStatus(TRIP_ID, { status: to });

      expect(repository.setStatus).toHaveBeenCalledWith(TRIP_ID, to);
      expect(result.status).toBe(to);
    });

    it("rejects reopening a CLOSED Trip", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );

      await expect(
        service.changeStatus(TRIP_ID, { status: TripStatus.OPEN }),
      ).rejects.toBeInstanceOf(InvalidTripStatusTransitionException);
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it("rejects cancelling a CLOSED Trip", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );

      await expect(
        service.changeStatus(TRIP_ID, { status: TripStatus.CANCELLED }),
      ).rejects.toBeInstanceOf(InvalidTripStatusTransitionException);
    });

    it("rejects moving a DELETED Trip through the status endpoint", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );

      await expect(
        service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED }),
      ).rejects.toBeInstanceOf(InvalidTripStatusTransitionException);
    });

    it("is idempotent when the Trip already holds the target status", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );

      const result = await service.changeStatus(TRIP_ID, {
        status: TripStatus.CLOSED,
      });

      expect(result.status).toBe(TripStatus.CLOSED);
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it("rejects reopening when another Trip took the booking number", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CANCELLED }),
      );
      repository.findByBookingNumber.mockResolvedValue(
        buildTrip({ id: OTHER_TRIP_ID }),
      );

      await expect(
        service.changeStatus(TRIP_ID, { status: TripStatus.OPEN }),
      ).rejects.toBeInstanceOf(DuplicateBookingNumberException);
    });

    it("reopens a Trip even when its Vehicle is busy elsewhere", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CANCELLED, vehicleId: VEHICLE_ID }),
      );

      await expect(
        service.changeStatus(TRIP_ID, { status: TripStatus.OPEN }),
      ).resolves.toBeDefined();
    });

    it("does not re-check anything when leaving OPEN", async () => {
      repository.findById.mockResolvedValue(buildTrip());

      await service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED });

      expect(repository.findByBookingNumber).not.toHaveBeenCalled();
    });

    it("logs both ends of the transition", async () => {
      repository.findById.mockResolvedValue(buildTrip());
      repository.setStatus.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );

      await service.changeStatus(TRIP_ID, { status: TripStatus.CLOSED });

      expect(logger.log).toHaveBeenCalledWith("Trip status changed", {
        tripId: TRIP_ID,
        fromStatus: TripStatus.OPEN,
        toStatus: TripStatus.CLOSED,
      });
    });
  });

  describe("softDelete", () => {
    it("moves an OPEN Trip to DELETED", async () => {
      repository.findById.mockResolvedValue(buildTrip());
      repository.setStatus.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );

      const result = await service.softDelete(TRIP_ID);

      expect(repository.setStatus).toHaveBeenCalledWith(
        TRIP_ID,
        TripStatus.DELETED,
      );
      expect(result.status).toBe(TripStatus.DELETED);
    });

    it.each([TripStatus.CLOSED, TripStatus.CANCELLED])(
      "refuses to delete a %s Trip, because restore could not target a status",
      async (status) => {
        repository.findById.mockResolvedValue(buildTrip({ status }));

        await expect(service.softDelete(TRIP_ID)).rejects.toBeInstanceOf(
          TripNotDeletableException,
        );
        expect(repository.setStatus).not.toHaveBeenCalled();
      },
    );

    it("is idempotent", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );

      const result = await service.softDelete(TRIP_ID);

      expect(result.status).toBe(TripStatus.DELETED);
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it("throws when the Trip does not exist", async () => {
      await expect(service.softDelete(TRIP_ID)).rejects.toBeInstanceOf(
        TripNotFoundException,
      );
    });
  });

  describe("restore", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );
      repository.setStatus.mockResolvedValue(buildTrip());
    });

    it("returns a DELETED Trip to OPEN", async () => {
      const result = await service.restore(TRIP_ID);

      expect(repository.setStatus).toHaveBeenCalledWith(
        TRIP_ID,
        TripStatus.OPEN,
      );
      expect(result.status).toBe(TripStatus.OPEN);
    });

    it.each([TripStatus.OPEN, TripStatus.CLOSED, TripStatus.CANCELLED])(
      "refuses to restore a %s Trip",
      async (status) => {
        repository.findById.mockResolvedValue(buildTrip({ status }));

        await expect(service.restore(TRIP_ID)).rejects.toBeInstanceOf(
          TripNotDeletedException,
        );
      },
    );

    it("refuses when another Trip took the booking number meanwhile", async () => {
      repository.findByBookingNumber.mockResolvedValue(
        buildTrip({ id: OTHER_TRIP_ID }),
      );

      await expect(service.restore(TRIP_ID)).rejects.toBeInstanceOf(
        DuplicateBookingNumberException,
      );
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it("restores a Trip whose Vehicle is now busy elsewhere", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED, vehicleId: VEHICLE_ID }),
      );

      await expect(service.restore(TRIP_ID)).resolves.toBeDefined();
    });

    it("excludes itself from the booking-number reclaim check", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({
          status: TripStatus.DELETED,
          vehicleId: VEHICLE_ID,
          startTime: new Date("1970-01-01T08:00:00.000Z"),
          endTime: new Date("1970-01-01T12:00:00.000Z"),
        }),
      );

      await service.restore(TRIP_ID);

      expect(repository.findByBookingNumber).toHaveBeenCalledWith(
        expect.objectContaining({ excludeTripId: TRIP_ID }),
      );
    });

    it("runs the reclaim checks and the write in one transaction", async () => {
      await service.restore(TRIP_ID);

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("response shape", () => {
    it("renders dates as calendar days and times as clock values", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({
          startTime: new Date("1970-01-01T08:00:00.000Z"),
          endTime: new Date("1970-01-01T12:30:00.000Z"),
        }),
      );

      const trip = await service.findById(TRIP_ID);

      expect(trip.originalPlanningDate).toBe("2026-08-17");
      expect(trip.planningDate).toBe("2026-08-17");
      expect(trip.startTime).toBe("08:00:00");
      expect(trip.endTime).toBe("12:30:00");
    });

    it("renders the distance as a fixed two-decimal string", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ distanceKm: new Prisma.Decimal("132.5") }),
      );

      expect((await service.findById(TRIP_ID)).distanceKm).toBe("132.50");
    });

    it("keeps a zero distance distinct from an absent one", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ distanceKm: new Prisma.Decimal("0") }),
      );

      expect((await service.findById(TRIP_ID)).distanceKm).toBe("0.00");
    });

    it("never exposes parser metadata", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ parserMetadata: { rawTerminal: "ANTWERP GATEWAY" } }),
      );

      expect(await service.findById(TRIP_ID)).not.toHaveProperty(
        "parserMetadata",
      );
    });
  });
});
