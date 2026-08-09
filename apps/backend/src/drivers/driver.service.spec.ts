import { Driver, Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto";
import {
  DriverLicenceNumberConflictException,
  DriverNotFoundException,
} from "./exceptions/driver.exceptions";
import { DriverRepository } from "./driver.repository";
import { DriverService } from "./driver.service";

const DRIVER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_DRIVER_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function buildDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: DRIVER_ID,
    name: "Jan Peeters",
    licenceNumber: null,
    phoneNumber: null,
    email: null,
    emergencyContact: null,
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

describe("DriverService", () => {
  let repository: jest.Mocked<DriverRepository>;
  let logger: jest.Mocked<AppLoggerService>;
  let service: DriverService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn(),
      findById: jest.fn(),
      findActiveByLicenceNumber: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      setActive: jest.fn(),
    } as unknown as jest.Mocked<DriverRepository>;

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new DriverService(repository, logger);
  });

  function query(overrides: Partial<ListDriversQueryDto> = {}) {
    return { page: 1, pageSize: 25, ...overrides } as ListDriversQueryDto;
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
        items: [buildDriver()],
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
        items: [buildDriver()],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(Object.keys(item).sort()).toEqual([
        "createdAt",
        "email",
        "emergencyContact",
        "id",
        "isActive",
        "licenceNumber",
        "name",
        "notes",
        "phoneNumber",
        "updatedAt",
      ]);
    });

    it("forwards the filters", async () => {
      repository.findPage.mockResolvedValue({ items: [], totalItems: 0 });

      await service.findAll(query({ isActive: false, search: "peeters" }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, search: "peeters" }),
      );
    });
  });

  describe("findById", () => {
    it("returns the driver when it exists", async () => {
      repository.findById.mockResolvedValue(buildDriver());

      expect((await service.findById(DRIVER_ID)).id).toBe(DRIVER_ID);
    });

    it("throws when it does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById(DRIVER_ID)).rejects.toThrow(
        DriverNotFoundException,
      );
    });

    it("returns inactive drivers too, so history stays reachable", async () => {
      repository.findById.mockResolvedValue(buildDriver({ isActive: false }));

      expect((await service.findById(DRIVER_ID)).isActive).toBe(false);
    });
  });

  describe("create", () => {
    it("stores the driver with nulls for omitted optional fields", async () => {
      repository.create.mockResolvedValue(buildDriver());

      await service.create({ name: "Jan Peeters" });

      expect(repository.create).toHaveBeenCalledWith({
        name: "Jan Peeters",
        licenceNumber: null,
        phoneNumber: null,
        email: null,
        emergencyContact: null,
        notes: null,
      });
    });

    it("rejects a licence number already held by an active driver", async () => {
      repository.findActiveByLicenceNumber.mockResolvedValue(
        buildDriver({ id: OTHER_DRIVER_ID, licenceNumber: "B-123" }),
      );

      await expect(
        service.create({ name: "Jan", licenceNumber: "B-123" }),
      ).rejects.toThrow(DriverLicenceNumberConflictException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("allows a licence number held only by an inactive driver", async () => {
      repository.findActiveByLicenceNumber.mockResolvedValue(null);
      repository.create.mockResolvedValue(buildDriver({ licenceNumber: "B-123" }));

      await expect(
        service.create({ name: "Jan", licenceNumber: "B-123" }),
      ).resolves.toMatchObject({ licenceNumber: "B-123" });
    });

    it("does not check uniqueness when no licence number is given", async () => {
      repository.create.mockResolvedValue(buildDriver());

      await service.create({ name: "Jan Peeters" });

      expect(repository.findActiveByLicenceNumber).not.toHaveBeenCalled();
    });

    it("translates a unique-index violation into a domain conflict", async () => {
      repository.findActiveByLicenceNumber.mockResolvedValue(null);
      repository.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.create({ name: "Jan", licenceNumber: "B-123" }),
      ).rejects.toThrow(DriverLicenceNumberConflictException);
    });

    it("never logs personal data", async () => {
      repository.create.mockResolvedValue(
        buildDriver({ name: "Jan Peeters", email: "jan@example.com" }),
      );

      await service.create({
        name: "Jan Peeters",
        email: "jan@example.com",
        phoneNumber: "+32 470 11 22 33",
      });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("Jan Peeters");
      expect(logged).not.toContain("jan@example.com");
      expect(logged).not.toContain("+32 470 11 22 33");
      expect(logger.log).toHaveBeenCalledWith("Driver created", {
        driverId: DRIVER_ID,
      });
    });
  });

  describe("update", () => {
    it("throws when the driver does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update(DRIVER_ID, { name: "X" })).rejects.toThrow(
        DriverNotFoundException,
      );

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("passes undefined through so omitted fields stay unchanged", async () => {
      repository.findById.mockResolvedValue(buildDriver());
      repository.update.mockResolvedValue(buildDriver({ name: "New Name" }));

      await service.update(DRIVER_ID, { name: "New Name" });

      expect(repository.update).toHaveBeenCalledWith(DRIVER_ID, {
        name: "New Name",
        licenceNumber: undefined,
        phoneNumber: undefined,
        email: undefined,
        emergencyContact: undefined,
        notes: undefined,
      });
    });

    it("passes an explicit null through so a field can be cleared", async () => {
      repository.findById.mockResolvedValue(
        buildDriver({ licenceNumber: "B-123" }),
      );
      repository.update.mockResolvedValue(buildDriver({ licenceNumber: null }));

      await service.update(DRIVER_ID, { licenceNumber: null });

      expect(repository.update).toHaveBeenCalledWith(
        DRIVER_ID,
        expect.objectContaining({ licenceNumber: null }),
      );
    });

    it("excludes the edited driver from its own uniqueness check", async () => {
      repository.findById.mockResolvedValue(
        buildDriver({ licenceNumber: "B-123" }),
      );
      repository.update.mockResolvedValue(buildDriver());

      await service.update(DRIVER_ID, { licenceNumber: "B-123" });

      expect(repository.findActiveByLicenceNumber).toHaveBeenCalledWith(
        "B-123",
        DRIVER_ID,
      );
    });

    it("rejects a licence number held by another active driver", async () => {
      repository.findById.mockResolvedValue(buildDriver());
      repository.findActiveByLicenceNumber.mockResolvedValue(
        buildDriver({ id: OTHER_DRIVER_ID, licenceNumber: "B-999" }),
      );

      await expect(
        service.update(DRIVER_ID, { licenceNumber: "B-999" }),
      ).rejects.toThrow(DriverLicenceNumberConflictException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("skips the uniqueness check when clearing the licence number", async () => {
      repository.findById.mockResolvedValue(
        buildDriver({ licenceNumber: "B-123" }),
      );
      repository.update.mockResolvedValue(buildDriver({ licenceNumber: null }));

      await service.update(DRIVER_ID, { licenceNumber: null });

      expect(repository.findActiveByLicenceNumber).not.toHaveBeenCalled();
    });

    it("logs changed field names but never their values", async () => {
      repository.findById.mockResolvedValue(buildDriver());
      repository.update.mockResolvedValue(buildDriver());

      await service.update(DRIVER_ID, {
        name: "Piet Janssens",
        email: "piet@example.com",
      });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("Piet Janssens");
      expect(logged).not.toContain("piet@example.com");
      expect(logged).toContain("name");
      expect(logged).toContain("email");
    });

    it("cannot change the active state", async () => {
      repository.findById.mockResolvedValue(buildDriver());
      repository.update.mockResolvedValue(buildDriver());

      await service.update(DRIVER_ID, { name: "X" });

      const [, data] = repository.update.mock.calls[0];
      expect(data).not.toHaveProperty("isActive");
    });
  });

  describe("activate", () => {
    it("activates an inactive driver", async () => {
      repository.findById.mockResolvedValue(buildDriver({ isActive: false }));
      repository.setActive.mockResolvedValue(buildDriver({ isActive: true }));

      const result = await service.activate(DRIVER_ID);

      expect(repository.setActive).toHaveBeenCalledWith(DRIVER_ID, true);
      expect(result.isActive).toBe(true);
      expect(logger.log).toHaveBeenCalledWith("Driver activated", {
        driverId: DRIVER_ID,
      });
    });

    it("is idempotent for an already active driver", async () => {
      repository.findById.mockResolvedValue(buildDriver({ isActive: true }));

      const result = await service.activate(DRIVER_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
      expect(result.isActive).toBe(true);
    });

    it("refuses when the licence number was taken while inactive", async () => {
      repository.findById.mockResolvedValue(
        buildDriver({ isActive: false, licenceNumber: "B-123" }),
      );
      repository.findActiveByLicenceNumber.mockResolvedValue(
        buildDriver({ id: OTHER_DRIVER_ID, licenceNumber: "B-123" }),
      );

      await expect(service.activate(DRIVER_ID)).rejects.toThrow(
        DriverLicenceNumberConflictException,
      );

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("activates without a licence check when the driver has no licence", async () => {
      repository.findById.mockResolvedValue(
        buildDriver({ isActive: false, licenceNumber: null }),
      );
      repository.setActive.mockResolvedValue(buildDriver({ isActive: true }));

      await service.activate(DRIVER_ID);

      expect(repository.findActiveByLicenceNumber).not.toHaveBeenCalled();
      expect(repository.setActive).toHaveBeenCalledWith(DRIVER_ID, true);
    });

    it("throws when the driver does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.activate(DRIVER_ID)).rejects.toThrow(
        DriverNotFoundException,
      );
    });
  });

  describe("deactivate", () => {
    it("soft deletes rather than removing the record", async () => {
      repository.findById.mockResolvedValue(buildDriver({ isActive: true }));
      repository.setActive.mockResolvedValue(buildDriver({ isActive: false }));

      const result = await service.deactivate(DRIVER_ID);

      expect(repository.setActive).toHaveBeenCalledWith(DRIVER_ID, false);
      expect(result.isActive).toBe(false);
      expect(logger.log).toHaveBeenCalledWith("Driver deactivated", {
        driverId: DRIVER_ID,
      });
    });

    it("is idempotent for an already inactive driver", async () => {
      repository.findById.mockResolvedValue(buildDriver({ isActive: false }));

      await service.deactivate(DRIVER_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("is never blocked by historical references", async () => {
      // Deactivation must always succeed: historical Trips keep resolving the
      // driver precisely because the row is retained.
      repository.findById.mockResolvedValue(buildDriver({ isActive: true }));
      repository.setActive.mockResolvedValue(buildDriver({ isActive: false }));

      await expect(service.deactivate(DRIVER_ID)).resolves.toMatchObject({
        isActive: false,
      });
    });

    it("throws when the driver does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.deactivate(DRIVER_ID)).rejects.toThrow(
        DriverNotFoundException,
      );
    });
  });

  it("exposes no delete operation", () => {
    const methods = Object.getOwnPropertyNames(DriverService.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("remove");
  });
});
