import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import {
  DeletedTripCannotBeLooseException,
  GroupedTripCannotBeLooseException,
  TripNotFoundException,
} from "./exceptions/trip.exceptions";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { VehicleService } from "../vehicles/vehicle.service";

/**
 * Marking several Trips as LOSRIT at once.
 *
 * ── A CLASSIFICATION, NOT A TRANSITION ──────────────────────────────────────
 * This writes ONE column. Most of the tests below are about what it must NOT
 * write: the status, the planning, the booking, the container, the vehicle and
 * the group all have to come out the other side untouched, and nothing may be
 * published — a classification that quietly triggered pricing would be a
 * lifecycle action wearing a different name.
 *
 * ── A GROUPED TRIP IS REFUSED, AND THE WHOLE REQUEST WITH IT ────────────────
 * A losrit is a loose trip; a leg of a Combination is by definition not loose.
 * The rule lives in the OPERATION rather than in the data — the two columns are
 * independent and a Trip that was already a LOSRIT before it joined a group
 * keeps its classification — so what is asserted here is that the bulk action
 * refuses, not that the combination is impossible.
 *
 * A mixed selection changes NEITHER Trip. Applying it to the half that
 * qualifies would leave the operator with a partly-done action.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    isLooseTrip: false,
    bookingNumber: "ANRDUB2602247",
    containerNumber: "CNEU4522970",
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
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: 45,
    distanceKm: null,
    internalNotes: "Bel de klant",
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  } as unknown as Trip;
}

describe("marking several Trips as LOSRIT", () => {
  let stored: Trip[];
  let published: unknown[];
  /** Every (id, data) pair the service asked the repository to write. */
  let writes: Array<[string, Prisma.TripUncheckedUpdateInput]>;
  let transactions: number;
  let repository: jest.Mocked<TripRepository>;
  let service: TripService;

  beforeEach(() => {
    stored = [];
    published = [];
    writes = [];
    transactions = 0;

    repository = {
      findManyByIds: jest.fn((ids: readonly string[]) =>
        Promise.resolve(stored.filter((trip) => ids.includes(trip.id))),
      ),
      update: jest.fn(
        (id: string, data: Prisma.TripUncheckedUpdateInput) => {
          writes.push([id, data]);

          const trip = stored.find((candidate) => candidate.id === id) as Trip;
          Object.assign(trip, data);

          return Promise.resolve(trip);
        },
      ),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    (repository.runInTransaction as jest.Mock).mockImplementation(
      (work: (repo: TripRepository) => Promise<unknown>) => {
        transactions += 1;

        return work(repository);
      },
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

  /** Ungrouped, OPEN, not yet classified — the ordinary case. */
  function givenPlain(count: number): string[] {
    const ids: string[] = [];

    for (let index = 1; index <= count; index += 1) {
      const id = `trip-${index}`;
      stored.push(buildTrip({ id, bookingNumber: `ANRDUB260224${index}` }));
      ids.push(id);
    }

    return ids;
  }

  function tripOf(id: string): Trip {
    return stored.find((trip) => trip.id === id) as Trip;
  }

  describe("what it marks", () => {
    it("marks one ungrouped Trip", async () => {
      const [id] = givenPlain(1);

      const result = await service.markManyLoose([id]);

      expect(result[0].isLooseTrip).toBe(true);
      expect(tripOf(id).isLooseTrip).toBe(true);
    });

    it("marks several ungrouped Trips", async () => {
      const ids = givenPlain(4);

      const result = await service.markManyLoose(ids);

      expect(result).toHaveLength(4);
      expect(stored.every((trip) => trip.isLooseTrip)).toBe(true);
    });

    /** A selection spanning days is one selection like any other. */
    it("marks Trips that fall on different planning dates", async () => {
      stored.push(
        buildTrip({
          id: "trip-monday",
          planningDate: new Date("2026-08-24T00:00:00.000Z"),
        }),
        buildTrip({
          id: "trip-tuesday",
          bookingNumber: "ANRBEL2603249",
          planningDate: new Date("2026-08-25T00:00:00.000Z"),
        }),
      );

      await service.markManyLoose(["trip-monday", "trip-tuesday"]);

      expect(stored.every((trip) => trip.isLooseTrip)).toBe(true);
    });

    it("returns the Trips in the order they were asked for", async () => {
      const ids = givenPlain(3);

      const result = await service.markManyLoose([ids[2], ids[0], ids[1]]);

      expect(result.map((trip) => trip.id)).toEqual([ids[2], ids[0], ids[1]]);
    });

    it("marks a CLOSED Trip too: the classification is not a lifecycle state", async () => {
      stored.push(buildTrip({ id: "trip-closed", status: TripStatus.CLOSED }));

      const result = await service.markManyLoose(["trip-closed"]);

      expect(result[0].isLooseTrip).toBe(true);
      expect(result[0].status).toBe("CLOSED");
    });

    it("marks a CANCELLED Trip too", async () => {
      stored.push(
        buildTrip({ id: "trip-cancelled", status: TripStatus.CANCELLED }),
      );

      const result = await service.markManyLoose(["trip-cancelled"]);

      expect(result[0].isLooseTrip).toBe(true);
      expect(result[0].status).toBe("CANCELLED");
    });
  });

  describe("idempotence", () => {
    it("accepts a Trip that is already a LOSRIT", async () => {
      stored.push(buildTrip({ id: "trip-loose", isLooseTrip: true }));

      const result = await service.markManyLoose(["trip-loose"]);

      expect(result[0].isLooseTrip).toBe(true);
    });

    it("writes nothing for one that is already a LOSRIT", async () => {
      stored.push(buildTrip({ id: "trip-loose", isLooseTrip: true }));

      await service.markManyLoose(["trip-loose"]);

      expect(writes).toHaveLength(0);
    });

    /** A mixed selection needs no thought from the operator. */
    it("marks the plain Trip and leaves the classified one alone", async () => {
      stored.push(
        buildTrip({ id: "trip-loose", isLooseTrip: true }),
        buildTrip({ id: "trip-plain", bookingNumber: "ANRBEL2603249" }),
      );

      const result = await service.markManyLoose(["trip-loose", "trip-plain"]);

      expect(result.every((trip) => trip.isLooseTrip)).toBe(true);
      expect(writes.map(([id]) => id)).toEqual(["trip-plain"]);
    });
  });

  describe("a Trip in a group", () => {
    const GROUP_ID = "97777777-7777-4777-8777-777777777777";

    it("is refused", async () => {
      stored.push(buildTrip({ id: "trip-grouped", tripGroupId: GROUP_ID }));

      await expect(
        service.markManyLoose(["trip-grouped"]),
      ).rejects.toBeInstanceOf(GroupedTripCannotBeLooseException);
    });

    it("names the group it belongs to", async () => {
      stored.push(buildTrip({ id: "trip-grouped", tripGroupId: GROUP_ID }));

      await expect(service.markManyLoose(["trip-grouped"])).rejects.toThrow(
        new RegExp(GROUP_ID),
      );
    });

    /** No partial write: the ungrouped Trip in the same selection is untouched. */
    it("refuses the whole selection it appears in", async () => {
      stored.push(
        buildTrip({ id: "trip-plain" }),
        buildTrip({
          id: "trip-grouped",
          bookingNumber: "ANRBEL2603249",
          tripGroupId: GROUP_ID,
        }),
      );

      await expect(
        service.markManyLoose(["trip-plain", "trip-grouped"]),
      ).rejects.toBeInstanceOf(GroupedTripCannotBeLooseException);

      expect(writes).toHaveLength(0);
      expect(tripOf("trip-plain").isLooseTrip).toBe(false);
      expect(transactions).toBe(0);
    });

    /** Refused whichever way round the selection is read. */
    it("refuses when it is named first", async () => {
      stored.push(
        buildTrip({ id: "trip-grouped", tripGroupId: GROUP_ID }),
        buildTrip({ id: "trip-plain", bookingNumber: "ANRBEL2603249" }),
      );

      await expect(
        service.markManyLoose(["trip-grouped", "trip-plain"]),
      ).rejects.toBeInstanceOf(GroupedTripCannotBeLooseException);

      expect(tripOf("trip-plain").isLooseTrip).toBe(false);
    });

    /**
     * The data model permits the combination — this is a rule of the bulk
     * ACTION. A Trip that was classified before it joined a group keeps its
     * classification, and nothing here takes it away.
     */
    it("keeps a classification it already had", async () => {
      stored.push(
        buildTrip({
          id: "trip-grouped",
          tripGroupId: GROUP_ID,
          isLooseTrip: true,
        }),
      );

      await expect(
        service.markManyLoose(["trip-grouped"]),
      ).rejects.toBeInstanceOf(GroupedTripCannotBeLooseException);

      expect(tripOf("trip-grouped").isLooseTrip).toBe(true);
    });
  });

  describe("what it refuses besides", () => {
    it("refuses a DELETED Trip", async () => {
      stored.push(buildTrip({ id: "trip-deleted", status: TripStatus.DELETED }));

      await expect(
        service.markManyLoose(["trip-deleted"]),
      ).rejects.toBeInstanceOf(DeletedTripCannotBeLooseException);
    });

    it("refuses the whole selection a DELETED Trip appears in", async () => {
      stored.push(
        buildTrip({ id: "trip-plain" }),
        buildTrip({
          id: "trip-deleted",
          bookingNumber: "ANRBEL2603249",
          status: TripStatus.DELETED,
        }),
      );

      await expect(
        service.markManyLoose(["trip-plain", "trip-deleted"]),
      ).rejects.toBeInstanceOf(DeletedTripCannotBeLooseException);

      expect(writes).toHaveLength(0);
    });

    it("refuses an id that does not exist", async () => {
      const [id] = givenPlain(1);

      await expect(
        service.markManyLoose([id, "11111111-1111-4111-8111-111111111111"]),
      ).rejects.toBeInstanceOf(TripNotFoundException);

      expect(writes).toHaveLength(0);
    });
  });

  /**
   * The heart of it: ONE column moves, and only that column.
   */
  describe("what it leaves alone", () => {
    it("writes nothing but the classification", async () => {
      const ids = givenPlain(2);

      await service.markManyLoose(ids);

      for (const [, data] of writes) {
        expect(data).toEqual({ isLooseTrip: true });
      }
    });

    it("leaves the status, planning and identity as they were", async () => {
      const [id] = givenPlain(1);
      const before = { ...tripOf(id) };

      await service.markManyLoose([id]);

      const after = tripOf(id);

      expect(after.status).toBe(before.status);
      expect(after.planningDate).toEqual(before.planningDate);
      expect(after.originalPlanningDate).toEqual(before.originalPlanningDate);
      expect(after.bookingNumber).toBe(before.bookingNumber);
      expect(after.containerNumber).toBe(before.containerNumber);
      expect(after.vehicleId).toBe(before.vehicleId);
      expect(after.driverId).toBe(before.driverId);
      expect(after.tripGroupId).toBe(before.tripGroupId);
      expect(after.pdfDocumentId).toBe(before.pdfDocumentId);
      expect(after.waitingTimeMinutes).toBe(before.waitingTimeMinutes);
    });

    /** No announcement, so nothing downstream prices anything. */
    it("publishes nothing", async () => {
      await service.markManyLoose(givenPlain(3));

      expect(published).toHaveLength(0);
    });
  });

  describe("how it writes", () => {
    it("uses one transaction for the whole selection", async () => {
      await service.markManyLoose(givenPlain(5));

      expect(transactions).toBe(1);
      expect(writes).toHaveLength(5);
    });

    it("opens no transaction when there is nothing to write", async () => {
      stored.push(buildTrip({ id: "trip-loose", isLooseTrip: true }));

      await service.markManyLoose(["trip-loose"]);

      // Still one call — the transaction wraps a loop that turns out to be
      // empty — but nothing inside it touches a row.
      expect(writes).toHaveLength(0);
    });

    it("reads the Trips once, not once per id", async () => {
      await service.markManyLoose(givenPlain(4));

      expect(repository.findManyByIds).toHaveBeenCalledTimes(1);
    });
  });
});
