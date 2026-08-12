import { PricingCalculationStatus, Prisma, TripPricing } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { TripService } from "../trips/trip.service";
import {
  PricingSnapshotRepositories,
  TripPricingRepository,
} from "./trip-pricing.repository";
import {
  ReplacePricingSnapshotCommand,
  TripPricingService,
} from "./trip-pricing.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PRICING_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function buildSnapshot(overrides: Partial<TripPricing> = {}): TripPricing {
  return {
    id: PRICING_ID,
    tripId: TRIP_ID,
    totalPrice: new Prisma.Decimal("484.50"),
    currency: "EUR",
    calculatedAt: new Date("2026-08-17T09:00:00.000Z"),
    pricingEngineVersion: "1.0.0",
    pricingRuleVersion: "2026.1",
    calculationStatus: PricingCalculationStatus.CALCULATED,
    notes: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-17T09:00:00.000Z"),
    ...overrides,
  };
}

function buildCommand(
  overrides: Partial<ReplacePricingSnapshotCommand> = {},
): ReplacePricingSnapshotCommand {
  return {
    tripId: TRIP_ID,
    totalPrice: new Prisma.Decimal("484.50"),
    calculatedAt: new Date("2026-08-17T09:00:01.000Z"),
    pricingEngineVersion: "1.0.0",
    pricingRuleVersion: "2026.1",
    calculationStatus: PricingCalculationStatus.CALCULATED,
    items: [
      {
        pricingComponentId: "component-base",
        customPropertyId: null,
        description: "Antwerp - Rotterdam",
        amount: new Prisma.Decimal("380.00"),
        calculationOrder: 1,
        quantity: null,
        unitPrice: null,
      },
      {
        pricingComponentId: "component-custom",
        customPropertyId: "property-tar",
        description: "TAR",
        amount: new Prisma.Decimal("104.50"),
        calculationOrder: 7,
        quantity: null,
        unitPrice: null,
      },
    ],
    ...overrides,
  };
}

/**
 * The atomic snapshot write.
 *
 * A snapshot is a parent plus its whole breakdown. The transaction is what
 * guarantees `total_price` always equals the sum of its own items — so these
 * tests assert that everything happens inside ONE transaction and that a
 * failure anywhere leaves nothing behind, rather than checking the data after
 * the fact.
 *
 * The transaction is simulated: the fake `runInTransaction` only commits the
 * recorded operations when the work function resolves, exactly as a real one
 * does. That lets rollback be proven without a database.
 */
