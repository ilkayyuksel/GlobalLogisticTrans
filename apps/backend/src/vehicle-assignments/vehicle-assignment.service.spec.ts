import { VehicleAssignment } from "@prisma/client";

import { toIsoDate, toUtcDate, todayUtc } from "../common/dates";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { ListVehicleAssignmentsQueryDto } from "./dto/list-vehicle-assignments-query.dto";
import {
  HistoricalAssignmentException,
  InvalidAssignmentPeriodException,
  VehicleAssignmentNotFoundException,
  VehicleAssignmentOverlapException,
} from "./exceptions/vehicle-assignment.exceptions";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";
import { VehicleAssignmentService } from "./vehicle-assignment.service";

const ASSIGNMENT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ASSIGNMENT_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const VEHICLE_ID = "1a1a1a1a-1111-4111-8111-111111111111";
const DRIVER_ID = "2b2b2b2b-2222-4222-8222-222222222222";

function buildAssignment(
  overrides: Partial<VehicleAssignment> = {},
): VehicleAssignment {
  return {
    id: ASSIGNMENT_ID,
    vehicleId: VEHICLE_ID,
    driverId: DRIVER_ID,
    validFrom: toUtcDate("2026-01-01"),
    validTo: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("VehicleAssignmentService", () => {
  let repository: jest.Mocked<VehicleAssignmentRepository>;
  let vehicleService: jest.Mocked<VehicleService>;
  let driverService: jest.Mocked<DriverService>;
  let logger: jest.Mocked<AppLoggerService>;
  let service: VehicleAssignmentService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findOverlapping: jest.fn().mockResolvedValue([]),
      findOpenEndedForVehicle: jest.fn().mockResolvedValue(null),
      findOpenEndedForDriver: jest.fn().mockResolvedValue(null),
      findCurrentForVehicle: jest.fn().mockResolvedValue(null),
      findCurrentForDriver: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildAssignment()),
      update: jest.fn().mockResolvedValue(buildAssignment()),
      setValidTo: jest.fn().mockResolvedValue(buildAssignment()),
      // Runs the callback against the same mock, so transactional behaviour is
      // exercised without a database.
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<VehicleAssignmentRepository>;

    repository.runInTransaction.mockImplementation(
      (work: (repo: VehicleAssignmentRepository) => Promise<unknown>) =>
        work(repository),
    );

    vehicleService = {
      findById: jest.fn().mockResolvedValue({ id: VEHICLE_ID }),
    } as unknown as jest.Mocked<VehicleService>;

    driverService = {
      findById: jest.fn().mockResolvedValue({ id: DRIVER_ID }),
    } as unknown as jest.Mocked<DriverService>;

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new VehicleAssignmentService(
      repository,
      vehicleService,
      driverService,
      logger,
    );
  });

  function query(overrides: Partial<ListVehicleAssignmentsQueryDto> = {}) {
    return {
      page: 1,
      pageSize: 25,
      ...overrides,
    } as ListVehicleAssignmentsQueryDto;
  }

  describe("findAll", () => {
    it("translates page and pageSize into skip and take", async () => {
      await service.findAll(query({ page: 3, pageSize: 10 }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it("computes pagination metadata from the total", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildAssignment()],
        totalItems: 42,
      });

      const result = await service.findAll(query({ page: 2, pageSize: 25 }));

      expect(result.meta).toEqual({
        page: 2,
        pageSize: 25,
        totalItems: 42,
        totalPages: 2,
      });
    });

    it("renders dates as calendar strings and flags open-ended periods", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildAssignment({ validTo: toUtcDate("2026-06-30") })],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(item.validFrom).toBe("2026-01-01");
      expect(item.validTo).toBe("2026-06-30");
      expect(item.isOpenEnded).toBe(false);
    });

    it("marks a null end date as open-ended", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildAssignment()],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(item.validTo).toBeNull();
      expect(item.isOpenEnded).toBe(true);
    });

    it("converts activeOnly into a today filter", async () => {
      await service.findAll(query({ activeOnly: true }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ activeOn: todayUtc() }),
      );
    });

    it("omits the today filter when activeOnly is absent", async () => {
      await service.findAll(query());

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ activeOn: undefined }),
      );
    });

    it("forwards the vehicle, driver and date-range filters", async () => {
      await service.findAll(
        query({
          vehicleId: VEHICLE_ID,
          driverId: DRIVER_ID,
          from: "2026-01-01",
          to: "2026-12-31",
        }),
      );

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId: VEHICLE_ID,
          driverId: DRIVER_ID,
          from: toUtcDate("2026-01-01"),
          to: toUtcDate("2026-12-31"),
        }),
      );
    });
  });

  describe("findById", () => {
    it("returns the assignment when it exists", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      expect((await service.findById(ASSIGNMENT_ID)).id).toBe(ASSIGNMENT_ID);
    });

    it("throws when it does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById(ASSIGNMENT_ID)).rejects.toThrow(
        VehicleAssignmentNotFoundException,
      );
    });
  });

  describe("current lookups", () => {
    it("returns the current assignment of a vehicle", async () => {
      repository.findCurrentForVehicle.mockResolvedValue(buildAssignment());

      const result = await service.findCurrentForVehicle(VEHICLE_ID);

      expect(vehicleService.findById).toHaveBeenCalledWith(VEHICLE_ID);
      expect(result?.id).toBe(ASSIGNMENT_ID);
    });

    it("returns null when a vehicle has no current assignment", async () => {
      repository.findCurrentForVehicle.mockResolvedValue(null);

      expect(await service.findCurrentForVehicle(VEHICLE_ID)).toBeNull();
    });

    it("returns the current assignment of a driver", async () => {
      repository.findCurrentForDriver.mockResolvedValue(buildAssignment());

      const result = await service.findCurrentForDriver(DRIVER_ID);

      expect(driverService.findById).toHaveBeenCalledWith(DRIVER_ID);
      expect(result?.id).toBe(ASSIGNMENT_ID);
    });

    it("lets a missing vehicle surface from VehicleService", async () => {
      vehicleService.findById.mockRejectedValue(new Error("vehicle missing"));

      await expect(service.findCurrentForVehicle(VEHICLE_ID)).rejects.toThrow(
        "vehicle missing",
      );
    });
  });

  describe("create", () => {
    const openEndedDto = {
      vehicleId: VEHICLE_ID,
      driverId: DRIVER_ID,
      validFrom: "2026-03-01",
    };

    it("verifies the vehicle and the driver exist first", async () => {
      await service.create(openEndedDto);

      expect(vehicleService.findById).toHaveBeenCalledWith(VEHICLE_ID);
      expect(driverService.findById).toHaveBeenCalledWith(DRIVER_ID);
    });

    it("runs inside a transaction", async () => {
      await service.create(openEndedDto);

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    });

    it("stores the period with a null end for an open-ended assignment", async () => {
      await service.create(openEndedDto);

      expect(repository.create).toHaveBeenCalledWith({
        vehicleId: VEHICLE_ID,
        driverId: DRIVER_ID,
        validFrom: toUtcDate("2026-03-01"),
        validTo: null,
        notes: null,
      });
    });

    it("stores a closed period when validTo is supplied", async () => {
      await service.create({ ...openEndedDto, validTo: "2026-06-30" });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ validTo: toUtcDate("2026-06-30") }),
      );
    });

    it("rejects validTo earlier than validFrom", async () => {
      await expect(
        service.create({ ...openEndedDto, validTo: "2026-02-28" }),
      ).rejects.toThrow(InvalidAssignmentPeriodException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("closes the previous open-ended assignment of the vehicle", async () => {
      repository.findOpenEndedForVehicle.mockResolvedValue(
        buildAssignment({
          id: OTHER_ASSIGNMENT_ID,
          validFrom: toUtcDate("2026-01-01"),
        }),
      );

      await service.create(openEndedDto);

      // Ends the day before the new one starts.
      expect(repository.setValidTo).toHaveBeenCalledWith(
        OTHER_ASSIGNMENT_ID,
        toUtcDate("2026-02-28"),
      );
    });

    it("closes the previous open-ended assignment of the driver", async () => {
      repository.findOpenEndedForDriver.mockResolvedValue(
        buildAssignment({
          id: OTHER_ASSIGNMENT_ID,
          validFrom: toUtcDate("2026-01-01"),
        }),
      );

      await service.create(openEndedDto);

      expect(repository.setValidTo).toHaveBeenCalledWith(
        OTHER_ASSIGNMENT_ID,
        toUtcDate("2026-02-28"),
      );
    });

    it("closes a shared predecessor only once", async () => {
      const shared = buildAssignment({
        id: OTHER_ASSIGNMENT_ID,
        validFrom: toUtcDate("2026-01-01"),
      });
      repository.findOpenEndedForVehicle.mockResolvedValue(shared);
      repository.findOpenEndedForDriver.mockResolvedValue(shared);

      await service.create(openEndedDto);

      expect(repository.setValidTo).toHaveBeenCalledTimes(1);
    });

    it("logs the automatic closure", async () => {
      repository.findOpenEndedForVehicle.mockResolvedValue(
        buildAssignment({
          id: OTHER_ASSIGNMENT_ID,
          validFrom: toUtcDate("2026-01-01"),
        }),
      );

      await service.create(openEndedDto);

      expect(logger.log).toHaveBeenCalledWith(
        "Vehicle assignment automatically closed",
        expect.objectContaining({
          assignmentId: OTHER_ASSIGNMENT_ID,
          endedOn: "2026-02-28",
        }),
      );
    });

    it("does not auto-close when the new assignment has an end date", async () => {
      repository.findOpenEndedForVehicle.mockResolvedValue(
        buildAssignment({ id: OTHER_ASSIGNMENT_ID }),
      );

      await service.create({ ...openEndedDto, validTo: "2026-06-30" });

      expect(repository.setValidTo).not.toHaveBeenCalled();
    });

    it("does not auto-close a predecessor that starts on or after the new period", async () => {
      // Closing it would set an end date before its own start.
      repository.findOpenEndedForVehicle.mockResolvedValue(
        buildAssignment({
          id: OTHER_ASSIGNMENT_ID,
          validFrom: toUtcDate("2026-03-01"),
        }),
      );
      repository.findOverlapping.mockResolvedValue([
        buildAssignment({ id: OTHER_ASSIGNMENT_ID }),
      ]);

      await expect(service.create(openEndedDto)).rejects.toThrow(
        VehicleAssignmentOverlapException,
      );

      expect(repository.setValidTo).not.toHaveBeenCalled();
    });

    it("rejects an overlapping vehicle period", async () => {
      repository.findOverlapping.mockImplementation(({ vehicleId }) =>
        Promise.resolve(
          vehicleId ? [buildAssignment({ id: OTHER_ASSIGNMENT_ID })] : [],
        ),
      );

      await expect(service.create(openEndedDto)).rejects.toThrow(
        /vehicle/,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("rejects an overlapping driver period", async () => {
      repository.findOverlapping.mockImplementation(({ driverId }) =>
        Promise.resolve(
          driverId ? [buildAssignment({ id: OTHER_ASSIGNMENT_ID })] : [],
        ),
      );

      await expect(service.create(openEndedDto)).rejects.toThrow(/driver/);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("ignores an auto-closed predecessor when checking overlap", async () => {
      const predecessor = buildAssignment({
        id: OTHER_ASSIGNMENT_ID,
        validFrom: toUtcDate("2026-01-01"),
      });
      repository.findOpenEndedForVehicle.mockResolvedValue(predecessor);
      repository.findOverlapping.mockResolvedValue([predecessor]);

      await expect(service.create(openEndedDto)).resolves.toBeDefined();
      expect(repository.create).toHaveBeenCalled();
    });

    it("logs identifiers only, never personal data", async () => {
      await service.create({ ...openEndedDto, notes: "personal remark" });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("personal remark");
      expect(logger.log).toHaveBeenCalledWith(
        "Vehicle assignment created",
        expect.objectContaining({ assignmentId: ASSIGNMENT_ID }),
      );
    });

    it("logs a rejected overlap as a warning", async () => {
      repository.findOverlapping.mockResolvedValue([
        buildAssignment({ id: OTHER_ASSIGNMENT_ID }),
      ]);

      await expect(service.create(openEndedDto)).rejects.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        "Rejected overlapping vehicle assignment",
        expect.objectContaining({ conflictingAssignmentId: OTHER_ASSIGNMENT_ID }),
      );
    });
  });

  describe("update", () => {
    it("throws when the assignment does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(ASSIGNMENT_ID, { notes: "x" }),
      ).rejects.toThrow(VehicleAssignmentNotFoundException);
    });

    it("updates notes without touching the period", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await service.update(ASSIGNMENT_ID, { notes: "corrected" });

      expect(repository.update).toHaveBeenCalledWith(ASSIGNMENT_ID, {
        validTo: undefined,
        notes: "corrected",
      });
      expect(repository.findOverlapping).not.toHaveBeenCalled();
    });

    it("re-checks overlap when the end date changes", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await service.update(ASSIGNMENT_ID, { validTo: "2026-06-30" });

      expect(repository.findOverlapping).toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        ASSIGNMENT_ID,
        expect.objectContaining({ validTo: toUtcDate("2026-06-30") }),
      );
    });

    it("reopens an assignment when validTo is null", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validTo: toUtcDate("2099-01-01") }),
      );

      await service.update(ASSIGNMENT_ID, { validTo: null });

      expect(repository.update).toHaveBeenCalledWith(
        ASSIGNMENT_ID,
        expect.objectContaining({ validTo: null }),
      );
    });

    it("rejects an end date before the start date", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validFrom: toUtcDate("2026-03-01") }),
      );

      await expect(
        service.update(ASSIGNMENT_ID, { validTo: "2026-02-01" }),
      ).rejects.toThrow(InvalidAssignmentPeriodException);
    });

    it("refuses to re-date an assignment that has already ended", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validTo: toUtcDate("2020-01-01") }),
      );

      await expect(
        service.update(ASSIGNMENT_ID, { validTo: "2020-06-30" }),
      ).rejects.toThrow(HistoricalAssignmentException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("still allows notes on an assignment that has ended", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validTo: toUtcDate("2020-01-01") }),
      );

      await expect(
        service.update(ASSIGNMENT_ID, { notes: "late correction" }),
      ).resolves.toBeDefined();
    });

    it("logs changed field names but never their values", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await service.update(ASSIGNMENT_ID, { notes: "confidential" });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("confidential");
      expect(logged).toContain("notes");
    });
  });

  describe("end", () => {
    it("closes an open assignment on the supplied date", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await service.end(ASSIGNMENT_ID, { validTo: "2026-06-30" });

      expect(repository.setValidTo).toHaveBeenCalledWith(
        ASSIGNMENT_ID,
        toUtcDate("2026-06-30"),
      );
    });

    it("defaults to today when no date is given", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await service.end(ASSIGNMENT_ID, {});

      expect(repository.setValidTo).toHaveBeenCalledWith(
        ASSIGNMENT_ID,
        todayUtc(),
      );
    });

    it("runs inside a transaction", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await service.end(ASSIGNMENT_ID, {});

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    });

    it("rejects an end date before the start date", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validFrom: toUtcDate("2026-03-01") }),
      );

      await expect(
        service.end(ASSIGNMENT_ID, { validTo: "2026-01-01" }),
      ).rejects.toThrow(InvalidAssignmentPeriodException);
    });

    it("refuses to end an assignment that already ended", async () => {
      repository.findById.mockResolvedValue(
        buildAssignment({ validTo: toUtcDate("2020-01-01") }),
      );

      await expect(service.end(ASSIGNMENT_ID, {})).rejects.toThrow(
        HistoricalAssignmentException,
      );
    });

    it("throws when the assignment does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.end(ASSIGNMENT_ID, {})).rejects.toThrow(
        VehicleAssignmentNotFoundException,
      );
    });

    it("logs the closure with identifiers only", async () => {
      repository.findById.mockResolvedValue(buildAssignment());

      await service.end(ASSIGNMENT_ID, {});

      expect(logger.log).toHaveBeenCalledWith(
        "Vehicle assignment ended",
        expect.objectContaining({ assignmentId: ASSIGNMENT_ID }),
      );
    });
  });

  it("exposes no delete operation", () => {
    const methods = Object.getOwnPropertyNames(
      VehicleAssignmentService.prototype,
    );

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("remove");
  });

  it("never assigns trips", () => {
    // The module defines the default Driver-Vehicle relationship only.
    const source = VehicleAssignmentService.prototype.constructor.toString();

    expect(source).not.toContain("trip");
    expect(toIsoDate(todayUtc())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
