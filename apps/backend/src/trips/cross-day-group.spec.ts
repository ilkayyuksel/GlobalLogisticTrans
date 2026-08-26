import { Trip, TripStatus } from "@prisma/client";

import { CombinationLeg, combinationLegOf } from "../pricing-engine/combination-leg";
import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TooFewTripsToGroupException } from "./exceptions/trip.exceptions";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { VehicleService } from "../vehicles/vehicle.service";

const GROUP_ID = "97777777-7777-4777-8777-777777777777";

/**
 * Grouping Trips that fall on different days.
 *
 * ── WHY THIS IS A TEST AND NOT A CHANGE ─────────────────────────────────────
 * One movement often spans two days: the delivery goes out on the 25th and the
 * empty container comes back on the 26th. They are one job and belong in one
 * group, so grouping must not require a shared planning date.
 *
 * It never did — no rule in this service, in the Combination rule or in the
 * export ever compared two dates. These tests pin that down, because "the group
 * must be one day" is exactly the kind of assumption that gets added later by
 * someone tidying up, and it would quietly split real work in half.
 *
 * The other half of the guarantee is that grouping CHANGES nothing: each Trip
 * keeps its own date, its own truck and its own driver. Copying a date onto its
 * sibling would silently re-plan a truck.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    bookingNumber: "DUBANR2598395",
    containerNumber: null,
    containerType: "45PH",
    tripGroupId: null,
    pdfDocumentId: "pdf-1",
    direction: "DELIVERY",
    planningDate: new Date("2026-08-25T00:00:00.000Z"),
    originalPlanningDate: new Date("2026-08-25T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    distanceKm: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    vehicleId: "vehicle-1",
    driverId: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: 45,
    internalNotes: "Bel de klant",
    ...overrides,
  } as unknown as Trip;
}

describe("grouping Trips from different days", () => {
  let stored: Trip[];
  let repository: jest.Mocked<TripRepository>;
  let service: TripService;

  beforeEach(() => {
    stored = [];

    repository = {
      findManyByIds: jest.fn((ids: readonly string[]) =>
        Promise.resolve(stored.filter((trip) => ids.includes(trip.id))),
      ),
      createTripGroup: jest.fn().mockResolvedValue({ id: GROUP_ID }),
      assignToGroup: jest.fn((ids: readonly string[], groupId: string) => {
        for (const trip of stored) {
          if (ids.includes(trip.id)) {
            Object.assign(trip, { tripGroupId: groupId });
          }
        }

        return Promise.resolve();
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
      { publish: jest.fn() } as unknown as DomainEventBus,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  /** One movement over two days: out on the 25th, empty back on the 26th. */
  function givenTwoDays(): void {
    stored.push(
      buildTrip({
        id: "trip-delivery",
        direction: "DELIVERY",
        planningDate: new Date("2026-08-25T00:00:00.000Z"),
      }),
      buildTrip({
        id: "trip-collection",
        bookingNumber: "ANRBEL2603249",
        direction: "COLLECTION",
        planningDate: new Date("2026-08-26T00:00:00.000Z"),
        vehicleId: "vehicle-2",
      }),
    );
  }

  it("puts Trips from two different days into one group", async () => {
    givenTwoDays();

    const grouped = await service.createGroup([
      "trip-delivery",
      "trip-collection",
    ]);

    expect(new Set(grouped.map((trip) => trip.tripGroupId))).toEqual(
      new Set([GROUP_ID]),
    );
    expect(repository.createTripGroup).toHaveBeenCalledTimes(1);
  });

  /** The guarantee that matters: nothing is moved onto a shared day. */
  it("leaves each Trip on its own planning date", async () => {
    givenTwoDays();

    const grouped = await service.createGroup([
      "trip-delivery",
      "trip-collection",
    ]);

    expect(grouped.map((trip) => trip.planningDate)).toEqual([
      "2026-08-25",
      "2026-08-26",
    ]);
  });

  it("never writes a planning date while grouping", async () => {
    givenTwoDays();

    await service.createGroup(["trip-delivery", "trip-collection"]);

    // `assignToGroup` sets the group and nothing else; there is no `update`.
    expect(repository.assignToGroup).toHaveBeenCalledWith(
      ["trip-delivery", "trip-collection"],
      GROUP_ID,
    );
  });

  it("leaves each Trip's own vehicle and operator data alone", async () => {
    givenTwoDays();

    await service.createGroup(["trip-delivery", "trip-collection"]);

    expect(stored[0]).toMatchObject({
      vehicleId: "vehicle-1",
      waitingTimeStart: null,
      waitingTimeEnd: null,
      waitingTimeMinutes: 45,
      internalNotes: "Bel de klant",
    });
    expect(stored[1]).toMatchObject({ vehicleId: "vehicle-2" });
  });

  it("still groups Trips that fall on the same day", async () => {
    stored.push(
      buildTrip({ id: "trip-a" }),
      buildTrip({ id: "trip-b", bookingNumber: "ANRBEL2603249" }),
    );

    const grouped = await service.createGroup(["trip-a", "trip-b"]);

    expect(grouped.every((trip) => trip.tripGroupId === GROUP_ID)).toBe(true);
  });

  /** Every rule that is NOT about dates stays exactly as it was. */
  describe("the rules that are not about dates", () => {
    it("still refuses a group of one", async () => {
      stored.push(buildTrip({ id: "trip-a" }));

      await expect(service.createGroup(["trip-a"])).rejects.toBeInstanceOf(
        TooFewTripsToGroupException,
      );
      expect(repository.createTripGroup).not.toHaveBeenCalled();
    });

    it("still refuses a Trip that already belongs to a group", async () => {
      stored.push(
        buildTrip({ id: "trip-a", tripGroupId: "another-group" }),
        buildTrip({ id: "trip-b" }),
      );

      await expect(
        service.createGroup(["trip-a", "trip-b"]),
      ).rejects.toBeDefined();
      expect(repository.createTripGroup).not.toHaveBeenCalled();
    });

    it("still refuses a Trip that does not exist", async () => {
      stored.push(buildTrip({ id: "trip-a" }));

      await expect(
        service.createGroup(["trip-a", "trip-missing"]),
      ).rejects.toBeDefined();
    });
  });

  /**
   * ── AND PRICING STILL SEES WHAT IT SAW ────────────────────────────────────
   * A Combination is recognised from the shared source DOCUMENT and the two
   * directions — never from a shared date. Two legs a day apart are the same
   * Combination they always were.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("Combination recognition across two days", () => {
    const members = [
      {
        id: "trip-delivery",
        tripGroupId: GROUP_ID,
        pdfDocumentId: "pdf-1",
        direction: "DELIVERY" as const,
      },
      {
        id: "trip-collection",
        tripGroupId: GROUP_ID,
        pdfDocumentId: "pdf-1",
        direction: "COLLECTION" as const,
      },
    ];

    it("recognises both legs, whatever days they fall on", () => {
      expect(combinationLegOf(members[0], members)).toBe(
        CombinationLeg.DELIVERY,
      );
      expect(combinationLegOf(members[1], members)).toBe(
        CombinationLeg.COLLECTION,
      );
    });

    /** A manual group is still not a Combination, cross-day or not. */
    it("does not turn a manual group into a Combination", () => {
      const manual = [
        { ...members[0], pdfDocumentId: "pdf-1" },
        { ...members[1], pdfDocumentId: "pdf-2" },
      ];

      expect(combinationLegOf(manual[0], manual)).toBe(CombinationLeg.NONE);
    });
  });
});