describe("TripPricingService — atomic snapshot write", () => {
  let repository: jest.Mocked<TripPricingRepository>;
  let pricingRepository: {
    findByTripId: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let itemRepository: { createMany: jest.Mock; deleteByTripPricingId: jest.Mock };
  let tripService: { findById: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: TripPricingService;

  /** What the transaction has done so far, and whether it committed. */
  let journal: string[];
  let committed: string[] | null;

  beforeEach(() => {
    journal = [];
    committed = null;

    pricingRepository = {
      findByTripId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async () => {
        journal.push("create-parent");
        return buildSnapshot();
      }),
      update: jest.fn().mockImplementation(async () => {
        journal.push("update-parent");
        return buildSnapshot();
      }),
    };

    itemRepository = {
      createMany: jest.fn().mockImplementation(async () => {
        journal.push("create-items");
        return { count: 2 };
      }),
      deleteByTripPricingId: jest.fn().mockImplementation(async () => {
        journal.push("delete-items");
        return { count: 4 };
      }),
    };

    repository = {
      findById: jest.fn(),
      findByTripId: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripPricingRepository>;

    // Commits only on success; a throw discards everything the work recorded.
    (repository.runInTransaction as jest.Mock).mockImplementation(
      async (
        work: (repositories: PricingSnapshotRepositories) => Promise<unknown>,
      ) => {
        journal = [];

        const result = await work({
          pricing: pricingRepository as unknown as TripPricingRepository,
          items: itemRepository as unknown as TripPricingItemRepository,
        });

        committed = [...journal];

        return result;
      },
    );

    tripService = { findById: jest.fn() };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new TripPricingService(
      repository,
      tripService as unknown as TripService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("first calculation", () => {
    it("creates the parent and its items in one transaction", async () => {
      await service.replaceSnapshot(buildCommand());

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
      expect(committed).toEqual(["create-parent", "create-items"]);
    });

    it("stores every field the snapshot carries", async () => {
      await service.replaceSnapshot(buildCommand());

      expect(pricingRepository.create).toHaveBeenCalledWith({
        tripId: TRIP_ID,
        totalPrice: new Prisma.Decimal("484.50"),
        calculatedAt: new Date("2026-08-17T09:00:01.000Z"),
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "2026.1",
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });
    });

    it("leaves currency to the column default, which is EUR", async () => {
      await service.replaceSnapshot(buildCommand());

      expect(pricingRepository.create.mock.calls[0][0]).not.toHaveProperty(
        "currency",
      );
      expect(itemRepository.createMany.mock.calls[0][0][0]).not.toHaveProperty(
        "currency",
      );
    });

    it("attaches every item to the parent it just created", async () => {
      await service.replaceSnapshot(buildCommand());

      const [items] = itemRepository.createMany.mock.calls[0];

      expect(items).toHaveLength(2);
      expect(
        items.every(
          (item: { tripPricingId: string }) => item.tripPricingId === PRICING_ID,
        ),
      ).toBe(true);
    });

    it("writes each item field verbatim, recalculating nothing", async () => {
      await service.replaceSnapshot(buildCommand());

      const [items] = itemRepository.createMany.mock.calls[0];

      expect(items[1]).toEqual({
        tripPricingId: PRICING_ID,
        pricingComponentId: "component-custom",
        customPropertyId: "property-tar",
        description: "TAR",
        amount: new Prisma.Decimal("104.50"),
        calculationOrder: 7,
        quantity: null,
        unitPrice: null,
      });
    });

    it("deletes nothing, because there was nothing to replace", async () => {
      await service.replaceSnapshot(buildCommand());

      expect(itemRepository.deleteByTripPricingId).not.toHaveBeenCalled();
    });

    it("does not re-read the Trip, which the Engine already validated", async () => {
      await service.replaceSnapshot(buildCommand());

      expect(tripService.findById).not.toHaveBeenCalled();
    });
  });

  describe("reprocessing", () => {
    beforeEach(() => {
      pricingRepository.findByTripId.mockResolvedValue(buildSnapshot());
    });

    it("replaces parent and breakdown in one transaction", async () => {
      await service.replaceSnapshot(buildCommand());

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
      expect(committed).toEqual([
        "update-parent",
        "delete-items",
        "create-items",
      ]);
    });

    it("keeps the snapshot's identity rather than creating a new one", async () => {
      const stored = await service.replaceSnapshot(buildCommand());

      expect(pricingRepository.create).not.toHaveBeenCalled();
      expect(pricingRepository.update).toHaveBeenCalledWith(
        PRICING_ID,
        expect.anything(),
      );
      expect(stored.id).toBe(PRICING_ID);
    });

    it("replaces every parent value the calculation produced", async () => {
      await service.replaceSnapshot(
        buildCommand({
          totalPrice: new Prisma.Decimal("475.00"),
          pricingRuleVersion: "2026.2",
        }),
      );

      expect(pricingRepository.update).toHaveBeenCalledWith(PRICING_ID, {
        totalPrice: new Prisma.Decimal("475.00"),
        calculatedAt: new Date("2026-08-17T09:00:01.000Z"),
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "2026.2",
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });
    });

    /**
     * The old breakdown goes before the new one arrives, so a component that no
     * longer applies cannot survive as a stale charge.
     */
    it("discards the old items before inserting the new ones", async () => {
      await service.replaceSnapshot(buildCommand());

      expect(itemRepository.deleteByTripPricingId).toHaveBeenCalledWith(
        PRICING_ID,
      );
      expect(committed!.indexOf("delete-items")).toBeLessThan(
        committed!.indexOf("create-items"),
      );
    });

    it("leaves no stale item when the new breakdown is shorter", async () => {
      await service.replaceSnapshot(
        buildCommand({
          items: [
            {
              pricingComponentId: "component-base",
              customPropertyId: null,
              description: "Antwerp - Rotterdam",
              amount: new Prisma.Decimal("400.00"),
              calculationOrder: 1,
              quantity: null,
              unitPrice: null,
            },
          ],
        }),
      );

      expect(itemRepository.deleteByTripPricingId).toHaveBeenCalledTimes(1);
      expect(itemRepository.createMany.mock.calls[0][0]).toHaveLength(1);
    });

    it("stores a breakdown with no lines at all", async () => {
      await service.replaceSnapshot(buildCommand({ items: [] }));

      expect(itemRepository.createMany).toHaveBeenCalledWith([]);
    });
  });

  /**
   * The invariant total === sum(items) is a property of the transaction. These
   * prove a failure never leaves a half-written snapshot behind.
   */
  describe("atomicity", () => {
    it("rolls back the parent when the items fail", async () => {
      const failure = new Error("item insert failed");
      itemRepository.createMany.mockRejectedValue(failure);

      await expect(service.replaceSnapshot(buildCommand())).rejects.toBe(
        failure,
      );

      // The parent write was attempted, but nothing was committed.
      expect(pricingRepository.create).toHaveBeenCalled();
      expect(committed).toBeNull();
    });

    it("leaves an existing snapshot untouched when a reprocess fails", async () => {
      pricingRepository.findByTripId.mockResolvedValue(buildSnapshot());
      itemRepository.createMany.mockRejectedValue(new Error("boom"));

      await expect(service.replaceSnapshot(buildCommand())).rejects.toThrow();

      expect(committed).toBeNull();
    });

    it("rolls back when discarding the old items fails", async () => {
      pricingRepository.findByTripId.mockResolvedValue(buildSnapshot());
      itemRepository.deleteByTripPricingId.mockRejectedValue(
        new Error("delete failed"),
      );

      await expect(service.replaceSnapshot(buildCommand())).rejects.toThrow();

      expect(itemRepository.createMany).not.toHaveBeenCalled();
      expect(committed).toBeNull();
    });

    it("rolls back when the parent itself fails", async () => {
      pricingRepository.create.mockRejectedValue(new Error("parent failed"));

      await expect(service.replaceSnapshot(buildCommand())).rejects.toThrow();

      expect(itemRepository.createMany).not.toHaveBeenCalled();
      expect(committed).toBeNull();
    });

    it("logs nothing about a snapshot that was never stored", async () => {
      itemRepository.createMany.mockRejectedValue(new Error("boom"));

      await expect(service.replaceSnapshot(buildCommand())).rejects.toThrow();

      expect(logger.log).not.toHaveBeenCalledWith(
        "Pricing snapshot stored",
        expect.anything(),
      );
    });

    it("performs no write outside the transaction", async () => {
      await service.replaceSnapshot(buildCommand());

      // The service's own repository handle is only used to open the
      // transaction; every write goes through the scoped clones.
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  /**
   * Two reprocesses of the same Trip must not interleave.
   *
   * Nothing here locks explicitly, and nothing needs to. The parent row is
   * written FIRST, inside the transaction, before any item is touched — so the
   * second transaction blocks on that row's lock until the first commits, and
   * only then discards and rewrites the items. The parent update is therefore
   * the serialisation point, and these assertions pin the ordering that makes
   * it one.
   *
   * On the create path the UNIQUE(trip_id) index is the guard: two concurrent
   * first calculations cannot both insert, and the loser is translated into a
   * DuplicateTripPricingException rather than escaping as a Prisma error.
   */
  describe("concurrency", () => {
    it("takes the parent lock before touching any item", async () => {
      pricingRepository.findByTripId.mockResolvedValue(buildSnapshot());

      await service.replaceSnapshot(buildCommand());

      expect(committed![0]).toBe("update-parent");
      expect(committed!.indexOf("update-parent")).toBeLessThan(
        committed!.indexOf("delete-items"),
      );
    });

    it("performs every write of a reprocess in a single transaction", async () => {
      pricingRepository.findByTripId.mockResolvedValue(buildSnapshot());

      await service.replaceSnapshot(buildCommand());

      // One transaction, three writes. Nothing escapes it, so a concurrent
      // reprocess can never observe a half-replaced breakdown.
      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
      expect(committed).toHaveLength(3);
    });

    it("re-reads the existing snapshot inside the transaction", async () => {
      // Read outside it, the decision to create-or-update could be made against
      // a state another transaction has already changed.
      pricingRepository.findByTripId.mockResolvedValue(buildSnapshot());

      await service.replaceSnapshot(buildCommand());

      expect(pricingRepository.findByTripId).toHaveBeenCalledWith(TRIP_ID);
      expect(repository.findByTripId).not.toHaveBeenCalled();
    });

    it("translates the unique-index violation that loses a create race", async () => {
      // Two concurrent FIRST calculations: one inserts, the other must not
      // surface a raw Prisma error.
      pricingRepository.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.0.0",
        }),
      );

      await expect(service.replaceSnapshot(buildCommand())).rejects.toThrow(
        /already has a pricing snapshot|already exists/i,
      );
      expect(committed).toBeNull();
    });
  });

  describe("logging", () => {
    it("logs identifiers, a status and counts", async () => {
      await service.replaceSnapshot(buildCommand());

      expect(logger.log).toHaveBeenCalledWith("Pricing snapshot stored", {
        tripPricingId: PRICING_ID,
        tripId: TRIP_ID,
        calculationStatus: PricingCalculationStatus.CALCULATED,
        itemCount: 2,
        wasReplaced: false,
      });
    });

    it("reports a reprocess as a replacement", async () => {
      pricingRepository.findByTripId.mockResolvedValue(buildSnapshot());

      await service.replaceSnapshot(buildCommand());

      expect(logger.log).toHaveBeenCalledWith(
        "Pricing snapshot stored",
        expect.objectContaining({ wasReplaced: true }),
      );
    });

    it("never logs the total or a line amount", async () => {
      await service.replaceSnapshot(
        buildCommand({
          totalPrice: new Prisma.Decimal("1234.56"),
          items: [
            {
              pricingComponentId: "component-base",
              customPropertyId: null,
              description: "Antwerp - Rotterdam",
              amount: new Prisma.Decimal("9876.54"),
              calculationOrder: 1,
              quantity: null,
              unitPrice: null,
            },
          ],
        }),
      );

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("1234.56");
      expect(logged).not.toContain("9876.54");
    });
  });

  it("stores but never calculates", () => {
    const source = TripPricingService.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("plus(");
    expect(source).not.toContain("mul(");
  });
});
