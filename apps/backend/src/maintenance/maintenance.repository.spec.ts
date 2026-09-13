import { MaintenanceStatus } from "@prisma/client";

import { toUtcDate } from "../common/dates";
import { PrismaService } from "../prisma/prisma.service";
import { MaintenanceRepository } from "./maintenance.repository";

/**
 * The two queries this change adds, held to their contract.
 *
 * The selection and the ordering of the Dashboard list happen in PostgreSQL,
 * and the completion is one transaction; these tests pin exactly what is asked
 * of the database. The runtime check against the real database proves the
 * results.
 */

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function prismaDouble(updatedCount = 1) {
  const transaction = {
    maintenance: {
      updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
      findUnique: jest.fn().mockResolvedValue({ id: ID, completions: [] }),
      create: jest.fn(),
    },
    maintenanceCompletion: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const prisma = {
    maintenance: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((work: (tx: typeof transaction) => unknown) =>
      work(transaction),
    ),
  };

  return {
    prisma,
    transaction,
    repository: new MaintenanceRepository(prisma as unknown as PrismaService),
  };
}

const COMPLETION = {
  id: ID,
  expectedPlannedDate: toUtcDate("2026-09-10"),
  completedOn: toUtcDate("2026-09-14"),
  nextMaintenanceDate: toUtcDate("2027-03-14"),
  notes: "Groot onderhoud uitgevoerd.",
  maintenanceType: "Onderhoud",
  description: "Grote beurt",
};

describe("MaintenanceRepository", () => {
  describe("the Dashboard's attention list", () => {
    it("asks for PLANNED records only", async () => {
      const { prisma, repository } = prismaDouble();

      await repository.findAttention(5);

      expect(prisma.maintenance.findMany.mock.calls[0][0].where).toEqual({
        status: MaintenanceStatus.PLANNED,
      });
    });

    /** Ascending date IS the priority: late, then today, then upcoming. */
    it("orders by planned date, then id, and lets the database limit it", async () => {
      const { prisma, repository } = prismaDouble();

      await repository.findAttention(5);

      expect(prisma.maintenance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ maintenanceDate: "asc" }, { id: "asc" }],
          take: 5,
          include: { vehicle: true },
        }),
      );
    });

    it("reads no mileage and no next date to decide anything", async () => {
      const { prisma, repository } = prismaDouble();

      await repository.findAttention(5);

      const query = JSON.stringify(prisma.maintenance.findMany.mock.calls[0][0]);

      expect(query).not.toMatch(/mileage|nextMaintenance/i);
    });
  });

  describe("reading one record", () => {
    it("loads its history with it, oldest cycle first", async () => {
      const { prisma, repository } = prismaDouble();

      await repository.findById(ID);

      expect(prisma.maintenance.findUnique).toHaveBeenCalledWith({
        where: { id: ID },
        include: {
          vehicle: true,
          completions: {
            orderBy: [{ completedOn: "asc" }, { createdAt: "asc" }],
          },
        },
      });
    });
  });

  describe("completing", () => {
    it("plans the SAME record again, if it is still what was read", async () => {
      const { transaction, repository } = prismaDouble();

      await repository.complete(COMPLETION);

      expect(transaction.maintenance.updateMany).toHaveBeenCalledWith({
        where: {
          id: ID,
          status: { in: [MaintenanceStatus.PLANNED, MaintenanceStatus.IN_PROGRESS] },
          maintenanceDate: COMPLETION.expectedPlannedDate,
        },
        data: {
          status: MaintenanceStatus.PLANNED,
          maintenanceDate: COMPLETION.nextMaintenanceDate,
          nextMaintenanceDate: COMPLETION.nextMaintenanceDate,
        },
      });
    });

    it("creates no new maintenance record", async () => {
      const { transaction, repository } = prismaDouble();

      await repository.complete(COMPLETION);

      expect(transaction.maintenance.create).not.toHaveBeenCalled();
    });

    it("appends the cycle that ended to the history", async () => {
      const { transaction, repository } = prismaDouble();

      await repository.complete(COMPLETION);

      expect(transaction.maintenanceCompletion.create).toHaveBeenCalledWith({
        data: {
          maintenanceId: ID,
          plannedDate: COMPLETION.expectedPlannedDate,
          completedOn: COMPLETION.completedOn,
          nextMaintenanceDate: COMPLETION.nextMaintenanceDate,
          notes: "Groot onderhoud uitgevoerd.",
          maintenanceType: "Onderhoud",
          description: "Grote beurt",
        },
      });
    });

    /** Append-only: an earlier cycle is never rewritten. */
    it("never updates or deletes an existing history row", async () => {
      const { transaction, repository } = prismaDouble();

      await repository.complete(COMPLETION);

      expect(transaction.maintenanceCompletion.update).not.toHaveBeenCalled();
      expect(transaction.maintenanceCompletion.updateMany).not.toHaveBeenCalled();
      expect(transaction.maintenanceCompletion.delete).not.toHaveBeenCalled();
      expect(transaction.maintenanceCompletion.deleteMany).not.toHaveBeenCalled();
    });

    it("offers no way to change a history row at all", () => {
      const methods = Object.getOwnPropertyNames(MaintenanceRepository.prototype);

      expect(methods.filter((name) => /completion/i.test(name))).toEqual([]);
      expect(methods.some((name) => /^delete/i.test(name))).toBe(false);
    });

    it("answers with the re-planned record and its history", async () => {
      const { transaction, repository } = prismaDouble();

      const result = await repository.complete(COMPLETION);

      expect(transaction.maintenance.findUnique).toHaveBeenCalledWith({
        where: { id: ID },
        include: {
          vehicle: true,
          completions: {
            orderBy: [{ completedOn: "asc" }, { createdAt: "asc" }],
          },
        },
      });
      expect(result).toEqual({ id: ID, completions: [] });
    });

    /*
     * A second completion racing the first, or an edit in between, finds the
     * record no longer planned for the date that was read. Nothing is written.
     */
    it("writes no history when the record changed meanwhile", async () => {
      const { transaction, repository } = prismaDouble(0);

      const result = await repository.complete(COMPLETION);

      expect(result).toBeNull();
      expect(transaction.maintenanceCompletion.create).not.toHaveBeenCalled();
    });
  });
});
