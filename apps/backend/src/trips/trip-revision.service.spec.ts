import { Prisma, Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { ImportedTripData } from "./import-trips.command";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { stubTripWriteTransaction } from "./trip-write-transaction.double";
import { TripRevisionService } from "./trip-revision.service";
import { TripRepository } from "./trip.repository";

/**
 * What a later transport order does to a Trip that already exists.
 *
 * Every case the business named has its own test, including the three that
 * must do NOTHING — a closed Trip, a cancelled Trip and a booking nobody
 * holds. Those are the ones worth guarding: a rule that quietly starts acting
 * on them would rewrite finished work or invent transports out of corrections.
 */

const Decimal = Prisma.Decimal;

const BOOKING = "ANRDUB2602247";
/** The container the documents in this spec name. Half of the Trip's identity. */
/** The canonical form. A document prints `EUCU 455075/3`; a Trip holds this. */
const CONTAINER = "EUCU4550753";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: BOOKING,
    // The same container the documents in this spec name: the pair is the
    // Trip's identity, so a revision only reaches a Trip that shares it.
    containerNumber: CONTAINER,
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
    planningDate: new Date("2025-05-22T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    direction: "COLLECTION",
    vehicleId: null,
    driverId: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    executionDatetime: null,
    internalNotes: null,
    tripGroupId: null,
    pdfDocumentId: "pdf-1",
    parserMetadata: null,
    ...overrides,
  } as unknown as Trip;
}

/** The same order, as a later document would state it. */
function buildDocument(
  overrides: Partial<ImportedTripData> = {},
): ImportedTripData {
  return {
    bookingNumber: BOOKING,
    containerNumber: CONTAINER,
    containerType: "45RH",
    terminal: "Quay 869",
    destinationCity: "Lessines",
    destinationCountry: "Belgium",
    planningDate: "2025-05-30",
    startTime: "07:00",
    endTime: "15:00",
    direction: "DELIVERY",
    parserMetadata: { direction: "DELIVERY" },
    ...overrides,
  };
}

