import { PrismaService } from "../prisma/prisma.service";
import { CustomPropertyRepository } from "./custom-property.repository";

/**
 * Verifies the exact Prisma calls. A wrong `where` here returns the wrong
 * configuration silently rather than failing, so the query shape is the
 * assertion.
 */
describe("CustomPropertyRepository", () => {
  let prisma: {
    customProperty: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: CustomPropertyRepository;

  beforeEach(() => {
    prisma = {
      customProperty: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };

    repository = new CustomPropertyRepository(
      prisma as unknown as PrismaService,
    );
  });

  describe("runInTransaction", () => {
    it("hands the callback a repository, never a Prisma client", async () => {
      prisma.$transaction.mockImplementation(
        (work: (client: unknown) => Promise<unknown>) =>
          work(prisma as unknown as PrismaService),
      );

      let received: unknown;
      await repository.runInTransaction(async (transactional) => {
        received = transactional;
        return null;
      });

      expect(received).toBeInstanceOf(CustomPropertyRepository);
    });
  });

  describe("findPage", () => {
    it("pages and counts inside a single transaction", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.customProperty.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.customProperty.count).toHaveBeenCalledTimes(1);
    });

    it("orders by display order and applies no filter by default", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.customProperty.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        skip: 0,
        take: 25,
      });
    });

    it.each([true, false])(
      "filters on isActive=%p when supplied",
      async (isActive) => {
        await repository.findPage({ isActive, skip: 0, take: 25 });

        expect(prisma.customProperty.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { isActive } }),
        );
      },
    );

    it("searches name and description case-insensitively", async () => {
      await repository.findPage({ search: "niklaas", skip: 0, take: 25 });

      expect(prisma.customProperty.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: "niklaas", mode: "insensitive" } },
              { description: { contains: "niklaas", mode: "insensitive" } },
            ],
          },
        }),
      );
    });

    it("uses the same where clause for the rows and the count", async () => {
      await repository.findPage({
        isActive: true,
        search: "tar",
        skip: 50,
        take: 25,
      });

      expect(prisma.customProperty.findMany.mock.calls[0][0].where).toEqual(
        prisma.customProperty.count.mock.calls[0][0].where,
      );
    });

    it("passes skip and take straight through", async () => {
      await repository.findPage({ skip: 50, take: 10 });

      expect(prisma.customProperty.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 10 }),
      );
    });
  });

  describe("findById", () => {
    it("looks up by primary key", async () => {
      await repository.findById("property-1");

      expect(prisma.customProperty.findUnique).toHaveBeenCalledWith({
        where: { id: "property-1" },
      });
    });
  });

  describe("findActiveByName", () => {
    it("restricts the search to active properties", async () => {
      await repository.findActiveByName("TAR");

      expect(prisma.customProperty.findFirst).toHaveBeenCalledWith({
        where: { name: "TAR", isActive: true },
      });
    });

    it("excludes the property being edited", async () => {
      await repository.findActiveByName("TAR", "self");

      expect(prisma.customProperty.findFirst).toHaveBeenCalledWith({
        where: { name: "TAR", isActive: true, id: { not: "self" } },
      });
    });
  });

  describe("findHighestDisplayOrder", () => {
    it("selects the highest order across active and inactive rows", async () => {
      prisma.customProperty.findFirst.mockResolvedValue({ displayOrder: 7 });

      const highest = await repository.findHighestDisplayOrder();

      expect(prisma.customProperty.findFirst).toHaveBeenCalledWith({
        orderBy: { displayOrder: "desc" },
        select: { displayOrder: true },
      });
      expect(highest).toBe(7);
    });

    it("returns null when the table is empty", async () => {
      prisma.customProperty.findFirst.mockResolvedValue(null);

      expect(await repository.findHighestDisplayOrder()).toBeNull();
    });
  });

  describe("writes", () => {
    it("creates with the supplied data", async () => {
      await repository.create({ name: "TAR", displayOrder: 1 });

      expect(prisma.customProperty.create).toHaveBeenCalledWith({
        data: { name: "TAR", displayOrder: 1 },
      });
    });

    it("updates by primary key", async () => {
      await repository.update("property-1", { color: "#ffffff" });

      expect(prisma.customProperty.update).toHaveBeenCalledWith({
        where: { id: "property-1" },
        data: { color: "#ffffff" },
      });
    });

    it.each([true, false])(
      "setActive writes only isActive=%p",
      async (isActive) => {
        await repository.setActive("property-1", isActive);

        expect(prisma.customProperty.update).toHaveBeenCalledWith({
          where: { id: "property-1" },
          data: { isActive },
        });
      },
    );
  });

  it("exposes no delete operation, because properties are never removed", () => {
    const methods = Object.getOwnPropertyNames(
      CustomPropertyRepository.prototype,
    );

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
  });

  it("never touches Trip or pricing tables", () => {
    // Trip assignment and pricing results belong to other domains.
    const source = CustomPropertyRepository.prototype.constructor.toString();

    expect(source).not.toContain("tripCustomProperty");
    expect(source).not.toContain("tripPricingItem");
  });
});
