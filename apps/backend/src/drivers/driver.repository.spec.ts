import { PrismaService } from "../prisma/prisma.service";
import { DriverRepository } from "./driver.repository";

/**
 * Verifies the exact Prisma calls. A wrong `where` here returns the wrong
 * drivers silently rather than failing, so the query shape is the assertion.
 */
describe("DriverRepository", () => {
  let prisma: {
    driver: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: DriverRepository;

  beforeEach(() => {
    prisma = {
      driver: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      // The real client resolves an array of the queued promises.
      $transaction: jest.fn().mockImplementation((operations: unknown[]) => {
        void operations;
        return Promise.resolve([[], 0]);
      }),
    };

    repository = new DriverRepository(prisma as unknown as PrismaService);
  });

  describe("findPage", () => {
    it("pages and counts inside a single transaction", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.driver.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.driver.count).toHaveBeenCalledTimes(1);
    });

    it("applies no state filter when isActive is omitted", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.driver.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: 0,
        take: 25,
      });
    });

    it.each([true, false])("filters on isActive=%p when supplied", async (isActive) => {
      await repository.findPage({ isActive, skip: 0, take: 25 });

      expect(prisma.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive } }),
      );
    });

    it("searches the name case-insensitively", async () => {
      await repository.findPage({ search: "peeters", skip: 0, take: 25 });

      expect(prisma.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: "peeters", mode: "insensitive" } },
        }),
      );
    });

    it("uses the same where clause for the rows and the count", async () => {
      await repository.findPage({ isActive: true, search: "jan", skip: 50, take: 25 });

      const rowsWhere = prisma.driver.findMany.mock.calls[0][0].where;
      const countWhere = prisma.driver.count.mock.calls[0][0].where;

      expect(rowsWhere).toEqual(countWhere);
    });

    it("passes skip and take straight through", async () => {
      await repository.findPage({ skip: 50, take: 10 });

      expect(prisma.driver.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 10 }),
      );
    });
  });

  describe("findById", () => {
    it("looks up by primary key", async () => {
      await repository.findById("driver-id");

      expect(prisma.driver.findUnique).toHaveBeenCalledWith({
        where: { id: "driver-id" },
      });
    });
  });

  describe("findActiveByLicenceNumber", () => {
    it("restricts the search to active drivers", async () => {
      await repository.findActiveByLicenceNumber("B-123");

      expect(prisma.driver.findFirst).toHaveBeenCalledWith({
        where: { licenceNumber: "B-123", isActive: true },
      });
    });

    it("excludes the driver being edited", async () => {
      await repository.findActiveByLicenceNumber("B-123", "self-id");

      expect(prisma.driver.findFirst).toHaveBeenCalledWith({
        where: {
          licenceNumber: "B-123",
          isActive: true,
          id: { not: "self-id" },
        },
      });
    });
  });

  describe("writes", () => {
    it("creates with the supplied data", async () => {
      await repository.create({ name: "Jan Peeters", licenceNumber: null });

      expect(prisma.driver.create).toHaveBeenCalledWith({
        data: { name: "Jan Peeters", licenceNumber: null },
      });
    });

    it("updates by primary key", async () => {
      await repository.update("driver-id", { name: "New Name" });

      expect(prisma.driver.update).toHaveBeenCalledWith({
        where: { id: "driver-id" },
        data: { name: "New Name" },
      });
    });

    it.each([true, false])("setActive writes only isActive=%p", async (isActive) => {
      await repository.setActive("driver-id", isActive);

      expect(prisma.driver.update).toHaveBeenCalledWith({
        where: { id: "driver-id" },
        data: { isActive },
      });
    });
  });

  it("exposes no delete operation, because drivers are never removed", () => {
    const methods = Object.getOwnPropertyNames(DriverRepository.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
  });
});
