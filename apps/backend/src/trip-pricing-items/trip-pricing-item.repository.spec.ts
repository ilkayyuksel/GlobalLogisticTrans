import { PrismaService } from "../prisma/prisma.service";
import { TripPricingItemRepository } from "./trip-pricing-item.repository";

/**
 * Verifies the exact Prisma calls. A wrong `where` or a wrong `orderBy` here
 * returns a breakdown in the wrong sequence silently rather than failing, so
 * the query shape is the assertion.
 */
describe("TripPricingItemRepository", () => {
  let prisma: {
    tripPricingItem: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    pricingComponent: { findUnique: jest.Mock };
  };
  let repository: TripPricingItemRepository;

  beforeEach(() => {
    prisma = {
      tripPricingItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      pricingComponent: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    repository = new TripPricingItemRepository(
      prisma as unknown as PrismaService,
    );
  });

  describe("findById", () => {
    it("looks up by primary key", async () => {
      await repository.findById("item-1");

      expect(prisma.tripPricingItem.findUnique).toHaveBeenCalledWith({
        where: { id: "item-1" },
        include: { pricingComponent: { select: { code: true } } },
      });
    });
  });

  describe("findByTripPricingId", () => {
    it("returns the breakdown in calculation order with a stable tie-break", async () => {
      await repository.findByTripPricingId("pricing-1");

      expect(prisma.tripPricingItem.findMany).toHaveBeenCalledWith({
        where: { tripPricingId: "pricing-1" },
        // The component's code travels with the line.
        include: { pricingComponent: { select: { code: true } } },
        // calculation_order is not unique, so id keeps the sequence stable.
        orderBy: [{ calculationOrder: "asc" }, { id: "asc" }],
      });
    });

    it("never pages, because a breakdown is only correct when whole", async () => {
      await repository.findByTripPricingId("pricing-1");

      const query = prisma.tripPricingItem.findMany.mock.calls[0][0];

      expect(query).not.toHaveProperty("skip");
      expect(query).not.toHaveProperty("take");
    });
  });

  describe("writes", () => {
    it("updates by primary key", async () => {
      await repository.update("item-1", { notes: "checked" });

      expect(prisma.tripPricingItem.update).toHaveBeenCalledWith({
        where: { id: "item-1" },
        data: { notes: "checked" },
        // The updated line comes back classified, like every other read.
        include: { pricingComponent: { select: { code: true } } },
      });
    });
  });

  it("exposes no single-item delete, only the reprocess bulk operations", () => {
    // An individual item is never removed. `deleteByTripPricingId` and
    // `createMany` exist solely as the two halves of the Pricing Engine's
    // atomic snapshot replacement, and neither is reachable over REST.
    const methods = Object.getOwnPropertyNames(
      TripPricingItemRepository.prototype,
    );

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
    expect(methods).not.toContain("replace");

    expect(methods).toContain("deleteByTripPricingId");
    expect(methods).toContain("createMany");
  });

  it("never writes to the snapshot, the Trip or the component catalog", () => {
    const source = TripPricingItemRepository.prototype.constructor.toString();

    expect(source).not.toContain("prisma.tripPricing.");
    expect(source).not.toContain("prisma.trip.");
    expect(source).not.toContain("pricingComponent.update");
    expect(source).not.toContain("customProperty.update");
  });

  it("performs no arithmetic — it stores what it is given", () => {
    const source = TripPricingItemRepository.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("aggregate");
    expect(source).not.toContain("_sum");
  });
});