describe("TripRevisionService", () => {
  let stored: Trip[];
  let history: unknown[];
  let repository: {
    findManyByBookingNumber: jest.Mock;
    findByIdentity: jest.Mock;
    findByBookingNumber: jest.Mock;
    setStatus: jest.Mock;
    update: jest.Mock;
    recordHistory: jest.Mock;
    runInTransaction: jest.Mock;
    runTripWriteTransaction: jest.Mock;
  };
  let service: TripRevisionService;

  beforeEach(() => {
    stored = [];
    history = [];

    repository = {
      findManyByBookingNumber: jest.fn(
        ({
          bookingNumber,
          statuses,
        }: {
          bookingNumber: string;
          statuses: readonly TripStatus[];
        }) =>
          Promise.resolve(
            stored.filter(
              (trip) =>
                trip.bookingNumber === bookingNumber &&
                statuses.includes(trip.status),
            ),
          ),
      ),
      findByIdentity: jest.fn(
        ({
          identity,
          statuses,
        }: {
          identity: { bookingNumber: string; containerNumber: string | null };
          statuses: readonly TripStatus[];
        }) =>
          Promise.resolve(
            stored.find(
              (trip) =>
                trip.bookingNumber === identity.bookingNumber &&
                // The real rule: absent is a value, so `null` matches `null`.
                trip.containerNumber === identity.containerNumber &&
                statuses.includes(trip.status),
            ) ?? null,
          ),
      ),
      findByBookingNumber: jest.fn(
        ({
          bookingNumber,
          statuses,
        }: {
          bookingNumber: string;
          statuses: readonly TripStatus[];
        }) =>
          Promise.resolve(
            stored.find(
              (trip) =>
                trip.bookingNumber === bookingNumber &&
                statuses.includes(trip.status),
            ) ?? null,
          ),
      ),
      setStatus: jest.fn((id: string, status: TripStatus) => {
        const trip = stored.find((candidate) => candidate.id === id) as Trip;
        Object.assign(trip, { status });
        return Promise.resolve(trip);
      }),
      update: jest.fn((id: string, data: Record<string, unknown>) => {
        const trip = stored.find((candidate) => candidate.id === id) as Trip;
        Object.assign(trip, data);
        return Promise.resolve(trip);
      }),
      /** Append-only, like the real one: rows are collected, never replaced. */
      recordHistory: jest.fn((entries: unknown[]) => {
        history.push(...entries);
        return Promise.resolve();
      }),
      runInTransaction: jest.fn((work: (repository: unknown) => unknown) =>
        work(repository),
      ),
      // Replaced below: it hands out this very double, which does not exist yet.
      runTripWriteTransaction: jest.fn(),
    };

    repository.runTripWriteTransaction = stubTripWriteTransaction(repository);

    service = new TripRevisionService(
      repository as unknown as TripRepository,
      {
        applyToNewTrip: jest.fn(),
        synchronise: jest.fn(),
      } as unknown as AutomaticFlatPropertyService,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  describe("cancelling", () => {
    it("moves an OPEN Trip to CANCELLED", async () => {
      stored.push(buildTrip());

      const outcome = await service.cancelByIdentity({ bookingNumber: BOOKING, containerNumber: CONTAINER });

      expect(outcome).toBe("CANCELLED");
      expect(stored[0].status).toBe(TripStatus.CANCELLED);
    });

    it("does nothing to a Trip that is already CANCELLED", async () => {
      stored.push(buildTrip({ status: TripStatus.CANCELLED }));

      const outcome = await service.cancelByIdentity({ bookingNumber: BOOKING, containerNumber: CONTAINER });

      expect(outcome).toBe("ALREADY_CANCELLED");
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    /*
     * The transport was carried out and priced. A later cancellation does not
     * un-drive a truck, and rewriting the Trip would falsify what was invoiced.
     */
    it("leaves a CLOSED Trip exactly as it is", async () => {
      stored.push(buildTrip({ status: TripStatus.CLOSED }));

      const outcome = await service.cancelByIdentity({ bookingNumber: BOOKING, containerNumber: CONTAINER });

      expect(outcome).toBe("REFUSED_CLOSED");
      expect(stored[0].status).toBe(TripStatus.CLOSED);
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it("creates nothing when no Trip holds the booking number", async () => {
      const outcome = await service.cancelByIdentity({ bookingNumber: "ANRDUB9999999", containerNumber: null });

      expect(outcome).toBe("NO_MATCHING_TRIP");
      expect(stored).toEqual([]);
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    /* The same cancellation arriving twice must be harmless. */
    it("is idempotent", async () => {
      stored.push(buildTrip());

      const first = await service.cancelByIdentity({ bookingNumber: BOOKING, containerNumber: CONTAINER });
      const second = await service.cancelByIdentity({ bookingNumber: BOOKING, containerNumber: CONTAINER });

      expect(first).toBe("CANCELLED");
      expect(second).toBe("ALREADY_CANCELLED");
      expect(repository.setStatus).toHaveBeenCalledTimes(1);
      expect(stored).toHaveLength(1);
    });

    it("matches on the exact booking number and nothing else", async () => {
      stored.push(buildTrip({ id: "trip-1", bookingNumber: "ANRDUB2790449" }));
      stored.push(buildTrip({ id: "trip-2", bookingNumber: "ANRDUB2790528" }));

      await service.cancelByIdentity({
        bookingNumber: "ANRDUB2790528",
        containerNumber: CONTAINER,
      });

      // Same city, same date, same container type — only the booking decides.
      expect(stored[0].status).toBe(TripStatus.OPEN);
      expect(stored[1].status).toBe(TripStatus.CANCELLED);
    });

    it("leaves the Trip untouched when the write fails", async () => {
      stored.push(buildTrip());
      repository.setStatus.mockRejectedValue(new Error("database unavailable"));

      await expect(service.cancelByIdentity({ bookingNumber: BOOKING, containerNumber: CONTAINER })).rejects.toThrow();
      expect(stored[0].status).toBe(TripStatus.OPEN);
    });
  });

  describe("revising", () => {
    it("writes the document's own fields onto an OPEN Trip", async () => {
      stored.push(buildTrip());

      const result = await service.applyDocumentRevision(buildDocument());

      expect(result.outcome).toBe("UPDATED");
      expect(stored[0]).toMatchObject({
        containerNumber: CONTAINER,
        containerType: "45RH",
        terminal: "Quay 869",
        destinationCity: "Lessines",
        destinationCountry: "Belgium",
        direction: "DELIVERY",
      });
    });

    /**
     * ── THE RULE THIS PHASE EXISTS FOR ──────────────────────────────────────
     * A new PDF must never quietly undo an afternoon of planning. Everything
     * the operator owns survives a revision untouched.
     * ────────────────────────────────────────────────────────────────────────
     */
    it("preserves every field the operator controls", async () => {
      stored.push(
        buildTrip({
          vehicleId: "vehicle-1",
          driverId: "driver-1",
          waitingTimeStart: null,
          waitingTimeEnd: null,
          waitingTimeMinutes: 45,
          distanceKm: new Decimal(320),
          executionDatetime: new Date("2025-05-23T09:00:00.000Z"),
          internalNotes: "Call the warehouse before arriving",
          tripGroupId: "group-1",
        }),
      );

      await service.applyDocumentRevision(buildDocument());

      expect(stored[0]).toMatchObject({
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeMinutes: 45,
        distanceKm: new Decimal(320),
        internalNotes: "Call the warehouse before arriving",
        tripGroupId: "group-1",
      });
      expect(stored[0].executionDatetime).toEqual(
        new Date("2025-05-23T09:00:00.000Z"),
      );
    });

    it("never writes an operator-owned field, even as null", async () => {
      stored.push(buildTrip({ vehicleId: "vehicle-1" }));

      await service.applyDocumentRevision(buildDocument());

      const [, written] = repository.update.mock.calls[0];

      for (const field of [
        "vehicleId",
        "driverId",
        "waitingTimeMinutes",
        "distanceKm",
        "executionDatetime",
        "internalNotes",
        "tripGroupId",
        "status",
      ]) {
        expect(written).not.toHaveProperty(field);
      }
    });

    /*
     * The planned date is the operator's while they have moved it, and the
     * document's while they have not. `originalPlanningDate` always follows the
     * document, because that is what the document said.
     */
    it("follows the document's date while the operator has not moved it", async () => {
      stored.push(buildTrip());

      await service.applyDocumentRevision(buildDocument());

      expect(stored[0].planningDate).toEqual(new Date("2025-05-30T00:00:00.000Z"));
      expect(stored[0].originalPlanningDate).toEqual(
        new Date("2025-05-30T00:00:00.000Z"),
      );
    });

    it("keeps a date the operator moved, and still records the document's", async () => {
      stored.push(
        buildTrip({
          originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
          // Re-planned by hand to another day.
          planningDate: new Date("2025-05-26T00:00:00.000Z"),
        }),
      );

      await service.applyDocumentRevision(buildDocument());

      expect(stored[0].planningDate).toEqual(new Date("2025-05-26T00:00:00.000Z"));
      expect(stored[0].originalPlanningDate).toEqual(
        new Date("2025-05-30T00:00:00.000Z"),
      );
    });

    it("refuses a CLOSED Trip and changes nothing", async () => {
      stored.push(buildTrip({ status: TripStatus.CLOSED }));
      const before = { ...stored[0] };

      const result = await service.applyDocumentRevision(buildDocument());

      expect(result.outcome).toBe("REFUSED_CLOSED");
      expect(repository.update).not.toHaveBeenCalled();
      expect(stored[0]).toEqual(before);
    });

    /**
     * A cancellation is no longer terminal. An update that arrives after one is
     * the LATER statement about the same transport, so it brings the Trip back
     * and its fields are applied — the alternative leaves real, re-planned work
     * invisible because two documents crossed in the post.
     */
    it("reopens a CANCELLED Trip and applies the update", async () => {
      stored.push(buildTrip({ status: TripStatus.CANCELLED }));

      const result = await service.applyDocumentRevision(buildDocument());

      expect(result.outcome).toBe("REOPENED");
      expect(stored[0].status).toBe(TripStatus.OPEN);
      expect(stored[0].destinationCity).toBe("Lessines");
      expect(history).toContainEqual(
        expect.objectContaining({ eventType: "REOPENED" }),
      );
    });

    it("creates nothing when no Trip holds the booking number", async () => {
      const result = await service.applyDocumentRevision(buildDocument());

      expect(result.outcome).toBe("NO_MATCHING_TRIP");
      expect(result.trip).toBeNull();
      expect(stored).toEqual([]);
    });

    it("is idempotent", async () => {
      stored.push(buildTrip());

      await service.applyDocumentRevision(buildDocument());
      const afterFirst = { ...stored[0] };
      await service.applyDocumentRevision(buildDocument());

      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(afterFirst);
    });

    it("matches on the exact booking number and nothing else", async () => {
      stored.push(buildTrip({ id: "trip-1", bookingNumber: "ANRDUB2790449" }));
      stored.push(buildTrip({ id: "trip-2", bookingNumber: "ANRDUB2790528" }));

      await service.applyDocumentRevision(
        buildDocument({ bookingNumber: "ANRDUB2790528" }),
      );

      expect(stored[0].destinationCity).toBe("Dourges");
      expect(stored[1].destinationCity).toBe("Lessines");
    });

    it("leaves the Trip untouched when the write fails", async () => {
      stored.push(buildTrip());
      const before = { ...stored[0] };
      repository.update.mockRejectedValue(new Error("database unavailable"));

      await expect(
        service.applyDocumentRevision(buildDocument()),
      ).rejects.toThrow();
      expect(stored[0]).toEqual(before);
    });

    /* A revision keeps the Trip OPEN, and an OPEN Trip is never priced. */
    it("neither closes the Trip nor prices anything", async () => {
      stored.push(buildTrip());

      await service.applyDocumentRevision(buildDocument());

      expect(stored[0].status).toBe(TripStatus.OPEN);
    });
  });
});
