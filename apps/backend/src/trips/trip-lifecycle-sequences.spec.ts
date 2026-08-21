import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { ImportedTripData } from "./import-trips.command";
import { TripRevisionService } from "./trip-revision.service";
import { TripRepository } from "./trip.repository";
import {
  BOOKING_NUMBER_HOLDING_STATUSES,
  canTransition,
} from "./trip-status.rules";

/**
 * WHOLE SEQUENCES of transport documents, in the order a mailbox delivers them.
 *
 * ── THE INVARIANT THESE TESTS EXIST FOR ─────────────────────────────────────
 * Lifecycle correctness must NOT depend on the order the documents arrive in.
 * A mailbox is not a queue: an UPDATE: sent at 09:00 and a CANCEL: sent at
 * 09:01 can be delivered, fetched or retried in either order, and a Trip that
 * a late UPDATE could quietly reopen would put cancelled work back into the
 * planning without anybody asking for it.
 *
 * So both orders are tested for every sequence the business named, and each one
 * asserts the FINAL state rather than the individual steps. Once a Trip is
 * CANCELLED, no automatic document may move it — not an UPDATE, not a second
 * CANCEL, and not a NEW order carrying the same booking number.
 *
 * The single-step rules live in `trip-revision.service.spec.ts`. What is added
 * here is the composition of them, which is where an order-dependent bug would
 * hide.
 * ────────────────────────────────────────────────────────────────────────────
 */

const BOOKING = "ANRDUB2602247";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: BOOKING,
    containerNumber: "ABC123",
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
    planningDate: new Date("2026-08-21T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    direction: "COLLECTION",
    vehicleId: "vehicle-1",
    driverId: null,
    waitingTimeMinutes: 45,
    distanceKm: null,
    executionDatetime: null,
    internalNotes: "Bel de klant",
    tripGroupId: null,
    pdfDocumentId: "pdf-new",
    parserMetadata: null,
    ...overrides,
  } as unknown as Trip;
}

/** The same order as a later document states it. */
function buildDocument(
  overrides: Partial<ImportedTripData> = {},
): ImportedTripData {
  return {
    bookingNumber: BOOKING,
    containerNumber: "ABC123",
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    planningDate: "2026-08-21",
    startTime: null,
    endTime: null,
    direction: "COLLECTION",
    parserMetadata: {},
    ...overrides,
  };
}

