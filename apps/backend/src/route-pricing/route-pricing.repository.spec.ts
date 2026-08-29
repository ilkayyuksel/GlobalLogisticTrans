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

  /**
   * ── THE DEPARTURE IS MATCHED, NOT COMPARED ────────────────────────────────
   * The destination narrows the search in SQL; the DEPARTURE is a terminal and
   * is decided by the shared terminal rule, because one quay is written two
   * ways — `PSA Quay 869` on a collection order, `Quay 869` on a delivery — and
   * both spellings exist in the configuration. Neither side is rewritten.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("findActiveByRoute", () => {
    function candidates(...departures: string[]): void {
      prisma.routePricing.findMany.mockResolvedValue(
        departures.map((departure, index) => ({
          id: `route-${index}`,
          departure,
          destination: "Dourges",
          isActive: true,
        })),
      );
    }

    it("narrows by destination and active state in SQL", async () => {
      await repository.findActiveByRoute("Antwerp", "Rotterdam");

      expect(prisma.routePricing.findMany).toHaveBeenCalledWith({
        where: { destination: "Rotterdam", isActive: true },
        orderBy: { id: "asc" },
      });
    });

    /** The departure must NOT be an SQL equality, or a spelling would miss. */
    it("does not constrain the departure in SQL", async () => {
      await repository.findActiveByRoute("PSA Quay 869", "Dourges");

      const [call] = prisma.routePricing.findMany.mock.calls;

      expect(call[0].where).not.toHaveProperty("departure");
    });

    it("excludes the record being edited", async () => {
      await repository.findActiveByRoute("Antwerp", "Rotterdam", "self");

      expect(prisma.routePricing.findMany).toHaveBeenCalledWith({
        where: {
          destination: "Rotterdam",
          isActive: true,
          id: { not: "self" },
        },
        orderBy: { id: "asc" },
      });
    });

    it.each([
      ["PSA Quay 869", "Quay 869"],
      ["Quay 869", "PSA Quay 869"],
      ["Quay 869", "Quay 869"],
      ["PSA Quay 869", "PSA Quay 869"],
      ["psa quay 869", "Quay 869"],
      ["PSA   Quay 869", "Quay 869"],
      ["  Quay 869  ", "PSA Quay 869"],
    ])("matches a Trip on %j against configuration on %j", async (
      tripTerminal,
      configured,
    ) => {
      candidates(configured);

      const found = await repository.findActiveByRoute(tripTerminal, "Dourges");

      expect(found?.departure).toBe(configured);
    });

    it.each([
      ["Quay 869", "Quay 913"],
      ["PSA Quay 869", "PSA Antwerp"],
      ["PSA Quay 869", "Antwerp PSA Quay 913"],
      ["PSA Antwerp", "Antwerp"],
    ])("does not match %j against %j", async (tripTerminal, configured) => {
      candidates(configured);

      expect(
        await repository.findActiveByRoute(tripTerminal, "Dourges"),
      ).toBeNull();
    });

    it("answers null when nothing is configured to that destination", async () => {
      candidates();

      expect(
        await repository.findActiveByRoute("Quay 869", "Dourges"),
      ).toBeNull();
    });

    /** Deterministic: the same call cannot return two different rows. */
    it("takes the first matching row in a stable order", async () => {
      candidates("Quay 869", "PSA Quay 869");

      expect(
        (await repository.findActiveByRoute("Quay 869", "Dourges"))?.id,
      ).toBe("route-0");
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
