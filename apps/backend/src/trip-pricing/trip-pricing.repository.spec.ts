import { PricingCalculationStatus } from "@prisma/client";

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
    };
  };
  let repository: TripPricingRepository;

  beforeEach(() => {
    prisma = {
      tripPricing: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
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
