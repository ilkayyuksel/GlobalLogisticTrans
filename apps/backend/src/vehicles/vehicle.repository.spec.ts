import { PrismaService } from "../prisma/prisma.service";
import { VehicleRepository } from "./vehicle.repository";

/**
 * Verifies the exact Prisma calls. A wrong `where` here returns the wrong
 * vehicles silently rather than failing, so the query shape is the assertion.
 */
describe("VehicleRepository", () => {
  let prisma: {
    vehicle: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: VehicleRepository;

  beforeEach(() => {
    prisma = {
      vehicle: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };

    repository = new VehicleRepository(prisma as unknown as PrismaService);
  });

  describe("findPage", () => {
    it("pages and counts inside a single transaction", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.vehicle.count).toHaveBeenCalledTimes(1);
    });

    it("applies no state filter when isActive is omitted", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ licensePlate: "asc" }, { id: "asc" }],
        skip: 0,
        take: 25,
      });
    });

    it.each([true, false])(
      "filters on isActive=%p when supplied",
      async (isActive) => {
        await repository.findPage({ isActive, skip: 0, take: 25 });

        expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { isActive } }),
        );
      },
    );

    it("searches plate, brand and model case-insensitively", async () => {
      await repository.findPage({ search: "volvo", skip: 0, take: 25 });

      expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { licensePlate: { contains: "volvo", mode: "insensitive" } },
              { brand: { contains: "volvo", mode: "insensitive" } },
              { model: { contains: "volvo", mode: "insensitive" } },
            ],
          },
        }),
      );
    });

    it("combines the active filter with the search", async () => {
      await repository.findPage({
        isActive: true,
        search: "abc",
        skip: 0,
        take: 25,
      });

      const where = prisma.vehicle.findMany.mock.calls[0][0].where;

      expect(where.isActive).toBe(true);
      expect(where.OR).toHaveLength(3);
    });

    it("uses the same where clause for the rows and the count", async () => {
      await repository.findPage({
        isActive: true,
        search: "abc",
        skip: 50,
        take: 25,
      });

      expect(prisma.vehicle.findMany.mock.calls[0][0].where).toEqual(
        prisma.vehicle.count.mock.calls[0][0].where,
      );
    });

    it("passes skip and take straight through", async () => {
      await repository.findPage({ skip: 50, take: 10 });

      expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 10 }),
      );
    });
  });

  describe("findById", () => {
    it("looks up by primary key", async () => {
      await repository.findById("vehicle-id");

      expect(prisma.vehicle.findUnique).toHaveBeenCalledWith({
        where: { id: "vehicle-id" },
      });
    });
  });

  describe("uniqueness lookups", () => {
    it("restricts the plate search to active vehicles", async () => {
      await repository.findActiveByLicensePlate("1-ABC-123");

      expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
        where: { licensePlate: "1-ABC-123", isActive: true },
      });
    });

    it("excludes the vehicle being edited from the plate search", async () => {
      await repository.findActiveByLicensePlate("1-ABC-123", "self-id");

      expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
        where: {
          licensePlate: "1-ABC-123",
          isActive: true,
          id: { not: "self-id" },
        },
      });
    });

    it("restricts the colour search to active vehicles", async () => {
      await repository.findActiveByDisplayColor("#2563eb");

      expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
        where: { displayColor: "#2563eb", isActive: true },
      });
    });

    it("excludes the vehicle being edited from the colour search", async () => {
      await repository.findActiveByDisplayColor("#2563eb", "self-id");

      expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
        where: {
          displayColor: "#2563eb",
          isActive: true,
          id: { not: "self-id" },
        },
      });
    });
  });

  describe("writes", () => {
    it("creates with the supplied data", async () => {
      await repository.create({
        licensePlate: "1-ABC-123",
        displayColor: "#2563eb",
      });

      expect(prisma.vehicle.create).toHaveBeenCalledWith({
        data: { licensePlate: "1-ABC-123", displayColor: "#2563eb" },
      });
    });

    it("updates by primary key", async () => {
      await repository.update("vehicle-id", { brand: "Scania" });

      expect(prisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: "vehicle-id" },
        data: { brand: "Scania" },
      });
    });

    it.each([true, false])(
      "setActive writes only isActive=%p",
      async (isActive) => {
        await repository.setActive("vehicle-id", isActive);

        expect(prisma.vehicle.update).toHaveBeenCalledWith({
          where: { id: "vehicle-id" },
          data: { isActive },
        });
      },
    );
  });

  it("exposes no delete operation, because vehicles are never removed", () => {
    const methods = Object.getOwnPropertyNames(VehicleRepository.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
  });

  it("never queries VehicleAssignment or Maintenance", () => {
    // Those are separate modules; touching them here would couple the domains.
    const source = VehicleRepository.prototype.constructor.toString();

    expect(source).not.toContain("vehicleAssignment");
    expect(source).not.toContain("maintenance");
  });
});
