import { Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import {
  InvalidTripStatusTransitionException,
  TripNotFoundException,
} from "./exceptions/trip.exceptions";
import { TripClosedEvent } from "./events/trip-closed.event";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { VehicleService } from "../vehicles/vehicle.service";

/**
 * Completing several Trips at once.
 *
 * ── ONE RULE, NOT TWO ───────────────────────────────────────────────────────
 * There is no second lifecycle here. Every Trip goes through the same state
 * machine a single completion uses, which is what these tests are mostly about:
 * a bulk path that quietly accepted a CANCELLED Trip, or that closed a Trip the
 * row menu would have refused, would be a second set of rules nobody wrote down.
 *
 * ── ALL OR NOTHING ──────────────────────────────────────────────────────────
 * Validated in full before anything is written. A selection containing one Trip
 * that cannot close moves none of them — the alternative is closing four of five
 * and leaving the operator to work out which one is missing and why.
 *
 * ── AND PRICING IS NOT PART OF IT ───────────────────────────────────────────
 * Closing announces itself and pricing happens on that announcement, outside
 * the transaction. A Trip whose route is not configured still closes: the
 * absence of a price is a configuration fact, never a reason to refuse somebody
 * ticking work off.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: "ANRDUB2602247",
    containerNumber: null,
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    tripGroupId: null,
    pdfDocumentId: "pdf-1",
    direction: "COLLECTION",
    planningDate: new Date("2026-08-25T00:00:00.000Z"),
    originalPlanningDate: new Date("2026-08-25T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    vehicleId: "vehicle-1",
    driverId: null,
    waitingTimeMinutes: 45,
    distanceKm: null,
    internalNotes: "Bel de klant",
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  } as unknown as Trip;
}

describe("completing several Trips", () => {
  let stored: Trip[];
  let published: unknown[];
  let repository: jest.Mocked<TripRepository>;
  let service: TripService;

  beforeEach(() => {
    stored = [];
    published = [];

    repository = {
      findManyByIds: jest.fn((ids: readonly string[]) =>
        Promise.resolve(stored.filter((trip) => ids.includes(trip.id))),
      ),
      setStatus: jest.fn((id: string, status: TripStatus) => {
        const trip = stored.find((candidate) => candidate.id === id) as Trip;
        Object.assign(trip, { status });

        return Promise.resolve(trip);
      }),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    (repository.runInTransaction as jest.Mock).mockImplementation(
      (work: (repo: TripRepository) => Promise<unknown>) => work(repository),
    );

    service = new TripService(
      repository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        resolveMany: (trips: readonly { id: string }[]) =>
          Promise.resolve(
            new Map(
              trips.map((trip) => [
                trip.id,
                {
                  vehicle: null,
                  effectiveDriver: null,
                  customProperties: [],
                  latestUpdate: null,
                  costConfirmation: null,
                },
              ]),
            ),
          ),
      } as unknown as TripPlanningDataService,
      {
        applyToNewTrip: jest.fn(),
        synchronise: jest.fn(),
      } as unknown as AutomaticFlatPropertyService,
      {
        publish: jest.fn((event: unknown) => {
          published.push(event);

          return Promise.resolve();
        }),
      } as unknown as DomainEventBus,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  function givenOpen(count: number): string[] {
    const ids: string[] = [];

    for (let index = 1; index <= count; index += 1) {
      const id = `trip-${index}`;
      stored.push(buildTrip({ id, bookingNumber: `ANRDUB260224${index}` }));
      ids.push(id);
    }

    return ids;
  }

  it("closes two Trips", async () => {
    const ids = givenOpen(2);

    const closed = await service.completeMany(ids);

    expect(closed.map((trip) => trip.status)).toEqual(["CLOSED", "CLOSED"]);
    expect(stored.every((trip) => trip.status === TripStatus.CLOSED)).toBe(true);
  });

  it("closes five Trips", async () => {
    const ids = givenOpen(5);

    const closed = await service.completeMany(ids);

    expect(closed).toHaveLength(5);
    expect(stored.every((trip) => trip.status === TripStatus.CLOSED)).toBe(true);
  });

  it("closes a single Trip through the same path", async () => {
    const ids = givenOpen(1);

    const closed = await service.completeMany(ids);

    expect(closed[0].status).toBe("CLOSED");
  });

  it("returns the Trips in the order they were asked for", async () => {
    const ids = givenOpen(3);

    const closed = await service.completeMany([ids[2], ids[0], ids[1]]);

    expect(closed.map((trip) => trip.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  /** Trips on different days are one selection like any other. */
  it("closes Trips that fall on different planning dates", async () => {
    stored.push(
      buildTrip({ id: "trip-a", planningDate: new Date("2026-08-25T00:00:00.000Z") }),
      buildTrip({
        id: "trip-b",
        bookingNumber: "ANRBEL2603249",
        planningDate: new Date("2026-08-26T00:00:00.000Z"),
      }),
    );

    const closed = await service.completeMany(["trip-a", "trip-b"]);

    expect(closed.map((trip) => trip.planningDate)).toEqual([
      "2026-08-25",
      "2026-08-26",
    ]);
    expect(closed.every((trip) => trip.status === "CLOSED")).toBe(true);
  });

  /** Only the status moves. Everything an operator owns is left alone. */
  it("changes nothing but the status", async () => {
    const ids = givenOpen(2);

    await service.completeMany(ids);

    for (const trip of stored) {
      expect(trip).toMatchObject({
        vehicleId: "vehicle-1",
        driverId: null,
        waitingTimeMinutes: 45,
        internalNotes: "Bel de klant",
        tripGroupId: null,
        containerNumber: null,
      });
    }
  });

  describe("what it refuses", () => {
    it("refuses the whole request when one Trip cannot be closed", async () => {
      stored.push(
        buildTrip({ id: "trip-open" }),
        buildTrip({ id: "trip-cancelled", status: TripStatus.CANCELLED }),
      );

      await expect(
        service.completeMany(["trip-open", "trip-cancelled"]),
      ).rejects.toBeInstanceOf(InvalidTripStatusTransitionException);
    });

    /** The point of validating first: nothing moved. */
    it("leaves every Trip untouched when it refuses", async () => {
      stored.push(
        buildTrip({ id: "trip-open" }),
        buildTrip({ id: "trip-deleted", status: TripStatus.DELETED }),
      );

      await expect(
        service.completeMany(["trip-open", "trip-deleted"]),
      ).rejects.toBeDefined();

      expect(stored[0].status).toBe(TripStatus.OPEN);
      expect(repository.setStatus).not.toHaveBeenCalled();
    });

    it("refuses when a Trip does not exist", async () => {
      stored.push(buildTrip({ id: "trip-open" }));

      await expect(
        service.completeMany(["trip-open", "trip-missing"]),
      ).rejects.toBeInstanceOf(TripNotFoundException);
      expect(repository.setStatus).not.toHaveBeenCalled();
    });
  });

  /**
   * Asking for a status something already has is not a change — the same answer
   * the single-Trip endpoint gives. One already-closed Trip in a selection must
   * not fail the batch.
   */
  describe("a Trip that is already CLOSED", () => {
    it("is left as it is, and does not fail the request", async () => {
      stored.push(
        buildTrip({ id: "trip-open" }),
        buildTrip({ id: "trip-closed", status: TripStatus.CLOSED }),
      );

      const closed = await service.completeMany(["trip-open", "trip-closed"]);

      expect(closed.map((trip) => trip.status)).toEqual(["CLOSED", "CLOSED"]);
      expect(repository.setStatus).toHaveBeenCalledTimes(1);
    });

    it("is not announced again", async () => {
      stored.push(buildTrip({ id: "trip-closed", status: TripStatus.CLOSED }));

      await service.completeMany(["trip-closed"]);

      expect(published).toEqual([]);
    });
  });

  /**
   * ── PRICING ───────────────────────────────────────────────────────────────
   * Every closed Trip is announced once, and pricing happens on that
   * announcement — outside this operation. Whether a Trip HAS a price never
   * enters into whether it closes.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("pricing", () => {
    it("announces every Trip it closed, once each", async () => {
      const ids = givenOpen(3);

      await service.completeMany(ids);

      expect(published).toHaveLength(3);
      expect(
        published.every((event) => event instanceof TripClosedEvent),
      ).toBe(true);
    });

    it("announces nothing when the request is refused", async () => {
      stored.push(
        buildTrip({ id: "trip-open" }),
        buildTrip({ id: "trip-cancelled", status: TripStatus.CANCELLED }),
      );

      await expect(
        service.completeMany(["trip-open", "trip-cancelled"]),
      ).rejects.toBeDefined();

      expect(published).toEqual([]);
    });

    /** It never reads a price, so a missing one cannot influence anything. */
    it("does not read any pricing while closing", async () => {
      const ids = givenOpen(2);

      await service.completeMany(ids);

      expect(
        (repository as unknown as Record<string, unknown>).findPricing,
      ).toBeUndefined();
    });
  });

  /** One transaction for the whole selection, not one per Trip. */
  it("writes the whole selection in one transaction", async () => {
    const ids = givenOpen(4);

    await service.completeMany(ids);

    expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    expect(repository.setStatus).toHaveBeenCalledTimes(4);
  });
});
