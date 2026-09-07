import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * A CLOSED Trip can be reopened, and it can be deleted.
 *
 * ── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ─────────────────────────────
 * CLOSED used to be terminal and undeletable. Both are lifted, and both go
 * through the mechanisms that already existed — the status endpoint and the
 * same soft delete every other status uses. No parallel path was added.
 *
 * These tests are mostly about what must NOT happen on the way:
 *
 *   the Trip keeps its id, booking, container and original planning date —
 *     it is the same Trip, so PDF matching and import identity are unaffected;
 *   it keeps its group, so a CLOSED Combination stays a Combination;
 *   its pricing snapshot is not read, rewritten or recalculated;
 *   and nothing is announced to the Pricing Engine, because
 *     `announceIfClosed` fires only when a Trip BECOMES closed.
 *
 * The one case covered here that the service spec does not is a CLOSED genuine
 * Combination: two legs in one group, where reopening or deleting one leg must
 * leave the other exactly as it was.
 * ────────────────────────────────────────────────────────────────────────────
 */

const GROUP_ID = "5c2f4d8e-1a3b-4c6d-8e9f-0a1b2c3d4e5f";
const DELIVERY = "11111111-1111-4111-8111-111111111111";
const COLLECTION = "22222222-2222-4222-8222-222222222222";

function buildTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.CLOSED,
    isLooseTrip: false,
    isPaid: false,
    direction: "DELIVERY",
    bookingNumber: "ANRDUB2602247",
    containerNumber: "MSKU1234567",
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
    planningDate: new Date("2026-08-21T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: 45,
    distanceKm: null,
    tarNummer: "TAR-2026-0042",
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  } as Trip;
}

function buildService(stored: Trip[]) {
  const repository = {
    findById: jest.fn((id: string) =>
      Promise.resolve(stored.find((trip) => trip.id === id) ?? null),
    ),
    findByIdentity: jest.fn().mockResolvedValue(null),
    setStatus: jest.fn((id: string, status: TripStatus) => {
      const trip = stored.find((candidate) => candidate.id === id) as Trip;

      Object.assign(trip, { status });

      return Promise.resolve(trip);
    }),
    update: jest.fn(),
    runInTransaction: jest.fn(),
  };

  repository.runInTransaction.mockImplementation(
    (work: (repo: unknown) => Promise<unknown>) => work(repository),
  );

  const eventBus = { publish: jest.fn() };
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
    eventBus as never,
    {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService,
  );

  return { service, repository, eventBus, recalculation };
}

/** A genuine Combination: two legs of one document, in one group. */
function closedCombination(): Trip[] {
  return [
    buildTrip(DELIVERY, { tripGroupId: GROUP_ID, direction: "DELIVERY" }),
    buildTrip(COLLECTION, { tripGroupId: GROUP_ID, direction: "COLLECTION" }),
  ];
}

