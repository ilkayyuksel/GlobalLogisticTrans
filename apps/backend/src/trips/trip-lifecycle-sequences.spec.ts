import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { ImportedTripData } from "./import-trips.command";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { stubTripWriteTransaction } from "./trip-write-transaction.double";
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
 * The LATEST document decides. A mailbox is not a queue — an UPDATE sent at
 * 09:00 and a CANCEL sent at 09:01 can be delivered, fetched or retried in
 * either order — so what a Trip looks like must follow the last document that
 * arrived for its identity, whichever way round they came.
 *
 * A cancellation is therefore not terminal: a NEW or an UPDATE that arrives
 * afterwards reopens the Trip and its fields are applied. The alternative left
 * genuinely re-planned work invisible, cancelled forever because two documents
 * crossed in the post. CLOSED is the one state that still refuses everything:
 * finished, priced work is never rewritten by a document arriving later.
 *
 * Every sequence below therefore asserts the FINAL state, and each one is a
 * sequence the business named. The single-step rules live in
 * `trip-revision.service.spec.ts`; what is added here is their composition,
 * which is where an order-dependent bug would hide.
 * ────────────────────────────────────────────────────────────────────────────
 */

const BOOKING = "ANRDUB2602247";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: BOOKING,
    // A collection: no container number, which IS this Trip's identity
    // together with its booking number.
    containerNumber: null,
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
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: 45,
    distanceKm: null,
    executionDatetime: null,
    internalNotes: "Bel de klant",
    tripGroupId: null,
    pdfDocumentId: "pdf-new",
    parserMetadata: null,
    isLooseTrip: false,
    ...overrides,
  } as unknown as Trip;
}

