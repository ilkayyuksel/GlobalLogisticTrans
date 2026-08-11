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
      });
    });
  });

  describe("findByTripPricingId", () => {
    it("returns the breakdown in calculation order with a stable tie-break", async () => {
      await repository.findByTripPricingId("pricing-1");

      expect(prisma.tripPricingItem.findMany).toHaveBeenCalledWith({
        where: { tripPricingId: "pricing-1" },
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

  describe("findByCustomProperty", () => {
    it("scopes the search to one snapshot", async () => {
      await repository.findByCustomProperty("pricing-1", "property-1");

      expect(prisma.tripPricingItem.findFirst).toHaveBeenCalledWith({
        where: { tripPricingId: "pricing-1", customPropertyId: "property-1" },
      });
    });
  });

  describe("findPricingComponentById", () => {
    it("selects only the classification fields", async () => {
      await repository.findPricingComponentById("component-1");

      expect(prisma.pricingComponent.findUnique).toHaveBeenCalledWith({
        where: { id: "component-1" },
        select: { id: true, code: true, isActive: true },
      });
    });

    it("returns null when the component does not exist", async () => {
      expect(await repository.findPricingComponentById("component-1")).toBeNull();
    });
  });

  describe("writes", () => {
    it("creates with the supplied data, deriving nothing", async () => {
      const data = {
        tripPricingId: "pricing-1",
        pricingComponentId: "component-1",
        customPropertyId: null,
        description: "Fuel surcharge",
        amount: 57.25,
        calculationOrder: 3,
        quantity: null,
        unitPrice: null,
        notes: null,
      };

      await repository.create(data);

      expect(prisma.tripPricingItem.create).toHaveBeenCalledWith({ data });
    });

    it("never sets a currency, so the column default applies", async () => {
      await repository.create({
        tripPricingId: "pricing-1",
        pricingComponentId: "component-1",
        description: "Toll",
        amount: 12,
        calculationOrder: 5,
      });

      expect(
        prisma.tripPricingItem.create.mock.calls[0][0].data,
      ).not.toHaveProperty("currency");
    });

    it("updates by primary key", async () => {
      await repository.update("item-1", { notes: "checked" });

      expect(prisma.tripPricingItem.update).toHaveBeenCalledWith({
        where: { id: "item-1" },
        data: { notes: "checked" },
      });
    });
  });

  it("exposes no delete or replace operation", () => {
    // Items are never removed, and replacing a whole set is reprocessing.
    const methods = Object.getOwnPropertyNames(
      TripPricingItemRepository.prototype,
    );

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
    expect(methods).not.toContain("replace");
    expect(methods).not.toContain("createMany");
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
