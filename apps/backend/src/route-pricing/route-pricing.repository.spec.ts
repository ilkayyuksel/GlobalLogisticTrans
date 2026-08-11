import { PrismaService } from "../prisma/prisma.service";
import { RoutePricingRepository } from "./route-pricing.repository";

/**
 * Verifies the exact Prisma calls. A wrong `where` here returns the wrong
 * pricing configuration silently rather than failing, so the query shape is the
 * assertion.
 */
describe("RoutePricingRepository", () => {
  let prisma: {
    routePricing: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: RoutePricingRepository;

  beforeEach(() => {
    prisma = {
      routePricing: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };

    repository = new RoutePricingRepository(prisma as unknown as PrismaService);
  });

  describe("findPage", () => {
    it("pages and counts inside a single transaction", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.routePricing.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.routePricing.count).toHaveBeenCalledTimes(1);
    });

    it("orders by route name and applies no filter by default", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.routePricing.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ routeName: "asc" }, { id: "asc" }],
        skip: 0,
        take: 25,
      });
    });

    it.each([true, false])(
      "filters on isActive=%p when supplied",
      async (isActive) => {
        await repository.findPage({ isActive, skip: 0, take: 25 });

        expect(prisma.routePricing.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { isActive } }),
        );
      },
    );

    it("searches route name, departure and destination case-insensitively", async () => {
      await repository.findPage({ search: "rotterdam", skip: 0, take: 25 });

      expect(prisma.routePricing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { routeName: { contains: "rotterdam", mode: "insensitive" } },
              { departure: { contains: "rotterdam", mode: "insensitive" } },
              { destination: { contains: "rotterdam", mode: "insensitive" } },
            ],
          },
        }),
      );
    });

    it("combines the active filter with the search", async () => {
      await repository.findPage({
        isActive: true,
        search: "antwerp",
        skip: 0,
        take: 25,
      });

      const where = prisma.routePricing.findMany.mock.calls[0][0].where;

      expect(where.isActive).toBe(true);
      expect(where.OR).toHaveLength(3);
    });

    it("uses the same where clause for the rows and the count", async () => {
      await repository.findPage({
        isActive: true,
        search: "antwerp",
        skip: 50,
        take: 25,
      });

      expect(prisma.routePricing.findMany.mock.calls[0][0].where).toEqual(
        prisma.routePricing.count.mock.calls[0][0].where,
      );
    });

    it("passes skip and take straight through", async () => {
      await repository.findPage({ skip: 50, take: 10 });

      expect(prisma.routePricing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 10 }),
      );
    });
  });

  describe("findById", () => {
    it("looks up by primary key", async () => {
      await repository.findById("route-1");

      expect(prisma.routePricing.findUnique).toHaveBeenCalledWith({
        where: { id: "route-1" },
      });
    });
  });

  describe("findActiveByRoute", () => {
    it("restricts the search to active records", async () => {
      await repository.findActiveByRoute("Antwerp", "Rotterdam");

      expect(prisma.routePricing.findFirst).toHaveBeenCalledWith({
        where: {
          departure: "Antwerp",
          destination: "Rotterdam",
          isActive: true,
        },
      });
    });

    it("excludes the record being edited", async () => {
      await repository.findActiveByRoute("Antwerp", "Rotterdam", "self");

      expect(prisma.routePricing.findFirst).toHaveBeenCalledWith({
        where: {
          departure: "Antwerp",
          destination: "Rotterdam",
          isActive: true,
          id: { not: "self" },
        },
      });
    });
  });

  describe("writes", () => {
    it("creates with the supplied data", async () => {
      await repository.create({
        routeName: "Antwerp - Rotterdam",
        departure: "Antwerp",
        destination: "Rotterdam",
        basePrice: 380,
      });

      expect(prisma.routePricing.create).toHaveBeenCalledWith({
        data: {
          routeName: "Antwerp - Rotterdam",
          departure: "Antwerp",
          destination: "Rotterdam",
          basePrice: 380,
        },
      });
    });

    it("updates by primary key", async () => {
      await repository.update("route-1", { basePrice: 400 });

      expect(prisma.routePricing.update).toHaveBeenCalledWith({
        where: { id: "route-1" },
        data: { basePrice: 400 },
      });
    });

    it.each([true, false])(
      "setActive writes only isActive=%p",
      async (isActive) => {
        await repository.setActive("route-1", isActive);

        expect(prisma.routePricing.update).toHaveBeenCalledWith({
          where: { id: "route-1" },
          data: { isActive },
        });
      },
    );
  });

  it("exposes no delete operation, because records are never removed", () => {
    const methods = Object.getOwnPropertyNames(RoutePricingRepository.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
  });

  it("never touches Trip or TripPricing tables", () => {
    // Pricing results belong to the Pricing Domain, not to this configuration.
    const source = RoutePricingRepository.prototype.constructor.toString();

    expect(source).not.toContain("trip");
    expect(source).not.toContain("tripPricing");
  });
});