describe("a CLOSED Trip", () => {
  describe("reopening", () => {
    it("moves to OPEN through the ordinary status endpoint", async () => {
      const stored = [buildTrip(DELIVERY)];
      const { service, repository } = buildService(stored);

      const result = await service.changeStatus(DELIVERY, {
        status: TripStatus.OPEN,
      });

      expect(result.status).toBe(TripStatus.OPEN);
      expect(repository.setStatus).toHaveBeenCalledWith(
        DELIVERY,
        TripStatus.OPEN,
      );
    });

    /** The same Trip: nothing about its identity may move. */
    it("keeps its id and its whole import identity", async () => {
      const stored = [buildTrip(DELIVERY)];
      const { service } = buildService(stored);

      const result = await service.changeStatus(DELIVERY, {
        status: TripStatus.OPEN,
      });

      expect(result.id).toBe(DELIVERY);
      expect(stored[0].bookingNumber).toBe("ANRDUB2602247");
      expect(stored[0].containerNumber).toBe("MSKU1234567");
      expect(stored[0].originalPlanningDate).toEqual(
        new Date("2026-08-21T00:00:00.000Z"),
      );
      expect(stored[0].pdfDocumentId).toBe("pdf-1");
    });

    it("writes the status column and nothing else", async () => {
      const stored = [buildTrip(DELIVERY)];
      const { service, repository } = buildService(stored);

      await service.changeStatus(DELIVERY, { status: TripStatus.OPEN });

      expect(repository.update).not.toHaveBeenCalled();
    });

    /**
     * The reason CLOSED could stop being terminal at all: leaving it costs no
     * pricing work, so the snapshot taken when it closed is still the record of
     * what was charged.
     */
    it("neither announces nor recalculates pricing", async () => {
      const stored = [buildTrip(DELIVERY)];
      const { service, eventBus, recalculation } = buildService(stored);

      await service.changeStatus(DELIVERY, { status: TripStatus.OPEN });

      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(recalculation.recalculate).not.toHaveBeenCalled();
    });

    it("is idempotent for a Trip already OPEN", async () => {
      const stored = [buildTrip(DELIVERY, { status: TripStatus.OPEN })];
      const { service, repository } = buildService(stored);

      await service.changeStatus(DELIVERY, { status: TripStatus.OPEN });

      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    describe("of one leg of a genuine Combination", () => {
      it("keeps both legs in the group", async () => {
        const stored = closedCombination();
        const { service } = buildService(stored);

        await service.changeStatus(DELIVERY, { status: TripStatus.OPEN });

        expect(stored[0].tripGroupId).toBe(GROUP_ID);
        expect(stored[1].tripGroupId).toBe(GROUP_ID);
      });

      it("leaves the other leg CLOSED", async () => {
        const stored = closedCombination();
        const { service } = buildService(stored);

        await service.changeStatus(DELIVERY, { status: TripStatus.OPEN });

        expect(stored[0].status).toBe(TripStatus.OPEN);
        expect(stored[1].status).toBe(TripStatus.CLOSED);
      });

      it("touches neither leg's TAR-nummer", async () => {
        const stored = closedCombination();
        const { service } = buildService(stored);

        await service.changeStatus(DELIVERY, { status: TripStatus.OPEN });

        expect(stored[0].tarNummer).toBe("TAR-2026-0042");
        expect(stored[1].tarNummer).toBe("TAR-2026-0042");
      });
    });
  });

  describe("deleting", () => {
    it("soft-deletes it, keeping the row", async () => {
      const stored = [buildTrip(DELIVERY)];
      const { service, repository } = buildService(stored);

      const result = await service.softDelete(DELIVERY);

      expect(result.status).toBe(TripStatus.DELETED);
      expect(repository.setStatus).toHaveBeenCalledWith(
        DELIVERY,
        TripStatus.DELETED,
      );
      expect(stored).toHaveLength(1);
    });

    it("keeps the Trip's identity and its document", async () => {
      const stored = [buildTrip(DELIVERY)];
      const { service } = buildService(stored);

      await service.softDelete(DELIVERY);

      expect(stored[0].id).toBe(DELIVERY);
      expect(stored[0].bookingNumber).toBe("ANRDUB2602247");
      expect(stored[0].pdfDocumentId).toBe("pdf-1");
    });

    it("neither announces nor recalculates pricing", async () => {
      const stored = [buildTrip(DELIVERY)];
      const { service, eventBus, recalculation } = buildService(stored);

      await service.softDelete(DELIVERY);

      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(recalculation.recalculate).not.toHaveBeenCalled();
    });

    /** Restore returns every Trip to OPEN, from CLOSED as from anywhere else. */
    it("comes back OPEN when restored", async () => {
      const stored = [buildTrip(DELIVERY, { status: TripStatus.DELETED })];
      const { service } = buildService(stored);

      const result = await service.restore(DELIVERY);

      expect(result.status).toBe(TripStatus.OPEN);
    });

    describe("one leg of a genuine Combination", () => {
      it("leaves the other leg untouched", async () => {
        const stored = closedCombination();
        const { service } = buildService(stored);

        await service.softDelete(DELIVERY);

        expect(stored[0].status).toBe(TripStatus.DELETED);
        expect(stored[1].status).toBe(TripStatus.CLOSED);
      });

      /**
       * The membership survives the delete, so nothing is orphaned: the deleted
       * leg still names its group, and unlinking stays the separate, deliberate
       * action it always was.
       */
      it("keeps the group membership on both legs", async () => {
        const stored = closedCombination();
        const { service } = buildService(stored);

        await service.softDelete(DELIVERY);

        expect(stored[0].tripGroupId).toBe(GROUP_ID);
        expect(stored[1].tripGroupId).toBe(GROUP_ID);
      });
    });
  });
});
