import { PricingCalculationStatus, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TripPricingRepository } from "./trip-pricing.repository";

/**
 * Verifies the exact Prisma calls. A wrong `where` here returns the wrong
 * snapshot silently rather than failing, so the query shape is the assertion.
 */
describe("TripPricingRepository", () => {
  let prisma: {
    tripPricing: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    tripPricingRouteLeg: { deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: TripPricingRepository;

  beforeEach(() => {
    prisma = {
      tripPricing: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tripPricingRouteLeg: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Runs the read against the same client, as a transaction would.
      $transaction: jest.fn((work: (client: unknown) => unknown) => work(prisma)),
    };

    repository = new TripPricingRepository(prisma as unknown as PrismaService);
  });

  describe("findById", () => {
    it("looks up by primary key", async () => {
      await repository.findById("pricing-1");

      expect(prisma.tripPricing.findUnique).toHaveBeenCalledWith({
        where: { id: "pricing-1" },
      });
    });

    it("returns null when there is no snapshot", async () => {
      expect(await repository.findById("pricing-1")).toBeNull();
    });
  });

  describe("findByTripId", () => {
    it("uses the unique trip_id index, so at most one row can match", async () => {
      await repository.findByTripId("trip-1");

      expect(prisma.tripPricing.findUnique).toHaveBeenCalledWith({
        where: { tripId: "trip-1" },
      });
    });

    it("returns null when the Trip has no snapshot", async () => {
      expect(await repository.findByTripId("trip-1")).toBeNull();
    });
  });

  /*
   * The guard against an older calculation landing last IS the condition on
   * `calculated_at` in the WHERE clause: Postgres re-checks it against the row
   * as a concurrent writer left it.
   */
  /*
   * ── A CURRENT PRICE BELONGS TO A CLOSED TRIP ──────────────────────────────
   * The guard is the Trip's status in the WHERE clause: a reopened, cancelled
   * or deleted Trip's snapshot stays stored and is simply not found here.
   */
  describe("the current reads", () => {
    it("reads one Trip's snapshot only while the Trip is CLOSED", async () => {
      await repository.findCurrentByTripId("trip-1");

      expect(prisma.tripPricing.findFirst).toHaveBeenCalledWith({
        where: { tripId: "trip-1", trip: { status: "CLOSED" } },
      });
    });

    it("reads many Trips' snapshots only for CLOSED Trips", async () => {
      await repository.findCurrentByTripIds(["trip-1", "trip-2"]);

      expect(prisma.tripPricing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tripId: { in: ["trip-1", "trip-2"] }, trip: { status: "CLOSED" } },
        }),
      );
    });

    /** The header, its lines and its route as one calculation, never two halves. */
    it("reads snapshots with their lines and route in one REPEATABLE READ transaction", async () => {
      await repository.findCurrentByTripIds(["trip-1"]);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
      expect(prisma.tripPricing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            items: expect.any(Object),
            routeLegs: { orderBy: { legPosition: "asc" } },
          }),
        }),
      );
    });
  });

  describe("replaceRouteLegs", () => {
    const LEG = {
      legPosition: null,
      isPricedLeg: true,
      routePricingId: "route-1",
      departure: "Quay 869",
      destination: "Ghlin",
      matchMethod: "EXACT" as const,
    };

    it("replaces every leg of the snapshot", async () => {
      await repository.replaceRouteLegs("pricing-1", [LEG]);

      expect(prisma.tripPricingRouteLeg.deleteMany).toHaveBeenCalledWith({
        where: { tripPricingId: "pricing-1" },
      });
      expect(prisma.tripPricingRouteLeg.createMany).toHaveBeenCalledWith({
        data: [{ ...LEG, tripPricingId: "pricing-1" }],
      });
    });

    /** No match: the old legs go, and nothing claims a route. */
    it("leaves no leg when nothing matched", async () => {
      await repository.replaceRouteLegs("pricing-1", []);

      expect(prisma.tripPricingRouteLeg.deleteMany).toHaveBeenCalled();
      expect(prisma.tripPricingRouteLeg.createMany).not.toHaveBeenCalled();
    });

    /* The Engine must still find a reopened Trip's snapshot to replace it. */
    it("leaves the Engine's own read unfiltered", async () => {
      await repository.findByTripId("trip-1");

      expect(prisma.tripPricing.findUnique).toHaveBeenCalledWith({
        where: { tripId: "trip-1" },
      });
    });
  });

  describe("updateUnlessNewerStored", () => {
    const READ_AT = new Date("2026-08-17T09:00:01.000Z");

    it("writes only while the stored snapshot is not newer", async () => {
      await repository.updateUnlessNewerStored("pricing-1", {
        calculatedAt: READ_AT,
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });

      expect(prisma.tripPricing.updateMany).toHaveBeenCalledWith({
        where: { id: "pricing-1", calculatedAt: { lte: READ_AT } },
        data: {
          calculatedAt: READ_AT,
          calculationStatus: PricingCalculationStatus.CALCULATED,
        },
      });
    });

    it("answers with the row it wrote", async () => {
      prisma.tripPricing.findUnique.mockResolvedValue({ id: "pricing-1" });

      await expect(
        repository.updateUnlessNewerStored("pricing-1", { calculatedAt: READ_AT }),
      ).resolves.toEqual({ id: "pricing-1" });
    });

    it("answers null when a newer snapshot is stored", async () => {
      prisma.tripPricing.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        repository.updateUnlessNewerStored("pricing-1", { calculatedAt: READ_AT }),
      ).resolves.toBeNull();
      expect(prisma.tripPricing.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("writes", () => {
    it("creates with the supplied data, deriving nothing", async () => {
      const data = {
        tripId: "trip-1",
        totalPrice: 482.35,
        calculatedAt: new Date("2026-08-11T09:15:00.000Z"),
        pricingEngineVersion: "1.4.0",
        pricingRuleVersion: "2026.08",
        calculationStatus: PricingCalculationStatus.CALCULATED,
        notes: null,
      };

      await repository.create(data);

      expect(prisma.tripPricing.create).toHaveBeenCalledWith({ data });
    });

    it("never sets a currency, so the column default applies", async () => {
      await repository.create({
        tripId: "trip-1",
        totalPrice: 1,
        calculatedAt: new Date(),
        pricingEngineVersion: "1.0.0",
        pricingRuleVersion: "2026.08",
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });

      expect(prisma.tripPricing.create.mock.calls[0][0].data).not.toHaveProperty(
        "currency",
      );
    });

    it("updates by primary key", async () => {
      await repository.update("pricing-1", {
        calculationStatus: PricingCalculationStatus.MANUAL_OVERRIDE,
      });

      expect(prisma.tripPricing.update).toHaveBeenCalledWith({
        where: { id: "pricing-1" },
        data: { calculationStatus: PricingCalculationStatus.MANUAL_OVERRIDE },
      });
    });
  });

  it("exposes no delete operation, because snapshots are never removed", () => {
    const methods = Object.getOwnPropertyNames(TripPricingRepository.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
  });

  it("never touches the trip, item or pricing-configuration tables", () => {
    // Trip status belongs to TripService; items, route pricing and components
    // belong to other modules and later phases.
    const source = TripPricingRepository.prototype.constructor.toString();

    expect(source).not.toContain("prisma.trip.");
    expect(source).not.toContain("tripPricingItem");
    expect(source).not.toContain("routePricing");
    /*
     * `pricingComponent` appears once, as an `include` on the export read: a
     * line's CODE is what says it is a toll rather than a fuel surcharge, and
     * it is loaded with the line rather than looked up per row. It is a
     * projection of a foreign key this table already owns, not a write to the
     * pricing-configuration domain.
     */
    expect(source).not.toMatch(/prisma\.pricingComponent\./);
  });

  it("performs no arithmetic — it stores what it is given", () => {
    const source = TripPricingRepository.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("aggregate");
    expect(source).not.toContain("_sum");
  });
});
