import { Prisma, Vehicle } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { ListVehiclesQueryDto } from "./dto/list-vehicles-query.dto";
import {
  VehicleDisplayColorConflictException,
  VehicleLicensePlateConflictException,
  VehicleNotFoundException,
} from "./exceptions/vehicle.exceptions";
import { VehicleRepository } from "./vehicle.repository";
import { VehicleService } from "./vehicle.service";

const VEHICLE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_VEHICLE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function buildVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: VEHICLE_ID,
    licensePlate: "1-ABC-123",
    displayColor: "#2563eb",
    description: null,
    brand: null,
    model: null,
    year: null,
    notes: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.9.1",
  });
}

describe("VehicleService", () => {
  let repository: jest.Mocked<VehicleRepository>;
  let logger: jest.Mocked<AppLoggerService>;
  let service: VehicleService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn(),
      findById: jest.fn(),
      findActiveByLicensePlate: jest.fn().mockResolvedValue(null),
      findActiveByDisplayColor: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      setActive: jest.fn(),
    } as unknown as jest.Mocked<VehicleRepository>;

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new VehicleService(repository, logger);
  });

  function query(overrides: Partial<ListVehiclesQueryDto> = {}) {
    return { page: 1, pageSize: 25, ...overrides } as ListVehiclesQueryDto;
  }

  describe("findAll", () => {
    it("translates page and pageSize into skip and take", async () => {
      repository.findPage.mockResolvedValue({ items: [], totalItems: 0 });

      await service.findAll(query({ page: 3, pageSize: 10 }));

      expect(repository.findPage).toHaveBeenCalledWith({
        isActive: undefined,
        search: undefined,
        skip: 20,
        take: 10,
      });
    });

    it("computes pagination metadata from the total", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildVehicle()],
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

    it("maps entities without leaking extra fields", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildVehicle()],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(Object.keys(item).sort()).toEqual([
        "brand",
        "createdAt",
        "description",
        "displayColor",
        "id",
        "isActive",
        "licensePlate",
        "model",
        "notes",
        "updatedAt",
        "year",
      ]);
    });

    it("forwards the filters", async () => {
      repository.findPage.mockResolvedValue({ items: [], totalItems: 0 });

      await service.findAll(query({ isActive: false, search: "volvo" }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, search: "volvo" }),
      );
    });
  });

  describe("findById", () => {
    it("returns the vehicle when it exists", async () => {
      repository.findById.mockResolvedValue(buildVehicle());

      expect((await service.findById(VEHICLE_ID)).id).toBe(VEHICLE_ID);
    });

    it("throws when it does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById(VEHICLE_ID)).rejects.toThrow(
        VehicleNotFoundException,
      );
    });

    it("returns inactive vehicles too, so history stays reachable", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: false }));

      expect((await service.findById(VEHICLE_ID)).isActive).toBe(false);
    });
  });

  describe("create", () => {
    it("stores the vehicle with nulls for omitted optional fields", async () => {
      repository.create.mockResolvedValue(buildVehicle());

      await service.create({
        licensePlate: "1-ABC-123",
        displayColor: "#2563eb",
      });

      expect(repository.create).toHaveBeenCalledWith({
        licensePlate: "1-ABC-123",
        displayColor: "#2563eb",
        description: null,
        brand: null,
        model: null,
        year: null,
        notes: null,
      });
    });

    it("rejects a licence plate already held by an active vehicle", async () => {
      repository.findActiveByLicensePlate.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await expect(
        service.create({ licensePlate: "1-ABC-123", displayColor: "#2563eb" }),
      ).rejects.toThrow(VehicleLicensePlateConflictException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("rejects a planning colour already held by an active vehicle", async () => {
      repository.findActiveByDisplayColor.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await expect(
        service.create({ licensePlate: "9-ZZZ-999", displayColor: "#2563eb" }),
      ).rejects.toThrow(VehicleDisplayColorConflictException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("allows a plate and colour held only by an inactive vehicle", async () => {
      repository.findActiveByLicensePlate.mockResolvedValue(null);
      repository.findActiveByDisplayColor.mockResolvedValue(null);
      repository.create.mockResolvedValue(buildVehicle());

      await expect(
        service.create({ licensePlate: "1-ABC-123", displayColor: "#2563eb" }),
      ).resolves.toMatchObject({ licensePlate: "1-ABC-123" });
    });

    it("translates a unique-index violation into a plate conflict", async () => {
      repository.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.create({ licensePlate: "1-ABC-123", displayColor: "#2563eb" }),
      ).rejects.toThrow(VehicleLicensePlateConflictException);
    });

    it("logs only the identifier", async () => {
      repository.create.mockResolvedValue(buildVehicle());

      await service.create({
        licensePlate: "1-ABC-123",
        displayColor: "#2563eb",
        notes: "internal remark",
      });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("internal remark");
      expect(logger.log).toHaveBeenCalledWith("Vehicle created", {
        vehicleId: VEHICLE_ID,
      });
    });
  });

  describe("update", () => {
    it("throws when the vehicle does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(VEHICLE_ID, { brand: "Scania" }),
      ).rejects.toThrow(VehicleNotFoundException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("passes undefined through so omitted fields stay unchanged", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.update.mockResolvedValue(buildVehicle({ brand: "Scania" }));

      await service.update(VEHICLE_ID, { brand: "Scania" });

      expect(repository.update).toHaveBeenCalledWith(VEHICLE_ID, {
        licensePlate: undefined,
        displayColor: undefined,
        description: undefined,
        brand: "Scania",
        model: undefined,
        year: undefined,
        notes: undefined,
      });
    });

    it("passes an explicit null through so a field can be cleared", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ notes: "old" }));
      repository.update.mockResolvedValue(buildVehicle({ notes: null }));

      await service.update(VEHICLE_ID, { notes: null });

      expect(repository.update).toHaveBeenCalledWith(
        VEHICLE_ID,
        expect.objectContaining({ notes: null }),
      );
    });

    it("excludes the edited vehicle from its own plate check", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.update.mockResolvedValue(buildVehicle());

      await service.update(VEHICLE_ID, { licensePlate: "1-ABC-123" });

      expect(repository.findActiveByLicensePlate).toHaveBeenCalledWith(
        "1-ABC-123",
        VEHICLE_ID,
      );
    });

    it("excludes the edited vehicle from its own colour check", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.update.mockResolvedValue(buildVehicle());

      await service.update(VEHICLE_ID, { displayColor: "#2563eb" });

      expect(repository.findActiveByDisplayColor).toHaveBeenCalledWith(
        "#2563eb",
        VEHICLE_ID,
      );
    });

    it("rejects a plate held by another active vehicle", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.findActiveByLicensePlate.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await expect(
        service.update(VEHICLE_ID, { licensePlate: "9-ZZZ-999" }),
      ).rejects.toThrow(VehicleLicensePlateConflictException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("rejects a colour held by another active vehicle", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.findActiveByDisplayColor.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await expect(
        service.update(VEHICLE_ID, { displayColor: "#16a34a" }),
      ).rejects.toThrow(VehicleDisplayColorConflictException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("skips both checks when neither identifier is touched", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.update.mockResolvedValue(buildVehicle());

      await service.update(VEHICLE_ID, { brand: "Scania" });

      expect(repository.findActiveByLicensePlate).not.toHaveBeenCalled();
      expect(repository.findActiveByDisplayColor).not.toHaveBeenCalled();
    });

    it("cannot change the active state", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.update.mockResolvedValue(buildVehicle());

      await service.update(VEHICLE_ID, { brand: "Scania" });

      const [, data] = repository.update.mock.calls[0];
      expect(data).not.toHaveProperty("isActive");
    });

    it("logs changed field names but never their values", async () => {
      repository.findById.mockResolvedValue(buildVehicle());
      repository.update.mockResolvedValue(buildVehicle());

      await service.update(VEHICLE_ID, { notes: "confidential remark" });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("confidential remark");
      expect(logged).toContain("notes");
    });
  });

  describe("activate", () => {
    it("activates an inactive vehicle", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: false }));
      repository.setActive.mockResolvedValue(buildVehicle({ isActive: true }));

      const result = await service.activate(VEHICLE_ID);

      expect(repository.setActive).toHaveBeenCalledWith(VEHICLE_ID, true);
      expect(result.isActive).toBe(true);
      expect(logger.log).toHaveBeenCalledWith("Vehicle activated", {
        vehicleId: VEHICLE_ID,
      });
    });

    it("is idempotent for an already active vehicle", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: true }));

      await service.activate(VEHICLE_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("refuses when the plate was taken while inactive", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: false }));
      repository.findActiveByLicensePlate.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await expect(service.activate(VEHICLE_ID)).rejects.toThrow(
        VehicleLicensePlateConflictException,
      );

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("refuses when the colour was taken while inactive", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: false }));
      repository.findActiveByDisplayColor.mockResolvedValue(
        buildVehicle({ id: OTHER_VEHICLE_ID }),
      );

      await expect(service.activate(VEHICLE_ID)).rejects.toThrow(
        VehicleDisplayColorConflictException,
      );

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("throws when the vehicle does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.activate(VEHICLE_ID)).rejects.toThrow(
        VehicleNotFoundException,
      );
    });
  });

  describe("deactivate", () => {
    it("soft deletes rather than removing the record", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: true }));
      repository.setActive.mockResolvedValue(buildVehicle({ isActive: false }));

      const result = await service.deactivate(VEHICLE_ID);

      expect(repository.setActive).toHaveBeenCalledWith(VEHICLE_ID, false);
      expect(result.isActive).toBe(false);
      expect(logger.log).toHaveBeenCalledWith("Vehicle deactivated", {
        vehicleId: VEHICLE_ID,
      });
    });

    it("is idempotent for an already inactive vehicle", async () => {
      repository.findById.mockResolvedValue(buildVehicle({ isActive: false }));

      await service.deactivate(VEHICLE_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("is never blocked by historical references", async () => {
      // Deactivation must always succeed: historical Trips keep resolving the
      // vehicle precisely because the row is retained.
      repository.findById.mockResolvedValue(buildVehicle({ isActive: true }));
      repository.setActive.mockResolvedValue(buildVehicle({ isActive: false }));

      await expect(service.deactivate(VEHICLE_ID)).resolves.toMatchObject({
        isActive: false,
      });
    });

    it("throws when the vehicle does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.deactivate(VEHICLE_ID)).rejects.toThrow(
        VehicleNotFoundException,
      );
    });
  });

  it("exposes no delete operation", () => {
    const methods = Object.getOwnPropertyNames(VehicleService.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("remove");
  });
});