/** The same order as a later document states it. */
function buildDocument(
  overrides: Partial<ImportedTripData> = {},
): ImportedTripData {
  return {
    bookingNumber: BOOKING,
    containerNumber: null,
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
      findByIdentity: jest.Mock;
      findByBookingNumber: jest.Mock;
      setStatus: jest.Mock;
      update: jest.Mock;
      recordHistory: jest.Mock;
      runInTransaction: jest.Mock;
      runTripWriteTransaction: jest.Mock;
    } = {
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
      recordHistory: jest.fn(() => Promise.resolve()),
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

  const trip = () => stored[0];

  /** What a NEW order carrying this booking number would run into. */
  function bookingNumberIsStillHeld(): boolean {
    return stored.some(
      (candidate) =>
        candidate.bookingNumber === BOOKING &&
        BOOKING_NUMBER_HOLDING_STATUSES.includes(candidate.status),
    );
  }

  const cancel = () =>
    service.cancelByIdentity({ bookingNumber: BOOKING, containerNumber: null });

  const update = (overrides: Partial<ImportedTripData> = {}) =>
    service.applyDocumentRevision(buildDocument(overrides));

  const newOrder = (overrides: Partial<ImportedTripData> = {}) =>
    service.applyNewOrder(buildDocument(overrides));

  describe("an update arriving before the cancellation", () => {
    it("applies the update, then cancels: NEW -> UPDATE -> CANCEL", async () => {
      await update({ containerType: "45RH" });
      await cancel();

      expect(trip().containerType).toBe("45RH");
      expect(trip().status).toBe(TripStatus.CANCELLED);
    });

    it("survives several updates: NEW -> UPDATE -> UPDATE -> CANCEL", async () => {
      await update({ containerType: "45RH" });
      await update({ containerType: "45OS", terminal: "Quay 869" });
      await cancel();

      expect(trip().containerType).toBe("45OS");
      expect(trip().terminal).toBe("Quay 869");
      expect(trip().status).toBe(TripStatus.CANCELLED);
    });
  });

  describe("an update arriving after the cancellation", () => {
    /** The mirror image, and the one whose rule changed. */
    it("reopens the Trip: NEW -> CANCEL -> UPDATE", async () => {
      await cancel();

      const result = await update({ containerType: "45RH" });

      expect(result.outcome).toBe("REOPENED");
      expect(trip().status).toBe(TripStatus.OPEN);
      // The update is the latest word, so its fields become the Trip's fields.
      expect(trip().containerType).toBe("45RH");
    });

    it("keeps applying the later ones: NEW -> CANCEL -> UPDATE -> UPDATE", async () => {
      await cancel();
      await update({ containerType: "45RH" });
      await update({ containerType: "45OS", terminal: "Quay 869" });

      expect(trip().status).toBe(TripStatus.OPEN);
      expect(trip().containerType).toBe("45OS");
      expect(trip().terminal).toBe("Quay 869");
    });

    /**
     * The point of the whole file. The same documents delivered either way
     * round end in the state the LAST one describes — a different state for
     * each order, and correctly so: the last document is the sender's latest
     * word about the transport.
     */
    it("ends in the state the last document describes", async () => {
      await update();
      await cancel();

      expect(trip().status).toBe(TripStatus.CANCELLED);

      stored = [buildTrip()];
      await cancel();
      await update();

      expect(trip().status).toBe(TripStatus.OPEN);
    });
  });

  describe("a new order arriving after the cancellation", () => {
    it("reopens the Trip: NEW -> CANCEL -> NEW", async () => {
      await cancel();

      const result = await newOrder({ containerType: "45RH" });

      expect(result.outcome).toBe("REOPENED");
      expect(trip().status).toBe(TripStatus.OPEN);
      expect(trip().containerType).toBe("45RH");
    });

    /** One Trip throughout: the identity never changed, so nothing was added. */
    it("creates no second Trip", async () => {
      await cancel();
      await newOrder();

      expect(stored).toHaveLength(1);
    });

    it("re-reads the fields of an OPEN Trip too: NEW -> NEW", async () => {
      const result = await newOrder({ terminal: "Quay 869" });

      expect(result.outcome).toBe("UPDATED");
      expect(trip().status).toBe(TripStatus.OPEN);
      expect(trip().terminal).toBe("Quay 869");
    });

    /**
     * A NEW restates an order rather than revising one, so it reports no
     * changed fields — inventing them would put an update in the Trip's
     * history that nobody sent.
     */
    it("reports no field-level changes", async () => {
      const result = await newOrder({ terminal: "Quay 869" });

      expect(result.changedFields).toEqual([]);
    });
  });

  describe("the longer sequences the business named", () => {
    it("CANCEL -> UPDATE -> NEW ends OPEN, on the newest data", async () => {
      await cancel();
      await update({ containerType: "45RH" });
      await newOrder({ containerType: "45OS" });

      expect(trip().status).toBe(TripStatus.OPEN);
      expect(trip().containerType).toBe("45OS");
      expect(stored).toHaveLength(1);
    });

    it("UPDATE -> NEW -> CANCEL ends CANCELLED", async () => {
      await update({ containerType: "45RH" });
      await newOrder({ containerType: "45OS" });
      await cancel();

      expect(trip().status).toBe(TripStatus.CANCELLED);
      expect(trip().containerType).toBe("45OS");
    });

    it("UPDATE -> NEW -> UPDATE ends OPEN, on the last update's data", async () => {
      await update({ containerType: "45RH" });
      await newOrder({ containerType: "45OS" });
      await update({ terminal: "Quay 869" });

      expect(trip().status).toBe(TripStatus.OPEN);
      expect(trip().terminal).toBe("Quay 869");
    });

    /** Any number of crossings, and the last document still decides. */
    it("survives a long alternating sequence", async () => {
      await cancel();
      await update();
      await cancel();
      await newOrder();
      await cancel();
      await update({ terminal: "Quay 869" });

      expect(trip().status).toBe(TripStatus.OPEN);
      expect(trip().terminal).toBe("Quay 869");
      expect(stored).toHaveLength(1);
    });
  });

  describe("a second cancellation", () => {
    it("reports it as already cancelled and writes nothing", async () => {
      await cancel();
      const before = { ...trip() };

      const outcome = await cancel();

      expect(outcome).toBe("ALREADY_CANCELLED");
      expect(trip()).toEqual(before);
    });
  });

  /**
   * ── A DIFFERENT CONTAINER IS A DIFFERENT TRIP ─────────────────────────────
   * The container number is half the identity, so a document naming another one
   * is about another transport. It must not reach this Trip at all: silently
   * rewriting its container number would move the identity out from under it,
   * and the Trip an operator is planning would quietly become a different one.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a document naming a different container", () => {
    it("matches no Trip, so the revision changes nothing here", async () => {
      const result = await service.applyDocumentRevision(
        buildDocument({ containerNumber: "EUCU 453232/2" }),
      );

      expect(result.outcome).toBe("NO_MATCHING_TRIP");
      expect(trip().containerNumber).toBeNull();
      expect(trip().status).toBe(TripStatus.OPEN);
    });

    it("does not cancel the Trip that has no container", async () => {
      const outcome = await service.cancelByIdentity({
        bookingNumber: BOOKING,
        containerNumber: "EUCU 453232/2",
      });

      expect(outcome).toBe("NO_MATCHING_TRIP");
      expect(trip().status).toBe(TripStatus.OPEN);
    });

    it("leaves the other container's Trip alone", async () => {
      stored.push(buildTrip({ id: "trip-2", containerNumber: "EUCU 453232/2" }));

      await service.cancelByIdentity({
        bookingNumber: BOOKING,
        containerNumber: "EUCU 453232/2",
      });

      expect(stored[0].status).toBe(TripStatus.OPEN);
      expect(stored[1].status).toBe(TripStatus.CANCELLED);
    });

    it("revises only the Trip whose container it names", async () => {
      stored.push(buildTrip({ id: "trip-2", containerNumber: "EUCU 453232/2" }));

      await service.applyDocumentRevision(
        buildDocument({
          containerNumber: "EUCU 453232/2",
          terminal: "Quay 869",
        }),
      );

      expect(stored[0].terminal).toBe("PSA Quay 869");
      expect(stored[1].terminal).toBe("Quay 869");
    });
  });

  describe("finished work", () => {
    it("is not cancelled by a later CANCEL: CLOSED stays CLOSED", async () => {
      trip().status = TripStatus.CLOSED;

      const outcome = await cancel();

      expect(outcome).toBe("REFUSED_CLOSED");
      expect(trip().status).toBe(TripStatus.CLOSED);
    });

    it("is not rewritten by a later UPDATE: CLOSED stays CLOSED", async () => {
      trip().status = TripStatus.CLOSED;

      const result = await update({ containerType: "45RH" });

      expect(result.outcome).toBe("REFUSED_CLOSED");
      expect(trip().status).toBe(TripStatus.CLOSED);
      expect(trip().containerType).toBe("45PH");
    });

    /** The reopening rule is about CANCELLED. It does not extend to CLOSED. */
    it("is not reopened by a later NEW: CLOSED stays CLOSED", async () => {
      trip().status = TripStatus.CLOSED;

      const result = await newOrder({ containerType: "45RH" });

      expect(result.outcome).toBe("REFUSED_CLOSED");
      expect(trip().status).toBe(TripStatus.CLOSED);
      expect(trip().containerType).toBe("45PH");
    });
  });

  describe("what a document never touches", () => {
    it("leaves every operator-controlled field alone across a whole sequence", async () => {
      await update({ containerType: "45RH" });
      await cancel();
      await newOrder({ containerType: "45OS" });
      await update({ terminal: "Quay 869" });

      expect(trip().vehicleId).toBe("vehicle-1");
      expect(trip().waitingTimeMinutes).toBe(45);
      expect(trip().internalNotes).toBe("Bel de klant");
      expect(trip().status).toBe(TripStatus.OPEN);
    });

    /**
     * LOSRIT is the OPERATOR's classification of a Trip, so no document may
     * write it and none may clear it. A transport order says what the transport
     * is; it does not say how the planner files it.
     */
    it("never sets or clears the LOSRIT indicator", async () => {
      stored[0] = buildTrip({ isLooseTrip: true });

      await update({ containerType: "45RH" });
      await cancel();
      await newOrder({ containerType: "45OS" });

      expect(trip().isLooseTrip).toBe(true);
    });

    it("does not make an ordinary Trip a LOSRIT either", async () => {
      await update({ containerType: "45RH" });
      await newOrder();

      expect(trip().isLooseTrip).toBe(false);
    });
  });

  describe("reopening", () => {
    /**
     * Still an operator action through the status endpoint, and now also a
     * consequence a document can have. Both go through the same transition,
     * which is why the state machine still has to allow it.
     */
    it("is allowed from CANCELLED and from nowhere else", () => {
      expect(canTransition(TripStatus.CANCELLED, TripStatus.OPEN)).toBe(true);
      expect(canTransition(TripStatus.CLOSED, TripStatus.OPEN)).toBe(false);
      expect(canTransition(TripStatus.DELETED, TripStatus.OPEN)).toBe(false);
    });

    it("is reached by a document that supersedes the cancellation", async () => {
      await cancel();
      await update();

      expect(trip().status).toBe(TripStatus.OPEN);
      expect(bookingNumberIsStillHeld()).toBe(true);
    });
  });
});
