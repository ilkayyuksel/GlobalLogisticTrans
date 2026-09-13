import { toUtcDate } from "../common/dates";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarEventRepository } from "./calendar-event.repository";

/**
 * What the Agenda asks of the database, held to its contract. The selection and
 * the ordering of a range happen in PostgreSQL; the runtime check against the
 * real database proves the results.
 */

const ID = "7b1f4c2e-2d7a-4a55-9a51-0f3c2f1f9d10";

function prismaDouble(deletedCount = 1) {
  const prisma = {
    calendarEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: deletedCount }),
    },
  };

  return {
    prisma,
    repository: new CalendarEventRepository(prisma as unknown as PrismaService),
  };
}

describe("CalendarEventRepository", () => {
  describe("a range of days", () => {
    /** Both ends included; the day before and the day after can never match. */
    it("selects by start date, from the first day to the last, both included", async () => {
      const { prisma, repository } = prismaDouble();

      await repository.findForRange(toUtcDate("2026-09-14"), toUtcDate("2026-09-20"));

      expect(prisma.calendarEvent.findMany.mock.calls[0][0].where).toEqual({
        startDate: {
          gte: toUtcDate("2026-09-14"),
          lte: toUtcDate("2026-09-20"),
        },
      });
    });

    it("reads a single day as a range of one", async () => {
      const { prisma, repository } = prismaDouble();

      await repository.findForRange(toUtcDate("2026-09-14"), toUtcDate("2026-09-14"));

      expect(prisma.calendarEvent.findMany.mock.calls[0][0].where).toEqual({
        startDate: {
          gte: toUtcDate("2026-09-14"),
          lte: toUtcDate("2026-09-14"),
        },
      });
    });

    it("lets the database order it: day, start, end, then id", async () => {
      const { prisma, repository } = prismaDouble();

      await repository.findForRange(toUtcDate("2026-09-14"), toUtcDate("2026-09-20"));

      expect(prisma.calendarEvent.findMany.mock.calls[0][0].orderBy).toEqual([
        { startDate: "asc" },
        { startTime: "asc" },
        { endTime: "asc" },
        { id: "asc" },
      ]);
    });
  });

  describe("deleting", () => {
    it("removes the row physically", async () => {
      const { prisma, repository } = prismaDouble();

      await expect(repository.delete(ID)).resolves.toBe(true);
      expect(prisma.calendarEvent.deleteMany).toHaveBeenCalledWith({
        where: { id: ID },
      });
    });

    it("says so when nothing was there to remove", async () => {
      const { repository } = prismaDouble(0);

      await expect(repository.delete(ID)).resolves.toBe(false);
    });
  });
});
