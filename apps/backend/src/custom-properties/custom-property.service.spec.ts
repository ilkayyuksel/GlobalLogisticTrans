import { CustomProperty, Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CustomPropertyRepository } from "./custom-property.repository";
import { CustomPropertyService } from "./custom-property.service";
import { ListCustomPropertiesQueryDto } from "./dto/list-custom-properties-query.dto";
import {
  CustomPropertyNotFoundException,
  DuplicateCustomPropertyNameException,
} from "./exceptions/custom-property.exceptions";

const PROPERTY_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_PROPERTY_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function buildProperty(
  overrides: Partial<CustomProperty> = {},
): CustomProperty {
  return {
    id: PROPERTY_ID,
    name: "TAR",
    description: null,
    defaultPrice: new Prisma.Decimal("35.00"),
    displayOrder: 1,
    color: "#f59e0b",
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

describe("CustomPropertyService", () => {
  let repository: jest.Mocked<CustomPropertyRepository>;
  let logger: jest.Mocked<AppLoggerService>;
  let service: CustomPropertyService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByName: jest.fn().mockResolvedValue(null),
      findHighestDisplayOrder: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildProperty()),
      update: jest.fn().mockResolvedValue(buildProperty()),
      setActive: jest.fn().mockResolvedValue(buildProperty()),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<CustomPropertyRepository>;

    repository.runInTransaction.mockImplementation(
      (work: (repo: CustomPropertyRepository) => Promise<unknown>) =>
        work(repository),
    );

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new CustomPropertyService(repository, logger);
  });

  function query(overrides: Partial<ListCustomPropertiesQueryDto> = {}) {
    return {
      page: 1,
      pageSize: 25,
      ...overrides,
    } as ListCustomPropertiesQueryDto;
  }

  describe("findAll", () => {
    it("translates page and pageSize into skip and take", async () => {
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
        items: [buildProperty()],
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
        items: [buildProperty()],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(Object.keys(item).sort()).toEqual([
        "color",
        "createdAt",
        "defaultPrice",
        "description",
        "displayOrder",
        "id",
        "isActive",
        "name",
        "updatedAt",
      ]);
    });

    it("serialises the price as a fixed two-decimal string", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildProperty({ defaultPrice: new Prisma.Decimal("35") })],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(item.defaultPrice).toBe("35.00");
    });

    it("keeps a missing price as null rather than zero", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildProperty({ defaultPrice: null })],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(item.defaultPrice).toBeNull();
    });

    it("forwards the filters", async () => {
      await service.findAll(query({ isActive: false, search: "tar" }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, search: "tar" }),
      );
    });
  });

  describe("findById", () => {
    it("returns the property when it exists", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      expect((await service.findById(PROPERTY_ID)).id).toBe(PROPERTY_ID);
    });

    it("throws when it does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById(PROPERTY_ID)).rejects.toThrow(
        CustomPropertyNotFoundException,
      );
    });

    it("returns inactive properties too, so history stays resolvable", async () => {
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));

      expect((await service.findById(PROPERTY_ID)).isActive).toBe(false);
    });
  });

  describe("create", () => {
    const dto = { name: "TAR" };

    it("stores the property with nulls for omitted optional fields", async () => {
      await service.create(dto);

      expect(repository.create).toHaveBeenCalledWith({
        name: "TAR",
        description: null,
        defaultPrice: null,
        displayOrder: 1,
        color: null,
      });
    });

    it("appends after the current highest display order", async () => {
      repository.findHighestDisplayOrder.mockResolvedValue(7);

      await service.create(dto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ displayOrder: 8 }),
      );
    });

    it("starts at 1 when the table is empty", async () => {
      repository.findHighestDisplayOrder.mockResolvedValue(null);

      await service.create(dto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ displayOrder: 1 }),
      );
    });

    it("honours an explicit display order without looking one up", async () => {
      await service.create({ ...dto, displayOrder: 3 });

      expect(repository.findHighestDisplayOrder).not.toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ displayOrder: 3 }),
      );
    });

    it("derives the order and inserts inside one transaction", async () => {
      await service.create(dto);

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    });

    it("rejects a name already held by an active property", async () => {
      repository.findActiveByName.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      await expect(service.create(dto)).rejects.toThrow(
        DuplicateCustomPropertyNameException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("allows a name held only by an inactive property", async () => {
      repository.findActiveByName.mockResolvedValue(null);

      await expect(service.create(dto)).resolves.toMatchObject({ name: "TAR" });
    });

    it("translates a unique-index violation into a domain conflict", async () => {
      repository.create.mockRejectedValue(uniqueViolation());

      await expect(service.create(dto)).rejects.toThrow(
        DuplicateCustomPropertyNameException,
      );
    });

    it("never logs business values", async () => {
      await service.create({
        name: "Confidential Surcharge",
        defaultPrice: 1234.56,
        description: "internal rationale",
      });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("Confidential Surcharge");
      expect(logged).not.toContain("1234.56");
      expect(logged).not.toContain("internal rationale");
      expect(logger.log).toHaveBeenCalledWith("Custom property created", {
        customPropertyId: PROPERTY_ID,
      });
    });
  });

  describe("update", () => {
    it("throws when the property does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(PROPERTY_ID, { color: "#ffffff" }),
      ).rejects.toThrow(CustomPropertyNotFoundException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("passes undefined through so omitted fields stay unchanged", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      await service.update(PROPERTY_ID, { color: "#ffffff" });

      expect(repository.update).toHaveBeenCalledWith(PROPERTY_ID, {
        name: undefined,
        description: undefined,
        defaultPrice: undefined,
        displayOrder: undefined,
        color: "#ffffff",
      });
    });

    it("passes an explicit null through so the price can be cleared", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      await service.update(PROPERTY_ID, { defaultPrice: null });

      expect(repository.update).toHaveBeenCalledWith(
        PROPERTY_ID,
        expect.objectContaining({ defaultPrice: null }),
      );
    });

    it("skips the duplicate check when the name does not change", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      await service.update(PROPERTY_ID, { displayOrder: 5 });

      expect(repository.findActiveByName).not.toHaveBeenCalled();
    });

    it("re-checks uniqueness when the name changes", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      await service.update(PROPERTY_ID, { name: "Flat" });

      expect(repository.findActiveByName).toHaveBeenCalledWith(
        "Flat",
        PROPERTY_ID,
      );
    });

    it("rejects a rename onto a name another active property holds", async () => {
      repository.findById.mockResolvedValue(buildProperty());
      repository.findActiveByName.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      await expect(
        service.update(PROPERTY_ID, { name: "Flat" }),
      ).rejects.toThrow(DuplicateCustomPropertyNameException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("does not check uniqueness while the property is inactive", async () => {
      // An inactive row cannot collide with the active-only index.
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));

      await service.update(PROPERTY_ID, { name: "Flat" });

      expect(repository.findActiveByName).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
    });

    it("cannot change the active state", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      await service.update(PROPERTY_ID, { displayOrder: 5 });

      const [, data] = repository.update.mock.calls[0];
      expect(data).not.toHaveProperty("isActive");
    });

    it("logs changed field names but never their values", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      await service.update(PROPERTY_ID, { defaultPrice: 987.65 });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("987.65");
      expect(logged).toContain("defaultPrice");
    });
  });

  describe("activate", () => {
    it("activates an inactive property", async () => {
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));
      repository.setActive.mockResolvedValue(buildProperty({ isActive: true }));

      const result = await service.activate(PROPERTY_ID);

      expect(repository.setActive).toHaveBeenCalledWith(PROPERTY_ID, true);
      expect(result.isActive).toBe(true);
      expect(logger.log).toHaveBeenCalledWith("Custom property activated", {
        customPropertyId: PROPERTY_ID,
      });
    });

    it("is idempotent for an already active property", async () => {
      repository.findById.mockResolvedValue(buildProperty());

      await service.activate(PROPERTY_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("refuses when the name was taken while inactive", async () => {
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));
      repository.findActiveByName.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      await expect(service.activate(PROPERTY_ID)).rejects.toThrow(
        DuplicateCustomPropertyNameException,
      );

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("throws when the property does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.activate(PROPERTY_ID)).rejects.toThrow(
        CustomPropertyNotFoundException,
      );
    });
  });

  describe("deactivate", () => {
    it("soft deletes rather than removing the record", async () => {
      repository.findById.mockResolvedValue(buildProperty());
      repository.setActive.mockResolvedValue(buildProperty({ isActive: false }));

      const result = await service.deactivate(PROPERTY_ID);

      expect(repository.setActive).toHaveBeenCalledWith(PROPERTY_ID, false);
      expect(result.isActive).toBe(false);
      expect(logger.log).toHaveBeenCalledWith("Custom property deactivated", {
        customPropertyId: PROPERTY_ID,
      });
    });

    it("is idempotent for an already inactive property", async () => {
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));

      await service.deactivate(PROPERTY_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("is never blocked by existing Trip assignments", async () => {
      // Historical Trips keep resolving the property precisely because the row
      // is retained, so deactivation must always succeed.
      repository.findById.mockResolvedValue(buildProperty());
      repository.setActive.mockResolvedValue(buildProperty({ isActive: false }));

      await expect(service.deactivate(PROPERTY_ID)).resolves.toMatchObject({
        isActive: false,
      });
    });

    it("throws when the property does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.deactivate(PROPERTY_ID)).rejects.toThrow(
        CustomPropertyNotFoundException,
      );
    });
  });

  it("exposes no delete operation", () => {
    const methods = Object.getOwnPropertyNames(CustomPropertyService.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("remove");
  });

  it("performs no price arithmetic", () => {
    // Calculation belongs exclusively to the future Pricing Engine.
    const source = CustomPropertyService.prototype.constructor.toString();

    expect(source).not.toMatch(/defaultPrice\s*[*+/-]/);
  });
});
