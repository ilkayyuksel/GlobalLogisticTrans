import { PrismaService } from "../prisma/prisma.service";
import { TripCustomPropertyRepository } from "./trip-custom-property.repository";

const TRIP_ID = "trip-1";
const PROPERTY_ID = "property-1";

/**
 * Verifies the exact Prisma calls. A missing `include` here returns an
 * assignment with no property attached, and a wrong `orderBy` returns the
 * breakdown in the wrong sequence — both silent, so the query shape is the
 * assertion.
 */
describe("TripCustomPropertyRepository", () => {
  let prisma: {
    tripCustomProperty: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };
  let repository: TripCustomPropertyRepository;

  beforeEach(() => {
    prisma = {
      tripCustomProperty: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    repository = new TripCustomPropertyRepository(
      prisma as unknown as PrismaService,
    );
  });

  describe("findByTripId", () => {
    it("loads the assignments of one Trip with their properties", async () => {
      await repository.findByTripId(TRIP_ID);

      expect(prisma.tripCustomProperty.findMany).toHaveBeenCalledWith({
        where: { tripId: TRIP_ID },
        include: { customProperty: true },
        orderBy: [{ customProperty: { displayOrder: "asc" } }, { id: "asc" }],
      });
    });

    it("orders by the property's display order, not by assignment time", async () => {
      await repository.findByTripId(TRIP_ID);

      const { orderBy } = prisma.tripCustomProperty.findMany.mock.calls[0][0];

      expect(orderBy[0]).toEqual({ customProperty: { displayOrder: "asc" } });
      expect(JSON.stringify(orderBy)).not.toContain("createdAt");
    });

    it("never pages, because a Trip's properties are read as a whole", async () => {
      await repository.findByTripId(TRIP_ID);

      const query = prisma.tripCustomProperty.findMany.mock.calls[0][0];

      expect(query).not.toHaveProperty("skip");
      expect(query).not.toHaveProperty("take");
    });
  });

  describe("findById", () => {
    it("looks up by primary key, with the property", async () => {
      await repository.findById("assignment-1");

      expect(prisma.tripCustomProperty.findUnique).toHaveBeenCalledWith({
        where: { id: "assignment-1" },
        include: { customProperty: true },
      });
    });

    it("returns null when the assignment does not exist", async () => {
      expect(await repository.findById("assignment-1")).toBeNull();
    });
  });

  describe("findByTripAndProperty", () => {
    it("uses the unique pair index, so at most one row can match", async () => {
      await repository.findByTripAndProperty(TRIP_ID, PROPERTY_ID);

      expect(prisma.tripCustomProperty.findUnique).toHaveBeenCalledWith({
        where: {
          tripId_customPropertyId: {
            tripId: TRIP_ID,
            customPropertyId: PROPERTY_ID,
          },
        },
        include: { customProperty: true },
      });
    });
  });

  describe("writes", () => {
    it("creates with the two identifiers and returns the property", async () => {
      await repository.create({
        tripId: TRIP_ID,
        customPropertyId: PROPERTY_ID,
      });

      expect(prisma.tripCustomProperty.create).toHaveBeenCalledWith({
        data: { tripId: TRIP_ID, customPropertyId: PROPERTY_ID },
        include: { customProperty: true },
      });
    });

    it("never stamps its own timestamp, so the column default applies", async () => {
      await repository.create({
        tripId: TRIP_ID,
        customPropertyId: PROPERTY_ID,
      });

      const { data } = prisma.tripCustomProperty.create.mock.calls[0][0];

      expect(data).not.toHaveProperty("createdAt");
    });

    it("deletes by primary key and returns what was removed", async () => {
      await repository.delete("assignment-1");

      expect(prisma.tripCustomProperty.delete).toHaveBeenCalledWith({
        where: { id: "assignment-1" },
        include: { customProperty: true },
      });
    });
  });

  it("exposes a delete, because an assignment is a current fact", () => {
    // The only module in the system where a physical delete is correct: the
    // pricing consequence is frozen in trip_pricing_item, not in this row.
    const methods = Object.getOwnPropertyNames(
      TripCustomPropertyRepository.prototype,
    );

    expect(methods).toContain("delete");
    expect(methods).not.toContain("deleteMany");
  });

  it("never writes to the Trip, the property or any pricing table", () => {
    const source =
      TripCustomPropertyRepository.prototype.constructor.toString();

    expect(source).not.toContain("prisma.trip.");
    expect(source).not.toContain("prisma.customProperty.");
    expect(source).not.toContain("tripPricing");
    expect(source).not.toContain("tripPricingItem");
  });
});
