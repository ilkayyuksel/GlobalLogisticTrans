import { Prisma, RoutePricing } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { ListRoutePricingQueryDto } from "./dto/list-route-pricing-query.dto";
import {
  DuplicateActiveRouteException,
  RoutePricingNotFoundException,
} from "./exceptions/route-pricing.exceptions";
import { RoutePricingRepository } from "./route-pricing.repository";
import { RoutePricingService } from "./route-pricing.service";

const ROUTE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ROUTE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function buildRoutePricing(
  overrides: Partial<RoutePricing> = {},
): RoutePricing {
  return {
    id: ROUTE_ID,
    routeName: "Antwerp - Rotterdam",
    departure: "Antwerp",
    destination: "Rotterdam",
    basePrice: new Prisma.Decimal("380.00"),
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

describe("RoutePricingService", () => {
  let repository: jest.Mocked<RoutePricingRepository>;
  let logger: jest.Mocked<AppLoggerService>;
  let service: RoutePricingService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByRoute: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildRoutePricing()),
      update: jest.fn().mockResolvedValue(buildRoutePricing()),
      setActive: jest.fn().mockResolvedValue(buildRoutePricing()),
    } as unknown as jest.Mocked<RoutePricingRepository>;

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new RoutePricingService(repository, logger);
  });

  function query(overrides: Partial<ListRoutePricingQueryDto> = {}) {
    return { page: 1, pageSize: 25, ...overrides } as ListRoutePricingQueryDto;
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
        items: [buildRoutePricing()],
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
        items: [buildRoutePricing()],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(Object.keys(item).sort()).toEqual([
        "basePrice",
        "createdAt",
        "departure",
        "destination",
        "id",
        "isActive",
        "notes",
        "routeName",
        "updatedAt",
      ]);
    });

    it("serialises the price as a fixed two-decimal string", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildRoutePricing({ basePrice: new Prisma.Decimal("380") })],
        totalItems: 1,
      });

      const [item] = (await service.findAll(query())).items;

      expect(item.basePrice).toBe("380.00");
      expect(typeof item.basePrice).toBe("string");
    });

    it("forwards the filters", async () => {
      await service.findAll(query({ isActive: false, search: "antwerp" }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, search: "antwerp" }),
      );
    });
  });

  describe("findById", () => {
    it("returns the record when it exists", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      expect((await service.findById(ROUTE_ID)).id).toBe(ROUTE_ID);
    });

    it("throws when it does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById(ROUTE_ID)).rejects.toThrow(
        RoutePricingNotFoundException,
      );
    });

    it("returns inactive records too, so history stays explainable", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );

      expect((await service.findById(ROUTE_ID)).isActive).toBe(false);
    });
  });

  describe("create", () => {
    const dto = {
      routeName: "Antwerp - Rotterdam",
      departure: "Antwerp",
      destination: "Rotterdam",
      basePrice: 380,
    };

    it("stores the record with null for omitted notes", async () => {
      await service.create(dto);

      expect(repository.create).toHaveBeenCalledWith({
        routeName: "Antwerp - Rotterdam",
        departure: "Antwerp",
        destination: "Rotterdam",
        basePrice: 380,
        notes: null,
      });
    });

    it("rejects a route already covered by an active record", async () => {
      repository.findActiveByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      await expect(service.create(dto)).rejects.toThrow(
        DuplicateActiveRouteException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("allows a route covered only by an inactive record", async () => {
      repository.findActiveByRoute.mockResolvedValue(null);

      await expect(service.create(dto)).resolves.toMatchObject({
        departure: "Antwerp",
      });
    });

    it("translates a unique-index violation into a domain conflict", async () => {
      repository.create.mockRejectedValue(uniqueViolation());

      await expect(service.create(dto)).rejects.toThrow(
        DuplicateActiveRouteException,
      );
    });

    it("never logs the price", async () => {
      await service.create({ ...dto, basePrice: 1234.56, notes: "commercial" });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("1234.56");
      expect(logged).not.toContain("commercial");
      expect(logger.log).toHaveBeenCalledWith("Route pricing created", {
        routePricingId: ROUTE_ID,
      });
    });

    it("logs a rejected duplicate as a warning without the price", async () => {
      repository.findActiveByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      await expect(service.create({ ...dto, basePrice: 999.99 })).rejects.toThrow();

      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("999.99");
    });
  });

  describe("update", () => {
    it("throws when the record does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update(ROUTE_ID, { basePrice: 1 })).rejects.toThrow(
        RoutePricingNotFoundException,
      );

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("passes undefined through so omitted fields stay unchanged", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await service.update(ROUTE_ID, { basePrice: 400 });

      expect(repository.update).toHaveBeenCalledWith(ROUTE_ID, {
        routeName: undefined,
        departure: undefined,
        destination: undefined,
        basePrice: 400,
        notes: undefined,
      });
    });

    it("passes an explicit null through so notes can be cleared", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing({ notes: "old" }));

      await service.update(ROUTE_ID, { notes: null });

      expect(repository.update).toHaveBeenCalledWith(
        ROUTE_ID,
        expect.objectContaining({ notes: null }),
      );
    });

    it("skips the duplicate check when the route does not move", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await service.update(ROUTE_ID, { basePrice: 400 });

      expect(repository.findActiveByRoute).not.toHaveBeenCalled();
    });

    it("re-checks uniqueness when the route moves", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await service.update(ROUTE_ID, { destination: "Gent" });

      expect(repository.findActiveByRoute).toHaveBeenCalledWith(
        "Antwerp",
        "Gent",
        ROUTE_ID,
      );
    });

    it("rejects a move onto a route another active record covers", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.findActiveByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      await expect(
        service.update(ROUTE_ID, { destination: "Gent" }),
      ).rejects.toThrow(DuplicateActiveRouteException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("does not check uniqueness while the record is inactive", async () => {
      // An inactive record cannot collide with the active-only index.
      repository.findById.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );

      await service.update(ROUTE_ID, { destination: "Gent" });

      expect(repository.findActiveByRoute).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalled();
    });

    it("cannot change the active state", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await service.update(ROUTE_ID, { basePrice: 400 });

      const [, data] = repository.update.mock.calls[0];
      expect(data).not.toHaveProperty("isActive");
    });

    it("logs changed field names but never the price", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await service.update(ROUTE_ID, { basePrice: 987.65 });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain("987.65");
      expect(logged).toContain("basePrice");
    });
  });

  describe("activate", () => {
    it("activates an inactive record", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );
      repository.setActive.mockResolvedValue(
        buildRoutePricing({ isActive: true }),
      );

      const result = await service.activate(ROUTE_ID);

      expect(repository.setActive).toHaveBeenCalledWith(ROUTE_ID, true);
      expect(result.isActive).toBe(true);
      expect(logger.log).toHaveBeenCalledWith("Route pricing activated", {
        routePricingId: ROUTE_ID,
      });
    });

    it("is idempotent for an already active record", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await service.activate(ROUTE_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("refuses when the route was taken while inactive", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );
      repository.findActiveByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      await expect(service.activate(ROUTE_ID)).rejects.toThrow(
        DuplicateActiveRouteException,
      );

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("throws when the record does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.activate(ROUTE_ID)).rejects.toThrow(
        RoutePricingNotFoundException,
      );
    });
  });

  describe("deactivate", () => {
    it("soft deletes rather than removing the record", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.setActive.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );

      const result = await service.deactivate(ROUTE_ID);

      expect(repository.setActive).toHaveBeenCalledWith(ROUTE_ID, false);
      expect(result.isActive).toBe(false);
      expect(logger.log).toHaveBeenCalledWith("Route pricing deactivated", {
        routePricingId: ROUTE_ID,
      });
    });

    it("is idempotent for an already inactive record", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );

      await service.deactivate(ROUTE_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("is never blocked by historical pricing", async () => {
      // Deactivation must always succeed: historical Trip pricing stays
      // explainable precisely because the row is retained.
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.setActive.mockResolvedValue(
        buildRoutePricing({ isActive: false }),
      );

      await expect(service.deactivate(ROUTE_ID)).resolves.toMatchObject({
        isActive: false,
      });
    });

    it("throws when the record does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.deactivate(ROUTE_ID)).rejects.toThrow(
        RoutePricingNotFoundException,
      );
    });
  });

  it("exposes no delete operation", () => {
    const methods = Object.getOwnPropertyNames(RoutePricingService.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("remove");
  });

  it("performs no price arithmetic", () => {
    // Calculation belongs exclusively to the future Pricing Engine.
    const source = RoutePricingService.prototype.constructor.toString();

    expect(source).not.toMatch(/basePrice\s*[*+/-]/);
  });
});
