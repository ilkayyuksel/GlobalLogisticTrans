import { PrismaService } from "../prisma/prisma.service";
import { toUtcDate } from "../common/dates";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";

const FROM = toUtcDate("2026-03-01");
const TO = toUtcDate("2026-06-30");

/**
 * Verifies the exact Prisma calls. Period arithmetic expressed as a wrong
 * `where` returns the wrong assignments silently rather than failing, so the
 * query shape is the assertion.
 */
describe("VehicleAssignmentRepository", () => {
  let prisma: {
    vehicleAssignment: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: VehicleAssignmentRepository;

  beforeEach(() => {
    prisma = {
      vehicleAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };

    repository = new VehicleAssignmentRepository(
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

      expect(received).toBeInstanceOf(VehicleAssignmentRepository);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("findPage", () => {
    it("pages and counts inside a single transaction", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.vehicleAssignment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.vehicleAssignment.count).toHaveBeenCalledTimes(1);
    });

    it("orders by newest period first", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.vehicleAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ validFrom: "desc" }, { id: "asc" }],
          skip: 0,
          take: 25,
        }),
      );
    });

    it("applies no conditions when nothing is filtered", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.vehicleAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it.each([
      ["vehicleId", { vehicleId: "vehicle-1" }],
      ["driverId", { driverId: "driver-1" }],
    ])("filters by %s", async (_label, filter) => {
      await repository.findPage({ ...filter, skip: 0, take: 25 });

      expect(prisma.vehicleAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining(filter) }),
      );
    });

    it("restricts to assignments in effect on a day when activeOn is set", async () => {
      await repository.findPage({ activeOn: FROM, skip: 0, take: 25 });

      const where = prisma.vehicleAssignment.findMany.mock.calls[0][0].where;

      expect(where.AND).toContainEqual({
        validFrom: { lte: FROM },
        OR: [{ validTo: null }, { validTo: { gte: FROM } }],
      });
    });

    it("selects periods overlapping a date range", async () => {
      await repository.findPage({ from: FROM, to: TO, skip: 0, take: 25 });

      const where = prisma.vehicleAssignment.findMany.mock.calls[0][0].where;

      // Starts on or before the range ends...
      expect(where.AND).toContainEqual({ validFrom: { lte: TO } });
      // ...and has not ended before the range starts.
      expect(where.AND).toContainEqual({
        OR: [{ validTo: null }, { validTo: { gte: FROM } }],
      });
    });

    it("uses the same where clause for the rows and the count", async () => {
      await repository.findPage({
        vehicleId: "vehicle-1",
        from: FROM,
        skip: 0,
        take: 25,
      });

      expect(prisma.vehicleAssignment.findMany.mock.calls[0][0].where).toEqual(
        prisma.vehicleAssignment.count.mock.calls[0][0].where,
      );
    });
  });

  describe("findOverlapping", () => {
    it("bounds both sides for a closed candidate period", async () => {
      await repository.findOverlapping({
        vehicleId: "vehicle-1",
        validFrom: FROM,
        validTo: TO,
      });

      expect(prisma.vehicleAssignment.findMany).toHaveBeenCalledWith({
        where: {
          vehicleId: "vehicle-1",
          AND: [
            { validFrom: { lte: TO } },
            { OR: [{ validTo: null }, { validTo: { gte: FROM } }] },
          ],
        },
        orderBy: { validFrom: "asc" },
      });
    });

    it("omits the upper bound for an open-ended candidate", async () => {
      await repository.findOverlapping({
        driverId: "driver-1",
        validFrom: FROM,
        validTo: null,
      });

      const where = prisma.vehicleAssignment.findMany.mock.calls[0][0].where;

      expect(where.AND).toEqual([
        { OR: [{ validTo: null }, { validTo: { gte: FROM } }] },
      ]);
    });

    it("excludes a nominated assignment", async () => {
      await repository.findOverlapping({
        vehicleId: "vehicle-1",
        validFrom: FROM,
        validTo: null,
        excludeAssignmentId: "self",
      });

      expect(prisma.vehicleAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: "self" } }),
        }),
      );
    });
  });

  describe("open-ended lookups", () => {
    it("finds the open assignment of a vehicle", async () => {
      await repository.findOpenEndedForVehicle("vehicle-1");

      expect(prisma.vehicleAssignment.findFirst).toHaveBeenCalledWith({
        where: { vehicleId: "vehicle-1", validTo: null },
      });
    });

    it("finds the open assignment of a driver", async () => {
      await repository.findOpenEndedForDriver("driver-1");

      expect(prisma.vehicleAssignment.findFirst).toHaveBeenCalledWith({
        where: { driverId: "driver-1", validTo: null },
      });
    });
  });

  describe("current lookups", () => {
    it("resolves the vehicle assignment in effect on a day", async () => {
      await repository.findCurrentForVehicle("vehicle-1", FROM);

      expect(prisma.vehicleAssignment.findFirst).toHaveBeenCalledWith({
        where: {
          vehicleId: "vehicle-1",
          validFrom: { lte: FROM },
          OR: [{ validTo: null }, { validTo: { gte: FROM } }],
        },
        orderBy: { validFrom: "desc" },
      });
    });

    it("resolves the driver assignment in effect on a day", async () => {
      await repository.findCurrentForDriver("driver-1", FROM);

      expect(prisma.vehicleAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ driverId: "driver-1" }),
        }),
      );
    });
  });

  describe("writes", () => {
    it("creates with the supplied data", async () => {
      await repository.create({
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        validFrom: FROM,
        validTo: null,
      });

      expect(prisma.vehicleAssignment.create).toHaveBeenCalledWith({
        data: {
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          validFrom: FROM,
          validTo: null,
        },
      });
    });

    it("updates by primary key", async () => {
      await repository.update("assignment-1", { notes: "corrected" });

      expect(prisma.vehicleAssignment.update).toHaveBeenCalledWith({
        where: { id: "assignment-1" },
        data: { notes: "corrected" },
      });
    });

    it("setValidTo writes only the end date", async () => {
      await repository.setValidTo("assignment-1", TO);

      expect(prisma.vehicleAssignment.update).toHaveBeenCalledWith({
        where: { id: "assignment-1" },
        data: { validTo: TO },
      });
    });
  });

  it("exposes no delete operation, because assignments are never removed", () => {
    const methods = Object.getOwnPropertyNames(
      VehicleAssignmentRepository.prototype,
    );

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
  });
});
