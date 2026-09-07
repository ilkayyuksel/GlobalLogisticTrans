import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { CreateTripDto } from "./dto/create-trip.dto";
import {
  DocumentControlledFieldException,
  IncompleteWaitingWindowException,
  DuplicateBookingNumberException,
  InactiveAssignmentException,
  InvalidTripStatusTransitionException,
  TripNotDeletedException,
  TripNotFoundException,
  UnknownPdfDocumentException,
} from "./exceptions/trip.exceptions";
import { stubTripWriteTransaction } from "./trip-write-transaction.double";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";

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
    isLooseTrip: false,
    isPaid: false,
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
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
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
      findByIdentity: jest.fn().mockResolvedValue(null),
      findManyByBookingNumber: jest.fn().mockResolvedValue([]),
      pdfDocumentExists: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue(buildTrip()),
      update: jest.fn().mockResolvedValue(buildTrip()),
      setStatus: jest.fn().mockResolvedValue(buildTrip()),
      // Present so "not called" assertions have something real to check: an
      // absent member would make every such expectation vacuously pass.
      assignToGroup: jest.fn().mockResolvedValue(0),
      recordHistory: jest.fn().mockResolvedValue(undefined),
      runInTransaction: jest.fn(),
      runTripWriteTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    // The transaction hands the callback a repository; the double simply passes
    // the same one through so the assertions see every call.
    (repository.runInTransaction as jest.Mock).mockImplementation(
      (work: (repo: TripRepository) => Promise<unknown>) => work(repository),
    );
    (repository.runTripWriteTransaction as jest.Mock).mockImplementation(
      stubTripWriteTransaction(repository),
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
      {
        applyToNewTrip: jest.fn(),
        synchronise: jest.fn(),
      } as unknown as AutomaticFlatPropertyService,
      stubPricingRecalculation(),
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
          waitingTimeStart: null,
          waitingTimeEnd: null,
          waitingTimeMinutes: null,
          distanceKm: null,
          tarNummer: null,
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

    it("rejects an identity already held by another Trip", async () => {
      repository.findByIdentity.mockResolvedValue(
        buildTrip({ id: OTHER_TRIP_ID }),
      );

      await expect(service.create(buildCreateDto())).rejects.toBeInstanceOf(
        DuplicateBookingNumberException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("ignores DELETED Trips when checking the identity", async () => {
      await service.create(buildCreateDto());

      expect(repository.findByIdentity).toHaveBeenCalledWith(
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

    it("runs the checks, the insert and the automatic properties in one transaction", async () => {
      await service.create(buildCreateDto());

      expect(repository.runTripWriteTransaction).toHaveBeenCalledTimes(1);
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
        waitingTimeStart: undefined,
        waitingTimeEnd: undefined,
        waitingTimeMinutes: undefined,
        distanceKm: undefined,
        executionDatetime: undefined,
        internalNotes: undefined,
      });
    });

    /**
     * TAR-nummer is an ordinary optional column: written when given, left alone
     * when omitted, cleared by an explicit null. The DTO has already turned
     * whitespace-only into null before the service sees it, which is why there
     * is no trimming here — one rule, in one place.
     */
    it("writes a TAR-nummer that was given", async () => {
      await service.update(TRIP_ID, { tarNummer: "TAR-2026-0042" });

      expect(repository.update).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({ tarNummer: "TAR-2026-0042" }),
      );
    });

    it("leaves the column alone when the field is omitted", async () => {
      await service.update(TRIP_ID, { containerNumber: "MSKU1234567" });

      const [, data] = repository.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];

      expect(data.tarNummer).toBeUndefined();
    });

    it("passes an explicit null through so the column is cleared", async () => {
      await service.update(TRIP_ID, {
        containerNumber: null,
        waitingTimeStart: null,
        waitingTimeEnd: null,
        distanceKm: null,
        tarNummer: null,
        internalNotes: null,
        executionDatetime: null,
        vehicleId: null,
        driverId: null,
      });

      expect(repository.update).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({
          containerNumber: null,
          waitingTimeStart: null,
          waitingTimeEnd: null,
          waitingTimeMinutes: null,
          distanceKm: null,
          tarNummer: null,
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

    /**
     * ── WHO OWNS THE DESTINATION ────────────────────────────────────────────
     * It was excluded from every update as "parser-controlled", which is only
     * true where a parser exists. A Trip created by hand has no document, so
     * nothing could ever correct a city typed wrongly: it was write-once, and a
     * Trip planned to the wrong place stayed planned to the wrong place.
     *
     * The Trip decides, not the field. An imported Trip is still refused —
     * a later UPDATE re-reads the destination from the document, so a manual
     * change there would be silently overwritten.
     * ────────────────────────────────────────────────────────────────────────
     */
    describe("the destination", () => {
      /** No PDF, so the operator is the only possible author. */
      const manualTrip = () =>
        repository.findById.mockResolvedValue(buildTrip({ pdfDocumentId: null }));

      it("is accepted on a Trip created by hand", async () => {
        manualTrip();

        await service.update(TRIP_ID, { destinationCity: "Rotterdam" });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({ destinationCity: "Rotterdam" }),
        );
      });

      it("accepts the country with it", async () => {
        manualTrip();

        await service.update(TRIP_ID, {
          destinationCity: "Venlo",
          destinationCountry: "Netherlands",
        });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({
            destinationCity: "Venlo",
            destinationCountry: "Netherlands",
          }),
        );
      });

      it("can be cleared", async () => {
        manualTrip();

        await service.update(TRIP_ID, { destinationCity: null });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({ destinationCity: null }),
        );
      });

      it("is refused on an imported Trip", async () => {
        await expect(
          service.update(TRIP_ID, { destinationCity: "Rotterdam" }),
        ).rejects.toBeInstanceOf(DocumentControlledFieldException);
      });

      it("is refused before anything is written", async () => {
        await expect(
          service.update(TRIP_ID, {
            destinationCity: "Rotterdam",
            internalNotes: "moved",
          }),
        ).rejects.toBeInstanceOf(DocumentControlledFieldException);

        expect(repository.update).not.toHaveBeenCalled();
      });

      /** An update that says nothing about the destination is not one. */
      it("leaves an imported Trip updatable in every other field", async () => {
        await service.update(TRIP_ID, { internalNotes: "call the customer" });

        expect(repository.update).toHaveBeenCalled();
      });
    });

    /**
     * ── A WAITING WINDOW IS BOTH TIMES OR NEITHER ───────────────────────────
     * An end with no beginning is not zero and not a duration from midnight; it
     * is an incomplete entry, and guessing would bill something nobody
     * measured.
     *
     * This cannot be a DTO decorator: `@IsOptional()` skips every validator on
     * a property that was not sent, which is exactly this case. Before the rule
     * moved into the service, a start sent alone reached the calculator with an
     * undefined end and answered 500.
     * ────────────────────────────────────────────────────────────────────────
     */
    describe("a half-filled waiting window", () => {
      it("is refused when only the start is sent", async () => {
        await expect(
          service.update(TRIP_ID, { waitingTimeStart: "10:00" }),
        ).rejects.toBeInstanceOf(IncompleteWaitingWindowException);
      });

      it("is refused when only the end is sent", async () => {
        await expect(
          service.update(TRIP_ID, { waitingTimeEnd: "12:15" }),
        ).rejects.toBeInstanceOf(IncompleteWaitingWindowException);
      });

      it("is refused when one is cleared and the other given", async () => {
        await expect(
          service.update(TRIP_ID, {
            waitingTimeStart: null,
            waitingTimeEnd: "12:15",
          }),
        ).rejects.toBeInstanceOf(IncompleteWaitingWindowException);
      });

      it("writes nothing when it is refused", async () => {
        await expect(
          service.update(TRIP_ID, {
            waitingTimeStart: "10:00",
            internalNotes: "x",
          }),
        ).rejects.toBeInstanceOf(IncompleteWaitingWindowException);

        expect(repository.update).not.toHaveBeenCalled();
      });

      it("accepts both together", async () => {
        await service.update(TRIP_ID, {
          waitingTimeStart: "10:00",
          waitingTimeEnd: "12:15",
        });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({ waitingTimeMinutes: 135 }),
        );
      });

      it("accepts both cleared, which removes the entry", async () => {
        await service.update(TRIP_ID, {
          waitingTimeStart: null,
          waitingTimeEnd: null,
        });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({
            waitingTimeStart: null,
            waitingTimeEnd: null,
            waitingTimeMinutes: null,
          }),
        );
      });

      it("says nothing about waiting time when neither was sent", async () => {
        await service.update(TRIP_ID, { internalNotes: "x" });

        const [, written] = (repository.update as jest.Mock).mock.calls[0] as [
          string,
          Record<string, unknown>,
        ];

        expect(written).not.toHaveProperty("waitingTimeStart");
      });
    });

    /**
     * ── THE TRANSPORT TIMES ─────────────────────────────────────────────────
     * The same rule as the destination, for the same reason: a Trip created by
     * hand has no document, so nothing but the operator can ever correct a time
     * typed wrongly at creation.
     *
     * And no ordering rule. A transport running past midnight is ordinary, and
     * a single-time order — "21/08/2026 15:00" — stores 15:00 in BOTH fields;
     * refusing an end that precedes a start would refuse planning the parser
     * itself produces.
     * ────────────────────────────────────────────────────────────────────────
     */
    describe("the transport times", () => {
      const manualTrip = () =>
        repository.findById.mockResolvedValue(buildTrip({ pdfDocumentId: null }));

      it("accepts a start time on a Trip created by hand", async () => {
        manualTrip();

        await service.update(TRIP_ID, { startTime: "08:00" });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({
            startTime: new Date("1970-01-01T08:00:00.000Z"),
          }),
        );
      });

      it("accepts an end time", async () => {
        manualTrip();

        await service.update(TRIP_ID, { endTime: "12:30" });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({
            endTime: new Date("1970-01-01T12:30:00.000Z"),
          }),
        );
      });

      it("accepts both together", async () => {
        manualTrip();

        await service.update(TRIP_ID, { startTime: "08:00", endTime: "12:30" });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({
            startTime: new Date("1970-01-01T08:00:00.000Z"),
            endTime: new Date("1970-01-01T12:30:00.000Z"),
          }),
        );
      });

      it("accepts one without the other", async () => {
        manualTrip();

        await service.update(TRIP_ID, { startTime: "08:00" });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({ endTime: undefined }),
        );
      });

      it("can clear a time", async () => {
        manualTrip();

        await service.update(TRIP_ID, { startTime: null });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({ startTime: null }),
        );
      });

      /** Overnight: no rule says the end must follow the start. */
      it("accepts an end that precedes the start", async () => {
        manualTrip();

        await service.update(TRIP_ID, { startTime: "22:00", endTime: "02:00" });

        expect(repository.update).toHaveBeenCalled();
      });

      /** A single-time order stores the same value in both fields. */
      it("accepts an end equal to the start", async () => {
        manualTrip();

        await service.update(TRIP_ID, { startTime: "15:00", endTime: "15:00" });

        expect(repository.update).toHaveBeenCalled();
      });

      it("lets one half of a single-time order be moved alone", async () => {
        repository.findById.mockResolvedValue(
          buildTrip({
            pdfDocumentId: null,
            startTime: new Date("1970-01-01T15:00:00.000Z"),
            endTime: new Date("1970-01-01T15:00:00.000Z"),
          }),
        );

        await service.update(TRIP_ID, { endTime: "16:00" });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({
            startTime: undefined,
            endTime: new Date("1970-01-01T16:00:00.000Z"),
          }),
        );
      });

      /**
       * ── AN OPERATOR FIELD ON ANY TRIP ────────────────────────────────────
       * The times were briefly refused on an imported Trip, like the
       * destination. The owner decided otherwise: Begin and Eind are planning
       * an operator adjusts as a day unfolds, exactly like the planning date
       * beside them. A document may still revise them; until one does, the
       * operator's value stands.
       * ──────────────────────────────────────────────────────────────────────
       */
      it("is accepted on an imported Trip too", async () => {
        repository.findById.mockResolvedValue(buildTrip({ pdfDocumentId: PDF_ID }));

        await service.update(TRIP_ID, { startTime: "08:00" });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({
            startTime: new Date("1970-01-01T08:00:00.000Z"),
          }),
        );
      });

      /** The destination is still the document's on an imported Trip. */
      it("does not make the destination editable with it", async () => {
        repository.findById.mockResolvedValue(buildTrip({ pdfDocumentId: PDF_ID }));

        await expect(
          service.update(TRIP_ID, { destinationCity: "Rotterdam" }),
        ).rejects.toBeInstanceOf(DocumentControlledFieldException);
      });

      /** An operator edit is not a revision: no history row is written. */
      it("writes no history", async () => {
        manualTrip();

        await service.update(TRIP_ID, { startTime: "08:00" });

        expect(repository.recordHistory).not.toHaveBeenCalled();
      });

      /**
       * Changing a transport time is not a waiting time. The write does not
       * mention any of the three waiting columns at ALL — not even as
       * undefined — because nothing about waiting was sent.
       */
      it("never touches the waiting time", async () => {
        manualTrip();

        await service.update(TRIP_ID, { startTime: "08:00", endTime: "12:30" });

        const [, written] = (repository.update as jest.Mock).mock.calls[0] as [
          string,
          Record<string, unknown>,
        ];

        expect(written).not.toHaveProperty("waitingTimeMinutes");
        expect(written).not.toHaveProperty("waitingTimeStart");
        expect(written).not.toHaveProperty("waitingTimeEnd");
      });
    });

    /**
     * LOSRIT is the operator's own classification, so no document owns it and
     * a box ticked by mistake has to be untickable — on any Trip, imported or
     * not.
     */
    describe("the LOSRIT indicator", () => {
      it("can be set", async () => {
        await service.update(TRIP_ID, { isLooseTrip: true });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({ isLooseTrip: true }),
        );
      });

      it("can be taken back off", async () => {
        repository.findById.mockResolvedValue(buildTrip({ isLooseTrip: true }));

        await service.update(TRIP_ID, { isLooseTrip: false });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({ isLooseTrip: false }),
        );
      });

      it("is left alone by an update that does not mention it", async () => {
        repository.findById.mockResolvedValue(buildTrip({ isLooseTrip: true }));

        await service.update(TRIP_ID, { internalNotes: "x" });

        expect(repository.update).toHaveBeenCalledWith(
          TRIP_ID,
          expect.objectContaining({ isLooseTrip: undefined }),
        );
      });
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

    /**
     * ── LOSRIT IS NOT A STATE ───────────────────────────────────────────────
     * It travels beside the lifecycle rather than inside it, so every
     * combination is representable and none of them changes what the Trip may
     * do next. A LOSRIT closes exactly as an ordinary Trip closes.
     * ────────────────────────────────────────────────────────────────────────
     */
    it.each([
      [TripStatus.OPEN, TripStatus.CLOSED],
      [TripStatus.OPEN, TripStatus.CANCELLED],
      [TripStatus.CANCELLED, TripStatus.OPEN],
    ])("moves a LOSRIT from %s to %s like any other Trip", async (from, to) => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: from, isLooseTrip: true }),
      );
      repository.setStatus.mockResolvedValue(
        buildTrip({ status: to, isLooseTrip: true }),
      );

      const result = await service.changeStatus(TRIP_ID, { status: to });

      expect(result.status).toBe(to);
      // Still a LOSRIT afterwards: a transition writes the status column and
      // nothing else.
      expect(result.isLooseTrip).toBe(true);
    });

    it("refuses a LOSRIT the same transitions it refuses any Trip", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED, isLooseTrip: true }),
      );

      // CLOSED reopens, but it still does not go straight to CANCELLED.
      await expect(
        service.changeStatus(TRIP_ID, { status: TripStatus.CANCELLED }),
      ).rejects.toBeInstanceOf(InvalidTripStatusTransitionException);
    });

    /**
     * Reopening a CLOSED Trip, which used to be refused outright.
     *
     * It writes the status column and nothing else: the Trip keeps its id, its
     * identity, its group and its pricing snapshot, and no recalculation is
     * announced — `announceIfClosed` fires only when a Trip BECOMES closed.
     */
    describe("reopening a CLOSED Trip", () => {
      beforeEach(() => {
        repository.findById.mockResolvedValue(
          buildTrip({ status: TripStatus.CLOSED }),
        );
        repository.setStatus.mockResolvedValue(
          buildTrip({ status: TripStatus.OPEN }),
        );
      });

      it("moves it to OPEN", async () => {
        const result = await service.changeStatus(TRIP_ID, {
          status: TripStatus.OPEN,
        });

        expect(result.status).toBe(TripStatus.OPEN);
        expect(repository.setStatus).toHaveBeenCalledWith(
          TRIP_ID,
          TripStatus.OPEN,
        );
      });

      it("keeps the same Trip", async () => {
        const result = await service.changeStatus(TRIP_ID, {
          status: TripStatus.OPEN,
        });

        expect(result.id).toBe(TRIP_ID);
      });

      /** Nothing is repriced on the way out of CLOSED. */
      it("announces nothing to the Pricing Engine", async () => {
        await service.changeStatus(TRIP_ID, { status: TripStatus.OPEN });

        expect(eventBus.publish).not.toHaveBeenCalled();
      });

      it("writes only the status column", async () => {
        await service.changeStatus(TRIP_ID, { status: TripStatus.OPEN });

        expect(repository.update).not.toHaveBeenCalled();
      });
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

    it("rejects reopening when another Trip took the identity", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CANCELLED }),
      );
      repository.findByIdentity.mockResolvedValue(
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

    /**
     * A cancelled transport is exactly the kind an operator wants out of the
     * way, and CANCELLED → OPEN → DELETED moved it through a state it was
     * never in on the way past.
     */
    it("moves a CANCELLED Trip to DELETED directly", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CANCELLED }),
      );
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

    /** It never passes through OPEN to get there. */
    it("does not reopen a CANCELLED Trip on the way", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CANCELLED }),
      );
      repository.setStatus.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );

      await service.softDelete(TRIP_ID);

      expect(repository.setStatus).toHaveBeenCalledTimes(1);
      expect(repository.setStatus).not.toHaveBeenCalledWith(
        TRIP_ID,
        TripStatus.OPEN,
      );
    });

    /**
     * A CLOSED Trip may be deleted now. It used to be refused, which left a
     * Trip created in error with no way out of the lists at all.
     *
     * The same SOFT delete: the row survives, its pricing snapshot survives,
     * and restore brings it back — to OPEN, as it does from every status.
     */
    it("soft-deletes a CLOSED Trip", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );
      repository.setStatus.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );

      const result = await service.softDelete(TRIP_ID);

      expect(result.status).toBe(TripStatus.DELETED);
      expect(repository.setStatus).toHaveBeenCalledWith(
        TRIP_ID,
        TripStatus.DELETED,
      );
    });

    it("reprices nothing when a CLOSED Trip is deleted", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CLOSED }),
      );
      repository.setStatus.mockResolvedValue(
        buildTrip({ status: TripStatus.DELETED }),
      );

      await service.softDelete(TRIP_ID);

      expect(eventBus.publish).not.toHaveBeenCalled();
    });

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

    /**
     * ── WHAT DELETING DOES NOT TOUCH ────────────────────────────────────────
     * It is a SOFT delete: one column moves and the record stays. Everything
     * asserted below is something an operator would only discover was gone
     * long after the fact — the source document, the revision history, the
     * Combination the Trip belongs to, a Cost Confirmation that arrived for it.
     * The service writes through `setStatus`, which is why none of it can be
     * affected; these tests keep it that way.
     * ────────────────────────────────────────────────────────────────────────
     */
    describe("what it leaves alone", () => {
      it("writes the status and nothing else", async () => {
        repository.findById.mockResolvedValue(buildTrip());
        repository.setStatus.mockResolvedValue(
          buildTrip({ status: TripStatus.DELETED }),
        );

        await service.softDelete(TRIP_ID);

        expect(repository.setStatus).toHaveBeenCalledWith(
          TRIP_ID,
          TripStatus.DELETED,
        );
        // Never the general update path, which could carry anything else.
        expect(repository.update).not.toHaveBeenCalled();
      });

      it("keeps the source document on the Trip", async () => {
        repository.findById.mockResolvedValue(buildTrip());
        repository.setStatus.mockResolvedValue(
          buildTrip({ status: TripStatus.DELETED }),
        );

        const result = await service.softDelete(TRIP_ID);

        expect(result.pdfDocumentId).toBe(PDF_ID);
      });

      it("keeps the Trip in its group", async () => {
        const groupId = "97777777-7777-4777-8777-777777777777";
        repository.findById.mockResolvedValue(
          buildTrip({ tripGroupId: groupId }),
        );
        repository.setStatus.mockResolvedValue(
          buildTrip({ tripGroupId: groupId, status: TripStatus.DELETED }),
        );

        const result = await service.softDelete(TRIP_ID);

        expect(result.tripGroupId).toBe(groupId);
      });

      /** One Trip is deleted, not the Combination it is half of. */
      it("does not touch the other legs of the group", async () => {
        repository.findById.mockResolvedValue(
          buildTrip({ tripGroupId: "97777777-7777-4777-8777-777777777777" }),
        );
        repository.setStatus.mockResolvedValue(
          buildTrip({ status: TripStatus.DELETED }),
        );

        await service.softDelete(TRIP_ID);

        expect(repository.setStatus).toHaveBeenCalledTimes(1);
        expect(repository.assignToGroup).not.toHaveBeenCalled();
      });

      /**
       * Addressed by ID. A booking number identifies several Trips now, so
       * deleting by booking would take an unrelated transport with it — the
       * service never looks one up.
       */
      it("never looks the Trip up by its booking number", async () => {
        repository.findById.mockResolvedValue(buildTrip());
        repository.setStatus.mockResolvedValue(
          buildTrip({ status: TripStatus.DELETED }),
        );

        await service.softDelete(TRIP_ID);

        expect(repository.findByBookingNumber).not.toHaveBeenCalled();
        expect(repository.findManyByBookingNumber).not.toHaveBeenCalled();
        expect(repository.findById).toHaveBeenCalledWith(TRIP_ID);
      });

      it("writes no history of its own", async () => {
        repository.findById.mockResolvedValue(buildTrip());
        repository.setStatus.mockResolvedValue(
          buildTrip({ status: TripStatus.DELETED }),
        );

        await service.softDelete(TRIP_ID);

        expect(repository.recordHistory).not.toHaveBeenCalled();
      });

      /** Deleting is not a completion: nothing downstream prices anything. */
      it("announces nothing", async () => {
        repository.findById.mockResolvedValue(buildTrip());
        repository.setStatus.mockResolvedValue(
          buildTrip({ status: TripStatus.DELETED }),
        );

        await service.softDelete(TRIP_ID);

        expect(eventBus.publish).not.toHaveBeenCalled();
      });
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

    it("refuses when another Trip took the identity meanwhile", async () => {
      repository.findByIdentity.mockResolvedValue(
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

    it("excludes itself from the identity reclaim check", async () => {
      repository.findById.mockResolvedValue(
        buildTrip({
          status: TripStatus.DELETED,
          vehicleId: VEHICLE_ID,
          startTime: new Date("1970-01-01T08:00:00.000Z"),
          endTime: new Date("1970-01-01T12:00:00.000Z"),
        }),
      );

      await service.restore(TRIP_ID);

      expect(repository.findByIdentity).toHaveBeenCalledWith(
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
