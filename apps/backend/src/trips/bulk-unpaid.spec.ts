import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripNotFoundException } from "./exceptions/trip.exceptions";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { noDriverPinning } from "./trip-driver-pinning.double";

/**
 * Marking several Trips NOT PAID at once — an operator's explicit correction.
 *
 * It writes ONE column, through the same `setPaid` the single-Trip payment
 * change uses. Most of what is asserted is what it must NOT do: touch a Trip
 * that was not selected, move a status, publish anything that could start a
 * price calculation, or leave half a selection changed.
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: true,
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

describe("marking several Trips as not paid", () => {
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
      setPaid: jest.fn((id: string, isPaid: boolean) => {
        writes.push([id, { isPaid }]);

        const trip = stored.find((candidate) => candidate.id === id) as Trip;
        Object.assign(trip, { isPaid });

        return Promise.resolve(trip);
      }),
      update: jest.fn(() => {
        throw new Error("a payment change writes through setPaid only");
      }),
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
      noDriverPinning(),
      {
        applyToNewTrip: jest.fn(),
        synchronise: jest.fn(),
      } as unknown as AutomaticFlatPropertyService,
      stubPricingRecalculation(),
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

  function given(...trips: Partial<Trip>[]): string[] {
    for (const [index, overrides] of trips.entries()) {
      stored.push(buildTrip({ id: `trip-${index + 1}`, bookingNumber: `ANRDUB26022${index}`, ...overrides }));
    }

    return stored.map((trip) => trip.id);
  }

  const tripOf = (id: string) => stored.find((trip) => trip.id === id) as Trip;

  it("marks one Trip not paid", async () => {
    given({});

    const [response] = await service.markManyUnpaid(["trip-1"]);

    expect(tripOf("trip-1").isPaid).toBe(false);
    expect(response).toMatchObject({ id: "trip-1", isPaid: false });
  });

  it("marks every selected Trip, in one transaction", async () => {
    given({}, {}, {});

    await service.markManyUnpaid(["trip-1", "trip-3"]);

    expect(writes).toEqual([
      ["trip-1", { isPaid: false }],
      ["trip-3", { isPaid: false }],
    ]);
    expect(transactions).toBe(1);
  });

  it("leaves every Trip that was not selected exactly as it was", async () => {
    given({}, {}, {});
    const before = structuredClone(tripOf("trip-2"));

    await service.markManyUnpaid(["trip-1", "trip-3"]);

    expect(tripOf("trip-2")).toEqual(before);
  });

  /** Payment is independent of the lifecycle; a price problem is no reason to refuse. */
  it.each([TripStatus.OPEN, TripStatus.CLOSED, TripStatus.CANCELLED])(
    "marks a %s Trip and leaves its status alone",
    async (status) => {
      given({ status });

      await service.markManyUnpaid(["trip-1"]);

      expect(tripOf("trip-1")).toMatchObject({ status, isPaid: false });
    },
  );

  it("does not write a Trip that already is unpaid", async () => {
    given({ isPaid: false }, {});

    const responses = await service.markManyUnpaid(["trip-1", "trip-2"]);

    expect(writes).toEqual([["trip-2", { isPaid: false }]]);
    expect(responses.map((trip) => trip.id)).toEqual(["trip-1", "trip-2"]);
  });

  it("refuses the whole selection when one id names no Trip, and changes nothing", async () => {
    given({}, {});

    await expect(service.markManyUnpaid(["trip-1", "unknown"])).rejects.toBeInstanceOf(TripNotFoundException);
    expect(writes).toEqual([]);
    expect(tripOf("trip-1").isPaid).toBe(true);
  });

  /** No event, so no listener can price anything; no recalculation is asked. */
  it("publishes nothing and recalculates nothing", async () => {
    given({ status: TripStatus.CLOSED });

    await service.markManyUnpaid(["trip-1"]);

    expect(published).toEqual([]);
  });
});
