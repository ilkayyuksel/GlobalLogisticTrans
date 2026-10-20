import { PricingCalculationStatus, TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TarChargeReadRepository } from "./tar-charge-read.repository";

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TRIP = "22222222-2222-4222-8222-222222222222";
const DAY = new Date("2026-09-07T00:00:00.000Z");

/**
 * The reads behind "has this TAR-nummer already been charged today?".
 *
 * A wrong `where` here silently charges twice or silently charges nothing, and
 * neither shows up as an error — so the query SHAPE is the assertion. WHO holds
 * the charge from what is read is `tar-charge-holders.spec.ts`; the same reads
 * against a real database are `tar-charge-read.repository.db.spec.ts`.
 */
describe("TarChargeReadRepository", () => {
  let prisma: { tripPricingItem: { findMany: jest.Mock }; trip: { findMany: jest.Mock } };
  let repository: TarChargeReadRepository;

  beforeEach(() => {
    prisma = {
      tripPricingItem: { findMany: jest.fn().mockResolvedValue([]) },
      trip: { findMany: jest.fn().mockResolvedValue([]) },
    };

    repository = new TarChargeReadRepository(prisma as unknown as PrismaService);
  });

  const ask = () =>
    repository.hasBeenChargedToday({ tripId: TRIP_ID, planningDate: DAY, tarNummer: "TAR123" });

  /** Held by these Trips, CLOSED, priced in this order. */
  function holders(...tripIds: string[]) {
    prisma.tripPricingItem.findMany.mockResolvedValue(
      tripIds.map((tripId, index) => ({
        tripPricing: {
          tripId,
          calculatedAt: new Date(DAY.getTime() + index * 1000),
          trip: { status: TripStatus.CLOSED },
        },
      })),
    );
  }

  const where = () => prisma.tripPricingItem.findMany.mock.calls[0][0].where;

  /** The whole rule of what counts as a charge, in one `where`. */
  it("reads the AUTOMATIC TAR lines of that number and day, of snapshots that may count", async () => {
    await ask();

    expect(prisma.tripPricingItem.findMany).toHaveBeenCalledWith({
      where: {
        isAutomatic: true,
        tripPricing: {
          calculationStatus: { not: PricingCalculationStatus.FAILED },
          trip: {
            status: { notIn: [TripStatus.DELETED, TripStatus.CANCELLED] },
            planningDate: DAY,
            tarNummer: { equals: "TAR123", mode: "insensitive" },
          },
        },
      },
      select: {
        tripPricing: {
          select: { tripId: true, calculatedAt: true, trip: { select: { status: true } } },
        },
      },
    });
  });

  /** A manual TAR has no mark: it is never read as the day's charge. */
  it("never reads a manual TAR line", async () => {
    await ask();

    expect(where().isAutomatic).toBe(true);
  });

  it("answers true when another Trip holds the charge", async () => {
    holders(OTHER_TRIP);

    expect(await ask()).toBe(true);
  });

  it("answers false when nobody, or only the Trip itself, holds it", async () => {
    expect(await ask()).toBe(false);

    holders(TRIP_ID);
    expect(await ask()).toBe(false);
  });

  describe("which snapshots are disregarded", () => {
    const statusFilter = () => where().tripPricing.trip.status.notIn;

    it("a DELETED or CANCELLED Trip's", async () => {
      await ask();

      expect(statusFilter()).toEqual([TripStatus.DELETED, TripStatus.CANCELLED]);
    });

    it("a FAILED snapshot", async () => {
      await ask();

      expect(where().tripPricing.calculationStatus).toEqual({ not: PricingCalculationStatus.FAILED });
    });

    /** A reopened Trip still holds its charge — until a later CLOSED one replaces it. */
    it("never a reopened Trip's, by its status alone", async () => {
      await ask();

      expect(statusFilter()).not.toContain(TripStatus.OPEN);
    });
  });

  it("names the Trips holding an automatic TAR among those given, asking nothing for none", async () => {
    prisma.tripPricingItem.findMany.mockResolvedValue([{ tripPricing: { tripId: TRIP_ID } }]);

    expect(await repository.findTripsHoldingAutomaticTar([])).toEqual(new Set());
    expect(prisma.tripPricingItem.findMany).not.toHaveBeenCalled();

    expect(await repository.findTripsHoldingAutomaticTar([TRIP_ID, OTHER_TRIP])).toEqual(new Set([TRIP_ID]));
    expect(prisma.tripPricingItem.findMany).toHaveBeenCalledWith({
      where: { isAutomatic: true, tripPricing: { tripId: { in: [TRIP_ID, OTHER_TRIP] } } },
      select: { tripPricing: { select: { tripId: true } } },
    });
  });

  it("names the other CLOSED Trips stating the number that day, in a stable order", async () => {
    prisma.trip.findMany.mockResolvedValue([{ id: OTHER_TRIP }]);

    expect(await repository.findClosedTripsStating({ tarNummer: "TAR123", planningDate: DAY }, TRIP_ID)).toEqual([
      OTHER_TRIP,
    ]);
    expect(prisma.trip.findMany).toHaveBeenCalledWith({
      where: {
        id: { not: TRIP_ID },
        status: TripStatus.CLOSED,
        planningDate: DAY,
        tarNummer: { equals: "TAR123", mode: "insensitive" },
      },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  });

  /** Read-only by construction: the Engine must not be able to write here. */
  it("offers no way to write", () => {
    expect(repository).not.toHaveProperty("create");
    expect(repository).not.toHaveProperty("update");
    expect(repository).not.toHaveProperty("delete");
  });
});