describe("sequences of transport documents", () => {
  let stored: Trip[];
  let service: TripRevisionService;

  beforeEach(() => {
    stored = [buildTrip()];

    const repository: {
      findByBookingNumber: jest.Mock;
      setStatus: jest.Mock;
      update: jest.Mock;
      recordHistory: jest.Mock;
      runInTransaction: jest.Mock;
    } = {
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
      recordHistory: jest.fn(() => Promise.resolve()),
      runInTransaction: jest.fn((work: (repository: unknown) => unknown) =>
        work(repository),
      ),
    };

    service = new TripRevisionService(
      repository as unknown as TripRepository,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  const trip = () => stored[0];

  /** What a NEW order carrying this booking number would run into. */
  function bookingNumberIsStillHeld(): boolean {
    return stored.some(
      (candidate) =>
        candidate.bookingNumber === BOOKING &&
        BOOKING_NUMBER_HOLDING_STATUSES.includes(candidate.status),
    );
  }

  describe("an update arriving before the cancellation", () => {
    it("applies the update, then cancels: NEW → UPDATE → CANCEL", async () => {
      await service.applyDocumentRevision(
        buildDocument({ containerNumber: "XYZ456" }),
      );
      await service.cancelByBookingNumber(BOOKING);

      expect(trip().containerNumber).toBe("XYZ456");
      expect(trip().status).toBe(TripStatus.CANCELLED);
    });

    it("survives several updates: NEW → UPDATE → UPDATE → CANCEL", async () => {
      await service.applyDocumentRevision(
        buildDocument({ containerNumber: "XYZ456" }),
      );
      await service.applyDocumentRevision(
        buildDocument({ containerNumber: "DEF789", terminal: "Quay 869" }),
      );
      await service.cancelByBookingNumber(BOOKING);

      expect(trip().containerNumber).toBe("DEF789");
      expect(trip().terminal).toBe("Quay 869");
      expect(trip().status).toBe(TripStatus.CANCELLED);
    });
  });

  describe("an update arriving after the cancellation", () => {
    /** The mirror image of the sequence above, and the dangerous one. */
    it("leaves the Trip cancelled: NEW → CANCEL → UPDATE", async () => {
      await service.cancelByBookingNumber(BOOKING);

      const result = await service.applyDocumentRevision(
        buildDocument({ containerNumber: "XYZ456" }),
      );

      expect(result.outcome).toBe("REFUSED_CANCELLED");
      expect(trip().status).toBe(TripStatus.CANCELLED);
      // Not one parser-controlled field moved.
      expect(trip().containerNumber).toBe("ABC123");
    });

    it("stays cancelled however many follow: NEW → CANCEL → UPDATE → UPDATE", async () => {
      await service.cancelByBookingNumber(BOOKING);
      await service.applyDocumentRevision(
        buildDocument({ containerNumber: "XYZ456" }),
      );
      await service.applyDocumentRevision(
        buildDocument({ containerNumber: "DEF789", terminal: "Quay 869" }),
      );

      expect(trip().status).toBe(TripStatus.CANCELLED);
      expect(trip().containerNumber).toBe("ABC123");
      expect(trip().terminal).toBe("PSA Quay 869");
    });

    /**
     * The point of the whole file: the same three documents, delivered either
     * way round, end in the same lifecycle state.
     */
    it("reaches the same final state whichever order the mailbox delivers", async () => {
      await service.applyDocumentRevision(buildDocument());
      await service.cancelByBookingNumber(BOOKING);
      const forwards = trip().status;

      stored = [buildTrip()];
      await service.cancelByBookingNumber(BOOKING);
      await service.applyDocumentRevision(buildDocument());

      expect(trip().status).toBe(forwards);
      expect(trip().status).toBe(TripStatus.CANCELLED);
    });
  });

  describe("a second cancellation", () => {
    it("reports it as already cancelled and writes nothing", async () => {
      await service.cancelByBookingNumber(BOOKING);
      const before = { ...trip() };

      const outcome = await service.cancelByBookingNumber(BOOKING);

      expect(outcome).toBe("ALREADY_CANCELLED");
      expect(trip()).toEqual(before);
    });
  });

  describe("a new order for a cancelled booking number", () => {
    /**
     * Cancelling does not release the booking number, so an import carrying it
     * runs into the existing Trip rather than creating a second, active one.
     * That refusal is what keeps one booking from having two lives.
     */
    it("finds the booking number still held", async () => {
      await service.cancelByBookingNumber(BOOKING);

      expect(trip().status).toBe(TripStatus.CANCELLED);
      expect(bookingNumberIsStillHeld()).toBe(true);
    });
  });

  describe("finished work", () => {
    it("is not cancelled by a later CANCEL: CLOSED stays CLOSED", async () => {
      trip().status = TripStatus.CLOSED;

      const outcome = await service.cancelByBookingNumber(BOOKING);

      expect(outcome).toBe("REFUSED_CLOSED");
      expect(trip().status).toBe(TripStatus.CLOSED);
    });

    it("is not rewritten by a later UPDATE: CLOSED stays CLOSED", async () => {
      trip().status = TripStatus.CLOSED;

      const result = await service.applyDocumentRevision(
        buildDocument({ containerNumber: "XYZ456" }),
      );

      expect(result.outcome).toBe("REFUSED_CLOSED");
      expect(trip().status).toBe(TripStatus.CLOSED);
      expect(trip().containerNumber).toBe("ABC123");
    });
  });

  describe("what an update never touches", () => {
    it("leaves every operator-controlled field alone across a whole sequence", async () => {
      await service.applyDocumentRevision(
        buildDocument({ containerNumber: "XYZ456" }),
      );
      await service.applyDocumentRevision(
        buildDocument({ containerNumber: "DEF789" }),
      );

      expect(trip().vehicleId).toBe("vehicle-1");
      expect(trip().waitingTimeMinutes).toBe(45);
      expect(trip().internalNotes).toBe("Bel de klant");
      expect(trip().status).toBe(TripStatus.OPEN);
    });
  });

  describe("reopening", () => {
    /**
     * The one path back. It is an OPERATOR action through the status endpoint,
     * which is exactly why no document may take it: the state machine allows
     * CANCELLED → OPEN, and nothing in the automatic path calls it.
     */
    it("is allowed from CANCELLED and from nowhere else", () => {
      expect(canTransition(TripStatus.CANCELLED, TripStatus.OPEN)).toBe(true);
      expect(canTransition(TripStatus.CLOSED, TripStatus.OPEN)).toBe(false);
      expect(canTransition(TripStatus.DELETED, TripStatus.OPEN)).toBe(false);
    });

    it("is never reached by cancelling or revising", async () => {
      await service.cancelByBookingNumber(BOOKING);
      await service.applyDocumentRevision(buildDocument());
      await service.cancelByBookingNumber(BOOKING);
      await service.applyDocumentRevision(buildDocument());

      expect(trip().status).toBe(TripStatus.CANCELLED);
    });
  });
});
