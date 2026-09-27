import { Prisma, RoutePricing } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { ListRoutePricingQueryDto } from "./dto/list-route-pricing-query.dto";
import {
  CombinationLegNotSeparatelyRemovableException,
  DuplicateActiveRouteException,
  RoutePricingNotFoundException,
} from "./exceptions/route-pricing.exceptions";
import { RoutePricingRepository } from "./route-pricing.repository";
import { RouteConfigurationKind } from "./route-pricing.repository";
import { RoutePricingService } from "./route-pricing.service";

const ROUTE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ROUTE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const COMBINATION_GROUP_ID = "7d2b8c14-9f3a-4c5e-8b1d-2e3f4a5b6c7d";

function buildRoutePricing(
  overrides: Partial<RoutePricing> = {},
): RoutePricing {
  return {
    id: ROUTE_ID,
    routeName: "Antwerp - Rotterdam",
    departure: "Antwerp",
    destination: "Rotterdam",
    kilometres: new Prisma.Decimal("25.00"),
    basePrice: new Prisma.Decimal("380.00"),
    // An ordinary route: neither half of the Combination discriminator is set.
    combinationGroupId: null,
    combinationLegPosition: null,
    // Administrative progress, false until somebody says otherwise.
    reviewed: false,
    notes: null,
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
      findByRoute: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildRoutePricing()),
      update: jest.fn().mockResolvedValue(buildRoutePricing()),
      delete: jest.fn(),
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
        // Both halves of the Combination discriminator: a record says which kind
        // of configuration it is rather than leaving a caller to infer it.
        "combinationGroupId",
        "combinationLegPosition",
        "createdAt",
        "departure",
        "destination",
        "id",
        "kilometres",
        "notes",
        // Administrative progress, carried so a screen can show it.
        "reviewed",
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

    it("forwards the search", async () => {
      await service.findAll(query({ search: "antwerp" }));

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: "antwerp" }),
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

    it("returns the route's configured length", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      expect((await service.findById(ROUTE_ID)).kilometres).toBe("25.00");
    });

    /** Routes configured before distances existed have none, and say so. */
    it("returns null for a route whose length nobody has stated", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({ kilometres: null }),
      );

      expect((await service.findById(ROUTE_ID)).kilometres).toBeNull();
    });
  });

  describe("create", () => {
    const dto = {
      routeName: "Antwerp - Rotterdam",
      departure: "Antwerp",
      destination: "Rotterdam",
      basePrice: 380,
    };

    it("stores the record with null for an omitted distance and notes", async () => {
      await service.create(dto);

      expect(repository.create).toHaveBeenCalledWith({
        routeName: "Antwerp - Rotterdam",
        departure: "Antwerp",
        destination: "Rotterdam",
        basePrice: 380,
        // Null, not zero: nobody has stated the distance, so no toll is
        // charged — as against a road somebody measured as nought kilometres.
        kilometres: null,
        notes: null,
      });
    });

    it("stores the distance it was given", async () => {
      await service.create({ ...dto, kilometres: 25 });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ kilometres: 25 }),
      );
    });

    it("rejects a route already covered by an active record", async () => {
      repository.findByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      await expect(service.create(dto)).rejects.toThrow(
        DuplicateActiveRouteException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("allows a route covered only by an inactive record", async () => {
      repository.findByRoute.mockResolvedValue(null);

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
      repository.findByRoute.mockResolvedValue(
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

      expect(repository.findByRoute).not.toHaveBeenCalled();
    });

    it("re-checks uniqueness when the route moves", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await service.update(ROUTE_ID, { destination: "Gent" });

      expect(repository.findByRoute).toHaveBeenCalledWith("Antwerp", "Gent", {
        // An ordinary route collides only with another ordinary route: a
        // Combination leg on the same road is a different pricing context.
        kind: RouteConfigurationKind.NORMAL,
        excludeRoutePricingId: ROUTE_ID,
      });
    });

    it("rejects a move onto a route another active record covers", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.findByRoute.mockResolvedValue(
        buildRoutePricing({ id: OTHER_ROUTE_ID }),
      );

      await expect(
        service.update(ROUTE_ID, { destination: "Gent" }),
      ).rejects.toThrow(DuplicateActiveRouteException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("checks uniqueness whenever the route moves", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());

      await service.update(ROUTE_ID, { destination: "Gent" });

      expect(repository.findByRoute).toHaveBeenCalled();
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

  /**
   * ── REMOVING REPLACED SWITCHING OFF ───────────────────────────────────────
   * A route used to be deactivated and kept, so that pricing derived from it
   * stayed explainable. It stays explainable regardless: a snapshot holds the
   * amounts it was priced with and reads no configuration ever again. The kept
   * row only gave the screen a second state to explain.
   */
  describe("remove", () => {
    it("deletes the record", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.delete.mockResolvedValue(buildRoutePricing());

      await service.remove(ROUTE_ID);

      expect(repository.delete).toHaveBeenCalledWith(ROUTE_ID);
    });

    /**
     * ── IT ANSWERS WITH WHAT IT REMOVED ────────────────────────────────────
     * The convention every DELETE in this API follows, and the reason for it:
     * each response carries the standard envelope. A caller that receives an
     * empty body has nothing to read and cannot tell success from a broken
     * response — which is exactly what happened on this screen.
     */
    it("answers with the record it removed", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.delete.mockResolvedValue(buildRoutePricing());

      expect(await service.remove(ROUTE_ID)).toMatchObject({
        id: ROUTE_ID,
        departure: "Antwerp",
        destination: "Rotterdam",
        basePrice: "380.00",
      });
    });

    it("refuses an unknown record, and deletes nothing", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.remove(ROUTE_ID)).rejects.toBeInstanceOf(
        RoutePricingNotFoundException,
      );

      expect(repository.delete).not.toHaveBeenCalled();
    });

    /*
     * ── HALF A COMBINATION IS NOT A THING ──────────────────────────────────
     * Removing one leg would leave a configuration that prices the outbound and
     * silently charges nothing for the return. The whole Combination goes
     * through CombinationRoutePricingService, or none of it does.
     */
    it("refuses to remove a leg of a Combination", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({
          combinationGroupId: COMBINATION_GROUP_ID,
          combinationLegPosition: 1,
        }),
      );

      await expect(service.remove(ROUTE_ID)).rejects.toBeInstanceOf(
        CombinationLegNotSeparatelyRemovableException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("names the Combination to remove instead", async () => {
      repository.findById.mockResolvedValue(
        buildRoutePricing({
          combinationGroupId: COMBINATION_GROUP_ID,
          combinationLegPosition: 2,
        }),
      );

      await expect(service.remove(ROUTE_ID)).rejects.toThrow(
        COMBINATION_GROUP_ID,
      );
    });

    /** The route it covered is free again the moment it is gone. */
    it("frees the route for a new configuration", async () => {
      repository.findById.mockResolvedValue(buildRoutePricing());
      repository.delete.mockResolvedValue(buildRoutePricing());
      await service.remove(ROUTE_ID);

      repository.findByRoute.mockResolvedValue(null);
      repository.create.mockResolvedValue(buildRoutePricing());

      await expect(
        service.create({
          routeName: "Antwerp - Rotterdam",
          departure: "Antwerp",
          destination: "Rotterdam",
          basePrice: 380,
        }),
      ).resolves.toBeDefined();
    });

    it("offers no way to switch a route off instead", () => {
      const methods = Object.getOwnPropertyNames(RoutePricingService.prototype);

      expect(methods).not.toContain("activate");
      expect(methods).not.toContain("deactivate");
    });
  });
});
