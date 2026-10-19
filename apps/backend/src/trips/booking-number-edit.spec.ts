import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { DuplicateTripOnEditException } from "./exceptions/trip.exceptions";
import { noDriverPinning } from "./trip-driver-pinning.double";
import { TripPlanningDataService } from "./trip-planning-data.service";
import {
  BookingOnPlanningDateQuery,
  TripIdentityQuery,
  TripRepository,
} from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * Correcting a Trip's booking number, and keeping every Trip unique while
 * doing so (owner, 19 October 2026).
 *
 * Booking, container and date must not repeat among Trips that are not
 * DELETED — on the original order date (the identity) and on the planning
 * day. The same check guards a change of booking, of container and of date.
 * The repository double answers both queries from the stored Trips with the
 * same exact comparison the real queries make, null included.
 */

const MONDAY = new Date("2026-10-19T00:00:00.000Z");
const TUESDAY = new Date("2026-10-20T00:00:00.000Z");

function buildTrip(overrides: Partial<Trip>): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: false,
    bookingNumber: "ANRDUB2602247",
    containerNumber: "CNEU4522970",
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    tripGroupId: null,
    pdfDocumentId: null,
    direction: "COLLECTION",
    planningDate: MONDAY,
    originalPlanningDate: MONDAY,
    startTime: null,
    endTime: null,
    executionDatetime: null,
    vehicleId: null,
    driverId: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    tarNummer: null,
    parserMetadata: null,
    createdAt: MONDAY,
    updatedAt: MONDAY,
    ...overrides,
  } as unknown as Trip;
}

const sameDay = (left: Date | null, right: Date | null) => left?.getTime() === right?.getTime();

