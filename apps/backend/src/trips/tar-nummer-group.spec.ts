import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * A TAR-nummer belongs to ONE Trip.
 *
 * ── WHAT THIS FILE USED TO ASSERT, AND WHY IT NO LONGER DOES ────────────────
 * It used to prove the opposite: that a group carried a single TAR-nummer, that
 * editing it on one leg copied it to the others, and that grouping carried an
 * existing number onto the Trips joining it. That rule is withdrawn. Every Trip
 * now states its own number, and nothing copies it anywhere — not by
 * `tripGroupId`, not by Combination, not by container, booking, planning date
 * or DELIVERY/COLLECTION direction.
 *
 * So the tests below are all of the same shape: an operator writes a number on
 * one Trip, and the other Trip is exactly as it was. Two legs may legitimately
 * hold two different numbers, one may hold a number while the other holds
 * none, and clearing either changes only the row it was cleared on.
 *
 * ── WHAT IS NOT AFFECTED ────────────────────────────────────────────────────
 * Group FORMATION is untouched: `createGroup` still writes `tripGroupId` and
 * still refuses the cases it always refused. And the pricing ALLOCATION is
 * untouched — a genuine Combination still charges TAR at most once, on the
 * delivery leg. That lives in the pricing resolver and is tested there; the
 * only thing that changed for it is that it reads each Trip's own column.
 * ────────────────────────────────────────────────────────────────────────────
 */

const GROUP_ID = "5c2f4d8e-1a3b-4c6d-8e9f-0a1b2c3d4e5f";
const TRIP_A = "11111111-1111-4111-8111-111111111111";
const TRIP_B = "22222222-2222-4222-8222-222222222222";

type Row = Trip;

