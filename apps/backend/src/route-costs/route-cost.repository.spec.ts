import { PrismaService } from "../prisma/prisma.service";
import { RouteCostRepository } from "./route-cost.repository";

const COMPONENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

const EXPECTED_INCLUDE = {
  pricingComponent: { select: { id: true, code: true, name: true } },
};

/**
 * Verifies the exact Prisma calls. A wrong `where` here returns the wrong route
 * cost silently rather than failing, so the query shape is the assertion.
 */
describe("RouteCostRepository", () => {
  let prisma: {
    routeCost: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    pricingComponent: { findUnique: jest.Mock };
    customProperty: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: RouteCostRepository;

  beforeEach(() => {
    prisma = {
      routeCost: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      pricingComponent: { findUnique: jest.fn().mockResolvedValue(null) },
      customProperty: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };

    repository = new RouteCostRepository(prisma as unknown as PrismaService);
  });

  describe("findPage", () => {
    it("pages and counts inside a single transaction", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.routeCost.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.routeCost.count).toHaveBeenCalledTimes(1);
    });

    it("orders by route and applies no filter by default", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.routeCost.findMany).toHaveBeenCalledWith({
        where: {},
        include: EXPECTED_INCLUDE,
        orderBy: [{ departure: "asc" }, { destination: "asc" }, { id: "asc" }],
        skip: 0,
        take: 25,
      });
    });

    it.each([true, false])(
      "filters on isActive=%p when supplied",
      async (isActive) => {
        await repository.findPage({ isActive, skip: 0, take: 25 });

        expect(prisma.routeCost.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { isActive } }),
        );
      },
    );

    it("filters to a single pricing component when supplied", async () => {
      await repository.findPage({
        pricingComponentId: COMPONENT_ID,
        skip: 0,
        take: 25,
      });

      expect(prisma.routeCost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pricingComponentId: COMPONENT_ID },
        }),
      );
    });

    it("searches departure and destination case-insensitively", async () => {
      await repository.findPage({ search: "rotterdam", skip: 0, take: 25 });

      expect(prisma.routeCost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { departure: { contains: "rotterdam", mode: "insensitive" } },
              { destination: { contains: "rotterdam", mode: "insensitive" } },
            ],
          },
        }),
      );
    });

    it("combines every filter", async () => {
      await repository.findPage({
        isActive: true,
        pricingComponentId: COMPONENT_ID,
        search: "antwerp",
        skip: 0,
        take: 25,
      });

      const where = prisma.routeCost.findMany.mock.calls[0][0].where;

      expect(where.isActive).toBe(true);
      expect(where.pricingComponentId).toBe(COMPONENT_ID);
      expect(where.OR).toHaveLength(2);
    });

    it("uses the same where clause for the rows and the count", async () => {
      await repository.findPage({
        isActive: true,
        search: "antwerp",
        skip: 50,
        take: 25,
      });

      expect(prisma.routeCost.findMany.mock.calls[0][0].where).toEqual(
        prisma.routeCost.count.mock.calls[0][0].where,
      );
    });

    it("does not join the component for the count, which needs no rows", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.routeCost.count.mock.calls[0][0]).not.toHaveProperty(
        "include",
      );
    });

    it("passes skip and take straight through", async () => {
      await repository.findPage({ skip: 50, take: 10 });

      expect(prisma.routeCost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 10 }),
      );
    });
  });

  describe("findById", () => {
    it("looks up by primary key and joins the component", async () => {
      await repository.findById("cost-1");

      expect(prisma.routeCost.findUnique).toHaveBeenCalledWith({
        where: { id: "cost-1" },
        include: EXPECTED_INCLUDE,
      });
    });
  });

  /**
   * ── THE DEPARTURE IS MATCHED, NOT COMPARED ────────────────────────────────
   * Destination and component narrow the search in SQL; the departure is a
   * TERMINAL and is decided by the shared rule, so the two spellings of one
   * quay cannot be configured twice and cannot miss each other on lookup.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("findActiveByRouteAndComponent", () => {
    function candidates(...departures: string[]): void {
      prisma.routeCost.findMany.mockResolvedValue(
        departures.map((departure, index) => ({
          id: `cost-${index}`,
          departure,
          destination: "Dourges",
          pricingComponentId: COMPONENT_ID,
          isActive: true,
        })),
      );
    }

    it("narrows by destination, component and active state in SQL", async () => {
      await repository.findActiveByRouteAndComponent(
        "Antwerp Terminal",
        "Rotterdam",
        COMPONENT_ID,
      );

      expect(prisma.routeCost.findMany).toHaveBeenCalledWith({
        where: {
          destination: "Rotterdam",
          pricingComponentId: COMPONENT_ID,
          isActive: true,
        },
        orderBy: { id: "asc" },
      });
    });

    it("does not constrain the departure in SQL", async () => {
      await repository.findActiveByRouteAndComponent(
        "PSA Quay 869",
        "Dourges",
        COMPONENT_ID,
      );

      const [call] = prisma.routeCost.findMany.mock.calls;

      expect(call[0].where).not.toHaveProperty("departure");
    });

    it("excludes the record being edited", async () => {
      await repository.findActiveByRouteAndComponent(
        "Antwerp Terminal",
        "Rotterdam",
        COMPONENT_ID,
        "self",
      );

      expect(prisma.routeCost.findMany).toHaveBeenCalledWith({
        where: {
          destination: "Rotterdam",
          pricingComponentId: COMPONENT_ID,
          isActive: true,
          id: { not: "self" },
        },
        orderBy: { id: "asc" },
      });
    });

    it.each([
      ["PSA Quay 869", "Quay 869"],
      ["Quay 869", "PSA Quay 869"],
      ["psa quay 869", "PSA   Quay 869"],
    ])("finds a cost configured on %j when asked for %j", async (
      tripTerminal,
      configured,
    ) => {
      candidates(configured);

      expect(
        (
          await repository.findActiveByRouteAndComponent(
            tripTerminal,
            "Dourges",
            COMPONENT_ID,
          )
        )?.departure,
      ).toBe(configured);
    });

    it("does not match a genuinely different terminal", async () => {
      candidates("Quay 913");

      expect(
        await repository.findActiveByRouteAndComponent(
          "PSA Quay 869",
          "Dourges",
          COMPONENT_ID,
        ),
      ).toBeNull();
    });
  });

  /**
   * ── THE LOOKUP A TOLL DEPENDS ON ──────────────────────────────────────────
   * Every active cost on one route, whatever component it prices. This is the
   * call the Toll and Tunnel calculators are fed from, so a departure compared
   * as text rather than matched as a terminal would mean a Trip on a configured
   * route quietly not being charged.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("findActiveByRoute", () => {
    function candidates(...departures: string[]): void {
      prisma.routeCost.findMany.mockResolvedValue(
        departures.map((departure, index) => ({
          id: `cost-${index}`,
          departure,
          destination: "Dourges",
          isActive: true,
          pricingComponent: { code: "TOLL", displayOrder: 5 },
        })),
      );
    }

    it("narrows by destination and active state in SQL", async () => {
      await repository.findActiveByRoute("PSA Quay 869", "Dourges");

      const [call] = prisma.routeCost.findMany.mock.calls;

      expect(call[0].where).toEqual({ destination: "Dourges", isActive: true });
      expect(call[0].where).not.toHaveProperty("departure");
    });

    it.each([
      ["PSA Quay 869", "Quay 869"],
      ["Quay 869", "PSA Quay 869"],
      ["Quay 869", "Quay 869"],
      ["PSA Quay 869", "PSA Quay 869"],
      ["psa quay 869", "Quay 869"],
      ["PSA   Quay 869", "  Quay 869 "],
    ])(
      "returns the cost on %j for a Trip on %j",
      async (tripTerminal, configured) => {
        candidates(configured);

        const found = await repository.findActiveByRoute(
          tripTerminal,
          "Dourges",
        );

        expect(found).toHaveLength(1);
        expect(found[0].departure).toBe(configured);
      },
    );

    it.each([
      ["PSA Quay 869", "Quay 913"],
      ["PSA Quay 869", "PSA Antwerp"],
      ["Quay 869", "Antwerp PSA Quay 913"],
    ])("returns nothing for %j against %j", async (tripTerminal, configured) => {
      candidates(configured);

      expect(
        await repository.findActiveByRoute(tripTerminal, "Dourges"),
      ).toEqual([]);
    });

    /** Both spellings on one route are both returned — neither is discarded. */
    it("returns every matching spelling", async () => {
      candidates("Quay 869", "PSA Quay 869");

      expect(
        await repository.findActiveByRoute("Quay 869", "Dourges"),
      ).toHaveLength(2);
    });

    it("keeps the component ordering the query asked for", async () => {
      await repository.findActiveByRoute("Quay 869", "Dourges");

      const [call] = prisma.routeCost.findMany.mock.calls;

      expect(call[0].orderBy).toEqual([
        { pricingComponent: { displayOrder: "asc" } },
        { id: "asc" },
      ]);
    });
  });

  describe("findPricingComponent", () => {
    it("selects identity only, never the whole component", async () => {
      await repository.findPricingComponent(COMPONENT_ID);

      expect(prisma.pricingComponent.findUnique).toHaveBeenCalledWith({
        where: { id: COMPONENT_ID },
        select: { id: true, code: true, name: true },
      });
    });
  });

  describe("isRoutePricedComponent", () => {
    it("asks whether any custom property links to the component", async () => {
      await repository.isRoutePricedComponent(COMPONENT_ID);

      expect(prisma.customProperty.findFirst).toHaveBeenCalledWith({
        where: { pricingComponentId: COMPONENT_ID },
        select: { id: true },
      });
    });

    it("counts inactive properties too, so a lifecycle change cannot flip it", async () => {
      const where = () => prisma.customProperty.findFirst.mock.calls[0][0].where;

      await repository.isRoutePricedComponent(COMPONENT_ID);

      expect(where()).not.toHaveProperty("isActive");
    });

    it("reports true when a property links and false when none does", async () => {
      prisma.customProperty.findFirst.mockResolvedValue({ id: "property-1" });
      expect(await repository.isRoutePricedComponent(COMPONENT_ID)).toBe(true);

      prisma.customProperty.findFirst.mockResolvedValue(null);
      expect(await repository.isRoutePricedComponent(COMPONENT_ID)).toBe(false);
    });
  });

  describe("writes", () => {
    it("creates with the supplied data and returns the component", async () => {
      await repository.create({
        departure: "Antwerp Terminal",
        destination: "Rotterdam",
        pricingComponentId: COMPONENT_ID,
        amount: 24.5,
      });

      expect(prisma.routeCost.create).toHaveBeenCalledWith({
        data: {
          departure: "Antwerp Terminal",
          destination: "Rotterdam",
          pricingComponentId: COMPONENT_ID,
          amount: 24.5,
        },
        include: EXPECTED_INCLUDE,
      });
    });

    it("updates by primary key", async () => {
      await repository.update("cost-1", { amount: 30 });

      expect(prisma.routeCost.update).toHaveBeenCalledWith({
        where: { id: "cost-1" },
        data: { amount: 30 },
        include: EXPECTED_INCLUDE,
      });
    });

    it.each([true, false])(
      "setActive writes only isActive=%p",
      async (isActive) => {
        await repository.setActive("cost-1", isActive);

        expect(prisma.routeCost.update).toHaveBeenCalledWith({
          where: { id: "cost-1" },
          data: { isActive },
          include: EXPECTED_INCLUDE,
        });
      },
    );
  });

  it("exposes no delete operation, because records are never removed", () => {
    const methods = Object.getOwnPropertyNames(RouteCostRepository.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
  });

  it("never touches Trip or TripPricing tables", () => {
    // Pricing results belong to the Pricing Domain, not to this configuration.
    const source = RouteCostRepository.prototype.constructor.toString();

    expect(source).not.toContain("trip");
    expect(source).not.toContain("tripPricing");
  });
});
