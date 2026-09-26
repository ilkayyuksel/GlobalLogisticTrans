import { PrismaService } from "../prisma/prisma.service";
import {
  RouteConfigurationKind,
  RoutePricingRepository,
} from "./route-pricing.repository";

/** The two scopes a route lookup can mean. See `FindRouteOptions`. */
const NORMAL_ROUTE = { kind: RouteConfigurationKind.NORMAL } as const;
const COMBINATION_ROUTE = { kind: RouteConfigurationKind.COMBINATION } as const;

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
      delete: jest.Mock;
    };
    combinationRouteGroup: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
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
        delete: jest.fn(),
      },
      combinationRouteGroup: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
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

    it("searches without filtering on any state", async () => {
      await repository.findPage({
        search: "antwerp",
        skip: 0,
        take: 25,
      });

      const where = prisma.routePricing.findMany.mock.calls[0][0].where;

      expect(where).not.toHaveProperty("isActive");
      expect(where.OR).toHaveLength(3);
    });

    it("uses the same where clause for the rows and the count", async () => {
      await repository.findPage({
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
  describe("findByRoute", () => {
    function candidates(...departures: string[]): void {
      prisma.routePricing.findMany.mockResolvedValue(
        departures.map((departure, index) => ({
          id: `route-${index}`,
          departure,
          destination: "Dourges",
        })),
      );
    }

    it("narrows by destination in SQL", async () => {
      await repository.findByRoute("Antwerp", "Rotterdam", NORMAL_ROUTE);

      expect(prisma.routePricing.findMany).toHaveBeenCalledWith({
        where: { destination: "Rotterdam", combinationGroupId: null },
        orderBy: { id: "asc" },
      });
    });

    /*
     * ── THE KIND IS PART OF THE IDENTITY ──────────────────────────────────
     * One road may be configured twice: as an ordinary route and as a leg of a
     * Combination. A lookup therefore says which of the two it means, and the
     * scope is applied in SQL — without it a match would be ambiguous rather
     * than merely unfiltered.
     */
    it("looks only at ordinary routes when asked for one", async () => {
      await repository.findByRoute("Antwerp", "Rotterdam", NORMAL_ROUTE);

      const [call] = prisma.routePricing.findMany.mock.calls;

      expect(call[0].where.combinationGroupId).toBeNull();
    });

    it("looks only at Combination legs when asked for one", async () => {
      await repository.findByRoute("Antwerp", "Rotterdam", COMBINATION_ROUTE);

      const [call] = prisma.routePricing.findMany.mock.calls;

      expect(call[0].where.combinationGroupId).toEqual({ not: null });
    });

    /** The departure must NOT be an SQL equality, or a spelling would miss. */
    it("does not constrain the departure in SQL", async () => {
      await repository.findByRoute("PSA Quay 869", "Dourges", NORMAL_ROUTE);

      const [call] = prisma.routePricing.findMany.mock.calls;

      expect(call[0].where).not.toHaveProperty("departure");
    });

    it("excludes the record being edited", async () => {
      await repository.findByRoute("Antwerp", "Rotterdam", {
        kind: RouteConfigurationKind.NORMAL,
        excludeRoutePricingId: "self",
      });

      expect(prisma.routePricing.findMany).toHaveBeenCalledWith({
        where: {
          destination: "Rotterdam",
          combinationGroupId: null,
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

      const found = await repository.findByRoute(
        tripTerminal,
        "Dourges",
        NORMAL_ROUTE,
      );

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
        await repository.findByRoute(tripTerminal, "Dourges", NORMAL_ROUTE),
      ).toBeNull();
    });

    it("answers null when nothing is configured to that destination", async () => {
      candidates();

      expect(
        await repository.findByRoute("Quay 869", "Dourges", NORMAL_ROUTE),
      ).toBeNull();
    });

    /** Deterministic: the same call cannot return two different rows. */
    it("takes the first matching row in a stable order", async () => {
      candidates("Quay 869", "PSA Quay 869");

      expect(
        (await repository.findByRoute("Quay 869", "Dourges", NORMAL_ROUTE))
          ?.id,
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

    it("deletes the row it is given", async () => {
      await repository.delete("route-1");

      expect(prisma.routePricing.delete).toHaveBeenCalledWith({
        where: { id: "route-1" },
      });
    });
  });

  /**
   * ── THE COMBINATION GROUPS ────────────────────────────────────────────────
   * A Combination configuration is a parent row with exactly two legs. The
   * queries that read and write it are asserted for the same reason every other
   * query here is: a wrong `where` or a wrong `orderBy` returns the wrong
   * configuration silently rather than failing.
   */
  describe("Combination route groups", () => {
    it("reads a group by its primary key", async () => {
      await repository.findGroupById("group-1");

      expect(prisma.combinationRouteGroup.findUnique).toHaveBeenCalledWith({
        where: { id: "group-1" },
      });
    });

    /**
     * Ordered by POSITION, never by `created_at`: both legs are written in one
     * transaction and carry the same timestamp, so the timestamp could not tell
     * the outbound from the return.
     */
    it("reads a group's legs in configured order", async () => {
      await repository.findLegsOfGroup("group-1");

      expect(prisma.routePricing.findMany).toHaveBeenCalledWith({
        where: { combinationGroupId: "group-1" },
        orderBy: { combinationLegPosition: "asc" },
      });
    });

    it("lists every group with its legs, each in configured order", async () => {
      await repository.findGroups();

      expect(prisma.combinationRouteGroup.findMany).toHaveBeenCalledWith({
        include: { legs: { orderBy: { combinationLegPosition: "asc" } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
    });

    it("creates a group with no notes by default", async () => {
      await repository.createGroup();

      expect(prisma.combinationRouteGroup.create).toHaveBeenCalledWith({
        data: { notes: null },
      });
    });

    /**
     * ── ONE STATEMENT, NOT THREE ───────────────────────────────────────────
     * The legs reference the group with ON DELETE CASCADE, so removing the group
     * removes them. Deleting the legs first would open a window in which one leg
     * survived alone.
     */
    it("removes a group and lets the cascade take its legs", async () => {
      await repository.deleteGroup("group-1");

      expect(prisma.combinationRouteGroup.delete).toHaveBeenCalledWith({
        where: { id: "group-1" },
      });
      expect(prisma.routePricing.delete).not.toHaveBeenCalled();
    });
  });

  describe("the transaction", () => {
    /**
     * The service never sees a Prisma client: it is handed a repository bound to
     * the transaction, so the layering rule holds while a group row and both its
     * legs commit together.
     */
    it("hands the work a repository, not a client", async () => {
      prisma.$transaction.mockImplementation(
        async (work: (client: unknown) => Promise<unknown>) =>
          work(prisma as never),
      );

      const received = await repository.runInTransaction(
        async (transactional) => transactional,
      );

      expect(received).toBeInstanceOf(RoutePricingRepository);
      expect(received).not.toBe(repository);
    });

    it("returns whatever the work returns", async () => {
      prisma.$transaction.mockImplementation(
        async (work: (client: unknown) => Promise<unknown>) =>
          work(prisma as never),
      );

      expect(
        await repository.runInTransaction(async () => "committed"),
      ).toBe("committed");
    });
  });

  /**
   * ── A ROUTE CAN NOW BE REMOVED ────────────────────────────────────────────
   * This used to assert the opposite: records were kept forever so that pricing
   * derived from them stayed explainable. It stays explainable either way — a
   * snapshot holds the amounts it was priced with and reads no configuration
   * again — while the kept row gave the screen a second state and a route that
   * looked configured while charging nothing.
   */
  it("exposes a delete, and no soft-delete beside it", () => {
    const methods = Object.getOwnPropertyNames(RoutePricingRepository.prototype);

    expect(methods).toContain("delete");
    expect(methods).not.toContain("setActive");
  });
  it("never touches Trip or TripPricing tables", () => {
    // Pricing results belong to the Pricing Domain, not to this configuration.
    const source = RoutePricingRepository.prototype.constructor.toString();

    expect(source).not.toContain("trip");
    expect(source).not.toContain("tripPricing");
  });
});