describe("editing a Trip's booking number", () => {
  let stored: Trip[];
  let writes: Array<[string, Prisma.TripUncheckedUpdateInput]>;
  let service: TripService;

  beforeEach(() => {
    stored = [];
    writes = [];

    const holding = (trip: Trip, statuses: readonly TripStatus[], excludeTripId?: string) =>
      statuses.includes(trip.status) && trip.id !== excludeTripId;

    const repository = {
      findById: jest.fn((id: string) => Promise.resolve(stored.find((trip) => trip.id === id) ?? null)),
      findByIdentity: jest.fn(({ identity, statuses, excludeTripId }: TripIdentityQuery) =>
        Promise.resolve(
          stored.find(
            (trip) =>
              holding(trip, statuses, excludeTripId) &&
              trip.bookingNumber === identity.bookingNumber &&
              trip.containerNumber === identity.containerNumber &&
              sameDay(trip.originalPlanningDate, identity.originalPlanningDate),
          ) ?? null,
        ),
      ),
      findByBookingOnPlanningDate: jest.fn((query: BookingOnPlanningDateQuery) =>
        Promise.resolve(
          stored.find(
            (trip) =>
              holding(trip, query.statuses, query.excludeTripId) &&
              trip.bookingNumber === query.bookingNumber &&
              trip.containerNumber === query.containerNumber &&
              sameDay(trip.planningDate, query.planningDate),
          ) ?? null,
        ),
      ),
      update: jest.fn((id: string, data: Prisma.TripUncheckedUpdateInput) => {
        writes.push([id, data]);

        const trip = stored.find((candidate) => candidate.id === id) as Trip;
        const defined = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));

        Object.assign(trip, defined);

        return Promise.resolve(trip);
      }),
    } as unknown as TripRepository;

    service = new TripService(
      repository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        resolveOne: () =>
          Promise.resolve({
            vehicle: null,
            effectiveDriver: null,
            customProperties: [],
            latestUpdate: null,
            costConfirmation: null,
          }),
      } as unknown as TripPlanningDataService,
      noDriverPinning(),
      { applyToNewTrip: jest.fn(), synchronise: jest.fn() } as unknown as AutomaticFlatPropertyService,
      stubPricingRecalculation(),
      { publish: jest.fn(() => Promise.resolve()) } as unknown as DomainEventBus,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService,
    );
  });

  function given(...trips: Partial<Trip>[]): void {
    stored.push(...trips.map((overrides, index) => buildTrip({ id: `trip-${index + 1}`, ...overrides })));
  }

  const tripOf = (id: string) => stored.find((trip) => trip.id === id) as Trip;

  it("changes the booking number to one no other Trip holds", async () => {
    given({ bookingNumber: "ANRDUB2602247" }, { bookingNumber: "ANRDUB2609999" });

    const response = await service.update("trip-1", { bookingNumber: "ANRDUB2601111" });

    expect(response.bookingNumber).toBe("ANRDUB2601111");
    expect(writes).toEqual([["trip-1", expect.objectContaining({ bookingNumber: "ANRDUB2601111" })]]);
  });

  it("writes nothing but the booking number", async () => {
    given({});
    const before = structuredClone(tripOf("trip-1"));

    await service.update("trip-1", { bookingNumber: "ANRDUB2601111" });

    expect(tripOf("trip-1")).toEqual({ ...before, bookingNumber: "ANRDUB2601111" });
  });

  it("refuses a booking and container another Trip holds on the same date", async () => {
    given({ bookingNumber: "ANRDUB2602247" }, { bookingNumber: "ANRDUB2609999" });

    await expect(service.update("trip-1", { bookingNumber: "ANRDUB2609999" })).rejects.toThrow(
      DuplicateTripOnEditException,
    );
    expect(writes).toEqual([]);
  });

  it("says in Dutch which booking and container are taken", async () => {
    given({ bookingNumber: "ANRDUB2602247" }, { bookingNumber: "ANRDUB2609999" });

    await expect(service.update("trip-1", { bookingNumber: "ANRDUB2609999" })).rejects.toThrow(
      "Er bestaat al een rit met boekingsnummer ANRDUB2609999 met container CNEU4522970 op dezelfde datum.",
    );
  });

  /** The Trip it would clash with was planned on Tuesday from another order date. */
  it("refuses a date change that lands on a Trip with the same booking and container", async () => {
    given({}, { planningDate: TUESDAY, originalPlanningDate: new Date("2026-10-01T00:00:00.000Z") });

    await expect(service.update("trip-1", { planningDate: "2026-10-20" })).rejects.toThrow(
      DuplicateTripOnEditException,
    );
    expect(tripOf("trip-1").planningDate).toEqual(MONDAY);
  });

  it("refuses a booking change that lands on another Trip's planning day", async () => {
    given({}, { bookingNumber: "ANRDUB2609999", originalPlanningDate: new Date("2026-10-01T00:00:00.000Z") });

    await expect(service.update("trip-1", { bookingNumber: "ANRDUB2609999" })).rejects.toThrow(
      DuplicateTripOnEditException,
    );
  });

  it("moves a Trip to a day its booking does not appear on", async () => {
    given({}, { bookingNumber: "ANRDUB2609999", planningDate: TUESDAY });

    const response = await service.update("trip-1", { planningDate: "2026-10-20" });

    expect(response.planningDate).toBe("2026-10-20");
  });

  it("allows the same booking with a different container on the same date", async () => {
    given({ bookingNumber: "ANRDUB2602247" }, { bookingNumber: "ANRDUB2609999", containerNumber: "MSKU1234567" });

    const response = await service.update("trip-1", { bookingNumber: "ANRDUB2609999" });

    expect(response.bookingNumber).toBe("ANRDUB2609999");
  });

  it("refuses a container change that makes the Trip a duplicate", async () => {
    given({}, { containerNumber: "MSKU1234567" });

    await expect(service.update("trip-1", { containerNumber: "MSKU 1234567" })).rejects.toThrow(
      DuplicateTripOnEditException,
    );
  });

  /** An absent container is a value: two Trips without one are the same Trip. */
  it("checks a Trip without a container number too", async () => {
    given({ containerNumber: null }, { bookingNumber: "ANRDUB2609999", containerNumber: null });

    await expect(service.update("trip-1", { bookingNumber: "ANRDUB2609999" })).rejects.toThrow(
      "Er bestaat al een rit met boekingsnummer ANRDUB2609999 zonder containernummer op dezelfde datum.",
    );
  });

  it("allows a Trip without a container beside one with a container", async () => {
    given({ containerNumber: null }, { bookingNumber: "ANRDUB2609999" });

    const response = await service.update("trip-1", { bookingNumber: "ANRDUB2609999" });

    expect(response.bookingNumber).toBe("ANRDUB2609999");
  });

  it("never counts the Trip itself as a duplicate", async () => {
    given({});

    const sameValues = await service.update("trip-1", {
      bookingNumber: "ANRDUB2602247",
      containerNumber: "CNEU4522970",
      planningDate: "2026-10-19",
    });
    const internalNotes = await service.update("trip-1", { internalNotes: "Bel de klant" });

    expect(sameValues.bookingNumber).toBe("ANRDUB2602247");
    expect(internalNotes.internalNotes).toBe("Bel de klant");
  });

  it("lets a DELETED Trip's booking be taken again", async () => {
    given({}, { bookingNumber: "ANRDUB2609999", status: TripStatus.DELETED });

    const response = await service.update("trip-1", { bookingNumber: "ANRDUB2609999" });

    expect(response.bookingNumber).toBe("ANRDUB2609999");
  });
});