/** A complete Trip row: the response mapper reads every column. */
function row(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    pdfDocumentId: null,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: false,
    direction: null,
    bookingNumber: "BK-2026-0042",
    containerNumber: null,
    containerType: "45PH",
    terminal: null,
    destinationCity: "Bousbecque",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-17T00:00:00.000Z"),
    planningDate: new Date("2026-08-17T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildService(stored: Row[]) {
  const repository = {
    findById: jest.fn((id: string) =>
      Promise.resolve(stored.find((trip) => trip.id === id) ?? null),
    ),
    findManyByIds: jest.fn((ids: readonly string[]) =>
      Promise.resolve(stored.filter((trip) => ids.includes(trip.id))),
    ),
    createTripGroup: jest.fn().mockResolvedValue({ id: GROUP_ID }),
    assignToGroup: jest.fn((ids: readonly string[], groupId: string) => {
      for (const trip of stored) {
        if (ids.includes(trip.id)) {
          trip.tripGroupId = groupId;
        }
      }

      return Promise.resolve(ids.length);
    }),
    update: jest.fn((id: string, data: Record<string, unknown>) => {
      const trip = stored.find((candidate) => candidate.id === id) as Row;

      if (data.tarNummer !== undefined) {
        trip.tarNummer = data.tarNummer as string | null;
      }

      return Promise.resolve(trip);
    }),
    // Assigned below: it hands the work THIS repository, so it cannot be part
    // of the object literal that defines it.
    runInTransaction: jest.fn(),
  };

  repository.runInTransaction.mockImplementation(
    (work: (repo: unknown) => Promise<unknown>) => work(repository),
  );

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const recalculation = { recalculate: jest.fn() };

  const service = new TripService(
    repository as unknown as TripRepository,
    {} as never,
    {} as never,
    {
      resolveOne: jest.fn().mockResolvedValue({}),
      resolveMany: jest.fn().mockResolvedValue(new Map()),
    } as never,
    { applyToNewTrip: jest.fn(), applyToUpdatedTrip: jest.fn() } as never,
    recalculation as never,
    { publish: jest.fn() } as never,
    logger as unknown as AppLoggerService,
  );

  return { service, repository, logger, recalculation };
}

/** Two Trips already sharing one group — the case that used to propagate. */
function groupedPair(overrides: [Partial<Trip>, Partial<Trip>?] = [{}]): Row[] {
  return [
    row(TRIP_A, { tripGroupId: GROUP_ID, ...overrides[0] }),
    row(TRIP_B, { tripGroupId: GROUP_ID, ...(overrides[1] ?? {}) }),
  ];
}

describe("a TAR-nummer is per Trip", () => {
  /**
   * The method that did the copying is gone from the repository entirely, so
   * no call site can quietly reintroduce it.
   */
  it("no longer exists as a repository operation", () => {
    const methods = Object.getOwnPropertyNames(TripRepository.prototype);

    expect(methods).not.toContain("shareTarNummerWithinGroup");
  });

  describe("editing one leg of a group", () => {
    it("writes the number on that Trip only", async () => {
      const stored = groupedPair();
      const { service } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: "TAR123" });

      expect(stored[0].tarNummer).toBe("TAR123");
      expect(stored[1].tarNummer).toBeNull();
    });

    /** The two legs may legitimately state different numbers. */
    it("lets the two legs hold different numbers", async () => {
      const stored = groupedPair();
      const { service } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: "TAR-A" });
      await service.update(TRIP_B, { tarNummer: "TAR-B" });

      expect(stored[0].tarNummer).toBe("TAR-A");
      expect(stored[1].tarNummer).toBe("TAR-B");
    });

    it("lets one leg state a number while the other states none", async () => {
      const stored = groupedPair();
      const { service } = buildService(stored);

      await service.update(TRIP_B, { tarNummer: "TAR-B" });

      expect(stored[0].tarNummer).toBeNull();
      expect(stored[1].tarNummer).toBe("TAR-B");
    });

    /*
     * Clearing used to empty the whole group, which was the most destructive
     * half of the old rule: removing a number on one leg silently removed a
     * different operator's number on another.
     */
    it("clears only the Trip it was cleared on", async () => {
      const stored = groupedPair([{ tarNummer: "TAR-A" }, { tarNummer: "TAR-B" }]);
      const { service } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: null });

      expect(stored[0].tarNummer).toBeNull();
      expect(stored[1].tarNummer).toBe("TAR-B");
    });

    it("clears the other leg without touching the first", async () => {
      const stored = groupedPair([{ tarNummer: "TAR-A" }, { tarNummer: "TAR-B" }]);
      const { service } = buildService(stored);

      await service.update(TRIP_B, { tarNummer: null });

      expect(stored[0].tarNummer).toBe("TAR-A");
      expect(stored[1].tarNummer).toBeNull();
    });

    /** Whitespace is still absence; that semantic is unchanged. */
    it("treats a blank entry as absence, still on that Trip only", async () => {
      const stored = groupedPair([{ tarNummer: "TAR-A" }, { tarNummer: "TAR-B" }]);
      const { service } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: null });

      expect(stored[0].tarNummer).toBeNull();
      expect(stored[1].tarNummer).toBe("TAR-B");
    });

    /**
     * No group read and no group write. The edit is one plain update, so a
     * grouped Trip costs exactly what an ungrouped one costs.
     */
    it("runs no group transaction", async () => {
      const stored = groupedPair();
      const { service, repository } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: "TAR123" });

      expect(repository.runInTransaction).not.toHaveBeenCalled();
      expect(repository.findManyByIds).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledTimes(1);
      expect(repository.update).toHaveBeenCalledWith(
        TRIP_A,
        expect.objectContaining({ tarNummer: "TAR123" }),
      );
    });

    /** An ungrouped Trip behaves identically, as it always did. */
    it("writes a standalone Trip the same way", async () => {
      const stored = [row(TRIP_A)];
      const { service, repository } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: "TAR123" });

      expect(stored[0].tarNummer).toBe("TAR123");
      expect(repository.runInTransaction).not.toHaveBeenCalled();
    });

    /** Editing anything else never touches the number either. */
    it("leaves both numbers alone when another field is edited", async () => {
      const stored = groupedPair([{ tarNummer: "TAR-A" }, { tarNummer: "TAR-B" }]);
      const { service } = buildService(stored);

      await service.update(TRIP_A, { distanceKm: 120 });

      expect(stored[0].tarNummer).toBe("TAR-A");
      expect(stored[1].tarNummer).toBe("TAR-B");
    });
  });

  describe("forming a group", () => {
    it("copies nothing onto the Trips that join it", async () => {
      const stored = [row(TRIP_A, { tarNummer: "TAR123" }), row(TRIP_B)];
      const { service } = buildService(stored);

      await service.createGroup([TRIP_A, TRIP_B]);

      expect(stored[0].tarNummer).toBe("TAR123");
      expect(stored[1].tarNummer).toBeNull();
    });

    it("leaves two different numbers exactly as they were", async () => {
      const stored = [
        row(TRIP_A, { tarNummer: "TAR-A" }),
        row(TRIP_B, { tarNummer: "TAR-B" }),
      ];
      const { service } = buildService(stored);

      await service.createGroup([TRIP_A, TRIP_B]);

      expect(stored[0].tarNummer).toBe("TAR-A");
      expect(stored[1].tarNummer).toBe("TAR-B");
    });

    /** Grouping still does what grouping does. */
    it("still assigns the group itself", async () => {
      const stored = [row(TRIP_A, { tarNummer: "TAR123" }), row(TRIP_B)];
      const { service, repository } = buildService(stored);

      await service.createGroup([TRIP_A, TRIP_B]);

      expect(repository.assignToGroup).toHaveBeenCalledWith(
        [TRIP_A, TRIP_B],
        GROUP_ID,
      );
      expect(stored[0].tripGroupId).toBe(GROUP_ID);
      expect(stored[1].tripGroupId).toBe(GROUP_ID);
    });

    it("writes no Trip field while grouping", async () => {
      const stored = [row(TRIP_A, { tarNummer: "TAR123" }), row(TRIP_B)];
      const { service, repository } = buildService(stored);

      await service.createGroup([TRIP_A, TRIP_B]);

      expect(repository.update).not.toHaveBeenCalled();
    });

    /** Nothing about a TAR-nummer reprices anything. */
    it("reprices nothing", async () => {
      const stored = [row(TRIP_A, { tarNummer: "TAR123" }), row(TRIP_B)];
      const { service, recalculation } = buildService(stored);

      await service.createGroup([TRIP_A, TRIP_B]);

      expect(recalculation.recalculate).not.toHaveBeenCalled();
    });
  });
});
