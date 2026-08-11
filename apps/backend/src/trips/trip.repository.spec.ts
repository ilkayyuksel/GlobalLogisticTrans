import { Prisma, TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TripRepository } from "./trip.repository";

const PLANNING_DATE = new Date("2026-08-17T00:00:00.000Z");
const START_TIME = new Date("1970-01-01T08:00:00.000Z");
const END_TIME = new Date("1970-01-01T12:00:00.000Z");

/**
 * Verifies the exact Prisma calls. A wrong `where` here returns the wrong Trips
 * silently rather than failing, so the query shape is the assertion.
 */
describe("TripRepository", () => {
  let prisma: {
    trip: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    pdfDocument: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: TripRepository;

  beforeEach(() => {
    prisma = {
      trip: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      pdfDocument: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };

    repository = new TripRepository(prisma as unknown as PrismaService);
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

      expect(received).toBeInstanceOf(TripRepository);
    });
  });

  describe("findPage", () => {
    it("pages and counts inside a single transaction", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.trip.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.trip.count).toHaveBeenCalledTimes(1);
    });

    it("orders by planning date descending with a stable tie-break", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ planningDate: "desc" }, { id: "asc" }],
          skip: 0,
          take: 25,
        }),
      );
    });

    it("hides the excluded statuses when no status filter is supplied", async () => {
      await repository.findPage({
        excludeStatuses: [TripStatus.DELETED],
        skip: 0,
        take: 25,
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { notIn: [TripStatus.DELETED] } },
        }),
      );
    });

    it("an explicit status wins over the exclusion, so DELETED stays reachable", async () => {
      await repository.findPage({
        status: TripStatus.DELETED,
        excludeStatuses: [TripStatus.DELETED],
        skip: 0,
        take: 25,
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: TripStatus.DELETED } }),
      );
    });

    it("applies no status clause when neither is supplied", async () => {
      await repository.findPage({ skip: 0, take: 25 });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it("matches an exact planning date", async () => {
      await repository.findPage({
        planningDate: PLANNING_DATE,
        skip: 0,
        take: 25,
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { planningDate: PLANNING_DATE } }),
      );
    });

    it("builds an inclusive range from from/to", async () => {
      const to = new Date("2026-08-23T00:00:00.000Z");

      await repository.findPage({
        planningDateFrom: PLANNING_DATE,
        planningDateTo: to,
        skip: 0,
        take: 25,
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { planningDate: { gte: PLANNING_DATE, lte: to } },
        }),
      );
    });

    it("an exact planning date wins over the range", async () => {
      await repository.findPage({
        planningDate: PLANNING_DATE,
        planningDateFrom: new Date("2020-01-01T00:00:00.000Z"),
        skip: 0,
        take: 25,
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { planningDate: PLANNING_DATE } }),
      );
    });

    it("matches booking number, container number, vehicle and driver exactly", async () => {
      await repository.findPage({
        bookingNumber: "BK-1",
        containerNumber: "MSKU1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        skip: 0,
        take: 25,
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            bookingNumber: "BK-1",
            containerNumber: "MSKU1",
            vehicleId: "vehicle-1",
            driverId: "driver-1",
          },
        }),
      );
    });

    it("matches the route parts exactly", async () => {
      await repository.findPage({
        terminal: "Antwerp Gateway",
        destinationCity: "Bousbecque",
        destinationCountry: "France",
        skip: 0,
        take: 25,
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            terminal: "Antwerp Gateway",
            destinationCity: "Bousbecque",
            destinationCountry: "France",
          },
        }),
      );
    });

    it("searches the transport identifiers case-insensitively", async () => {
      await repository.findPage({ search: "rotterdam", skip: 0, take: 25 });

      const contains = {
        contains: "rotterdam",
        mode: Prisma.QueryMode.insensitive,
      };

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { bookingNumber: contains },
              { containerNumber: contains },
              { terminal: contains },
              { destinationCity: contains },
              { destinationCountry: contains },
            ],
          },
        }),
      );
    });

    it("never searches internal notes, which are for internal communication", async () => {
      await repository.findPage({ search: "anything", skip: 0, take: 25 });

      const where = prisma.trip.findMany.mock.calls[0][0].where;

      expect(JSON.stringify(where)).not.toContain("internalNotes");
    });

    it("uses the same where clause for the rows and the count", async () => {
      await repository.findPage({
        status: TripStatus.OPEN,
        search: "bk",
        planningDate: PLANNING_DATE,
        skip: 50,
        take: 25,
      });

      expect(prisma.trip.findMany.mock.calls[0][0].where).toEqual(
        prisma.trip.count.mock.calls[0][0].where,
      );
    });

    it("passes skip and take straight through", async () => {
      await repository.findPage({ skip: 50, take: 10 });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 10 }),
      );
    });
  });

  describe("findById", () => {
    it("looks up by primary key", async () => {
      await repository.findById("trip-1");

      expect(prisma.trip.findUnique).toHaveBeenCalledWith({
        where: { id: "trip-1" },
      });
    });
  });

  describe("findByBookingNumber", () => {
    it("restricts the search to the holding statuses", async () => {
      await repository.findByBookingNumber({
        bookingNumber: "BK-1",
        statuses: [TripStatus.OPEN, TripStatus.CLOSED],
      });

      expect(prisma.trip.findFirst).toHaveBeenCalledWith({
        where: {
          bookingNumber: "BK-1",
          status: { in: [TripStatus.OPEN, TripStatus.CLOSED] },
        },
      });
    });

    it("excludes the Trip being checked", async () => {
      await repository.findByBookingNumber({
        bookingNumber: "BK-1",
        statuses: [TripStatus.OPEN],
        excludeTripId: "self",
      });

      expect(prisma.trip.findFirst).toHaveBeenCalledWith({
        where: {
          bookingNumber: "BK-1",
          status: { in: [TripStatus.OPEN] },
          id: { not: "self" },
        },
      });
    });
  });

  describe("findVehicleOverlaps", () => {
    it("compares half-open intervals on the same day for the same vehicle", async () => {
      await repository.findVehicleOverlaps({
        vehicleId: "vehicle-1",
        planningDate: PLANNING_DATE,
        startTime: START_TIME,
        endTime: END_TIME,
        statuses: [TripStatus.OPEN, TripStatus.CLOSED],
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith({
        where: {
          vehicleId: "vehicle-1",
          planningDate: PLANNING_DATE,
          status: { in: [TripStatus.OPEN, TripStatus.CLOSED] },
          // Strict comparisons: touching intervals do not collide.
          startTime: { not: null, lt: END_TIME },
          endTime: { not: null, gt: START_TIME },
        },
        orderBy: { startTime: "asc" },
      });
    });

    it("excludes Trips without both times, whose interval is unknown", async () => {
      await repository.findVehicleOverlaps({
        vehicleId: "vehicle-1",
        planningDate: PLANNING_DATE,
        startTime: START_TIME,
        endTime: END_TIME,
        statuses: [TripStatus.OPEN],
      });

      const where = prisma.trip.findMany.mock.calls[0][0].where;

      expect(where.startTime.not).toBeNull();
      expect(where.endTime.not).toBeNull();
    });

    it("excludes the Trip being moved", async () => {
      await repository.findVehicleOverlaps({
        vehicleId: "vehicle-1",
        planningDate: PLANNING_DATE,
        startTime: START_TIME,
        endTime: END_TIME,
        statuses: [TripStatus.OPEN],
        excludeTripId: "self",
      });

      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: "self" } }),
        }),
      );
    });
  });

  describe("pdfDocumentExists", () => {
    it("selects only the id, because nothing else is needed", async () => {
      await repository.pdfDocumentExists("pdf-1");

      expect(prisma.pdfDocument.findUnique).toHaveBeenCalledWith({
        where: { id: "pdf-1" },
        select: { id: true },
      });
    });

    it("reports absence and presence", async () => {
      expect(await repository.pdfDocumentExists("pdf-1")).toBe(false);

      prisma.pdfDocument.findUnique.mockResolvedValue({ id: "pdf-1" });

      expect(await repository.pdfDocumentExists("pdf-1")).toBe(true);
    });
  });

  describe("writes", () => {
    it("creates with the supplied data", async () => {
      await repository.create({
        pdfDocumentId: "pdf-1",
        bookingNumber: "BK-1",
        containerType: "45PH",
        destinationCity: "Bousbecque",
        destinationCountry: "France",
        originalPlanningDate: PLANNING_DATE,
        planningDate: PLANNING_DATE,
      });

      expect(prisma.trip.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ bookingNumber: "BK-1" }),
      });
    });

    it("updates by primary key", async () => {
      await repository.update("trip-1", { containerNumber: "MSKU1" });

      expect(prisma.trip.update).toHaveBeenCalledWith({
        where: { id: "trip-1" },
        data: { containerNumber: "MSKU1" },
      });
    });

    it.each(Object.values(TripStatus))("setStatus writes only %s", async (status) => {
      await repository.setStatus("trip-1", status);

      expect(prisma.trip.update).toHaveBeenCalledWith({
        where: { id: "trip-1" },
        data: { status },
      });
    });
  });

  it("exposes no delete operation, because Trips are never removed", () => {
    const methods = Object.getOwnPropertyNames(TripRepository.prototype);

    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("deleteMany");
    expect(methods).not.toContain("remove");
  });

  it("never touches pricing, history or parser tables", () => {
    // Those domains belong to later phases and to other owners.
    const source = TripRepository.prototype.constructor.toString();

    expect(source).not.toContain("tripPricing");
    expect(source).not.toContain("tripHistory");
    expect(source).not.toContain("parserRun");
    expect(source).not.toContain("parserMetadata");
  });
});
