import { Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripNotFoundException } from "./exceptions/trip.exceptions";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_TRIP_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

/**
 * BETAALD / NIET BETAALD.
 *
 * ── WHAT THIS SUITE EXISTS TO PROTECT ───────────────────────────────────────
 * One property above all: payment is INDEPENDENT of the lifecycle. A Trip is
 * paid or unpaid whether it is OPEN, CLOSED or CANCELLED, and marking one paid
 * must never close it, reopen it, cancel it or delete it.
 *
 * The design makes that hard to break rather than merely tested: the write goes
 * through `setPaid`, which can express one column and no transition. These
 * tests hold that design in place — a future refactor that routed payment
 * through the general update would fail here.
 *
 * The rest follows from it: the default is unpaid, both directions work, the
 * change reaches exactly one Trip, and the filter is applied by the DATABASE
 * rather than after the fact, so paging and counts stay correct.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    pdfDocumentId: null,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: false,
    direction: null,
    bookingNumber: "ANRDUB2602247",
    containerNumber: null,
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-17T00:00:00Z"),
    planningDate: new Date("2026-08-17T00:00:00Z"),
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
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  } as Trip;
}

describe("a Trip's payment state", () => {
  let repository: jest.Mocked<TripRepository>;
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: TripService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(buildTrip()),
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      setPaid: jest.fn((id: string, isPaid: boolean) =>
        Promise.resolve(buildTrip({ id, isPaid })),
      ),
      setStatus: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new TripService(
      repository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        resolveOne: () =>
          Promise.resolve({ vehicle: null, effectiveDriver: null }),
        resolveMany: (trips: readonly { id: string }[]) =>
          Promise.resolve(
            new Map(
              trips.map((trip) => [
                trip.id,
                { vehicle: null, effectiveDriver: null },
              ]),
            ),
          ),
      } as unknown as TripPlanningDataService,
      {} as unknown as AutomaticFlatPropertyService,
      // Payment touches no pricing, which the assertions below check by
      // counting calls on this.
      stubPricingRecalculation(),
      { publish: jest.fn() } as unknown as DomainEventBus,
      logger as unknown as AppLoggerService,
    );
  });

  describe("the default", () => {
    it("is NIET BETAALD", async () => {
      expect((await service.findById(TRIP_ID)).isPaid).toBe(false);
    });
  });

  describe("marking a Trip BETAALD", () => {
    it("stores the new state", async () => {
      const trip = await service.changePayment(TRIP_ID, { isPaid: true });

      expect(repository.setPaid).toHaveBeenCalledWith(TRIP_ID, true);
      expect(trip.isPaid).toBe(true);
    });

    it("answers with the whole Trip, so a row can refresh from it", async () => {
      const trip = await service.changePayment(TRIP_ID, { isPaid: true });

      expect(trip.id).toBe(TRIP_ID);
      expect(trip.bookingNumber).toBe("ANRDUB2602247");
      expect(trip.status).toBe(TripStatus.OPEN);
    });

    it("logs the change with the status beside it", async () => {
      await service.changePayment(TRIP_ID, { isPaid: true });

      expect(logger.log).toHaveBeenCalledWith("Trip payment state changed", {
        tripId: TRIP_ID,
        isPaid: true,
        tripStatus: TripStatus.OPEN,
      });
    });
  });

  describe("marking it NIET BETAALD again", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildTrip({ isPaid: true }));
    });

    it("stores the new state", async () => {
      const trip = await service.changePayment(TRIP_ID, { isPaid: false });

      expect(repository.setPaid).toHaveBeenCalledWith(TRIP_ID, false);
      expect(trip.isPaid).toBe(false);
    });
  });

  describe("asking for the state it already has", () => {
    it("writes nothing", async () => {
      await service.changePayment(TRIP_ID, { isPaid: false });

      expect(repository.setPaid).not.toHaveBeenCalled();
    });

    it("still answers with the Trip", async () => {
      const trip = await service.changePayment(TRIP_ID, { isPaid: false });

      expect(trip.isPaid).toBe(false);
    });
  });

  it("refuses a Trip that does not exist", async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.changePayment(TRIP_ID, { isPaid: true }),
    ).rejects.toBeInstanceOf(TripNotFoundException);
    expect(repository.setPaid).not.toHaveBeenCalled();
  });

  /**
   * ── INDEPENDENCE FROM THE LIFECYCLE ───────────────────────────────────────
   * The heart of the feature. Every combination is reachable, and the payment
   * change leaves the status exactly as it found it.
   */
  describe("payment does not touch the lifecycle", () => {
    it.each([TripStatus.OPEN, TripStatus.CLOSED, TripStatus.CANCELLED])(
      "leaves a %s Trip in that status when it becomes BETAALD",
      async (status) => {
        repository.findById.mockResolvedValue(buildTrip({ status }));
        repository.setPaid.mockResolvedValue(
          buildTrip({ status, isPaid: true }),
        );

        const trip = await service.changePayment(TRIP_ID, { isPaid: true });

        expect(trip.status).toBe(status);
        expect(trip.isPaid).toBe(true);
      },
    );

    it.each([TripStatus.OPEN, TripStatus.CLOSED, TripStatus.CANCELLED])(
      "leaves a %s Trip in that status when it becomes NIET BETAALD",
      async (status) => {
        repository.findById.mockResolvedValue(
          buildTrip({ status, isPaid: true }),
        );
        repository.setPaid.mockResolvedValue(
          buildTrip({ status, isPaid: false }),
        );

        const trip = await service.changePayment(TRIP_ID, { isPaid: false });

        expect(trip.status).toBe(status);
        expect(trip.isPaid).toBe(false);
      },
    );

    /*
     * Asserted as calls rather than only as outcomes: a status write that
     * happened to produce the same value would still be a status write, and it
     * is the ABSENCE of one that this feature guarantees.
     */
    it("never calls a status write, an update or a deletion", async () => {
      await service.changePayment(TRIP_ID, { isPaid: true });

      expect(repository.setStatus).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("announces nothing: closing is an event, paying is not", async () => {
      const eventBus = { publish: jest.fn() };

      service = new TripService(
        repository,
        {} as unknown as VehicleService,
        {} as unknown as DriverService,
        {
          resolveOne: () =>
            Promise.resolve({ vehicle: null, effectiveDriver: null }),
        } as unknown as TripPlanningDataService,
        {} as unknown as AutomaticFlatPropertyService,
        stubPricingRecalculation(),
        eventBus as unknown as DomainEventBus,
        logger as unknown as AppLoggerService,
      );

      await service.changePayment(TRIP_ID, { isPaid: true });

      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  /** What a Trip is WORTH and whether it has been PAID are different questions. */
  it("never reprices the Trip", async () => {
    const recalculation = stubPricingRecalculation();

    service = new TripService(
      repository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        resolveOne: () =>
          Promise.resolve({ vehicle: null, effectiveDriver: null }),
      } as unknown as TripPlanningDataService,
      {} as unknown as AutomaticFlatPropertyService,
      recalculation,
      { publish: jest.fn() } as unknown as DomainEventBus,
      logger as unknown as AppLoggerService,
    );

    await service.changePayment(TRIP_ID, { isPaid: true });

    expect(recalculation.recalculate).not.toHaveBeenCalled();
  });

  /**
   * ── PER-TRIP ISOLATION ────────────────────────────────────────────────────
   * The write names one id. Nothing about the operation could reach a second
   * Trip, and this proves the id it names is the one that was asked for.
   */
  it("changes exactly the Trip it was asked about", async () => {
    await service.changePayment(TRIP_ID, { isPaid: true });

    expect(repository.setPaid).toHaveBeenCalledTimes(1);
    expect(repository.setPaid).toHaveBeenCalledWith(TRIP_ID, true);
    expect(repository.setPaid).not.toHaveBeenCalledWith(
      OTHER_TRIP_ID,
      expect.anything(),
    );
  });
});

/**
 * The filter reaches the DATABASE.
 *
 * Filtering a page after it was fetched would page over the wrong set: the
 * count would describe every Trip while the rows described a subset, and the
 * week and month views would show short pages that look like missing data.
 */
describe("the payment filter", () => {
  let repository: jest.Mocked<TripRepository>;
  let service: TripService;

  /** The filter the service handed to the repository. */
  function filterOf(): Record<string, unknown> {
    return repository.findPage.mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
  }

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    } as unknown as jest.Mocked<TripRepository>;

    service = new TripService(
      repository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        resolveMany: () => Promise.resolve(new Map()),
      } as unknown as TripPlanningDataService,
      {} as unknown as AutomaticFlatPropertyService,
      stubPricingRecalculation(),
      { publish: jest.fn() } as unknown as DomainEventBus,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  it("asks the database for the paid Trips", async () => {
    await service.findAll({ page: 1, pageSize: 25, isPaid: true });

    expect(filterOf().isPaid).toBe(true);
  });

  /*
   * The case a truthiness check silently breaks: `false` is a real question,
   * and dropping it would answer "Niet betaald" with every Trip there is.
   */
  it("asks the database for the UNPAID Trips", async () => {
    await service.findAll({ page: 1, pageSize: 25, isPaid: false });

    expect(filterOf().isPaid).toBe(false);
  });

  it("asks for no payment filter at all when none was given", async () => {
    await service.findAll({ page: 1, pageSize: 25 });

    expect(filterOf().isPaid).toBeUndefined();
  });

  it("combines with a lifecycle status", async () => {
    await service.findAll({
      page: 1,
      pageSize: 25,
      status: TripStatus.CLOSED,
      isPaid: false,
    });

    expect(filterOf()).toMatchObject({
      status: TripStatus.CLOSED,
      isPaid: false,
    });
  });

  it("combines with a period, a search and the other filters", async () => {
    await service.findAll({
      page: 1,
      pageSize: 25,
      planningDateFrom: "2026-08-17",
      planningDateTo: "2026-08-23",
      search: "DUB",
      vehicleId: "11111111-1111-4111-8111-111111111111",
      terminal: "Quay 869",
      customPropertyId: "22222222-2222-4222-8222-222222222222",
      isPaid: true,
    });

    expect(filterOf()).toMatchObject({
      search: "DUB",
      vehicleId: "11111111-1111-4111-8111-111111111111",
      terminal: "Quay 869",
      customPropertyId: "22222222-2222-4222-8222-222222222222",
      isPaid: true,
    });
    expect(filterOf().planningDateFrom).toBeInstanceOf(Date);
  });

  /*
   * The paging arithmetic is untouched by the new filter: it is one more
   * condition on the same query, so skip/take keep describing the same set the
   * count describes. This is what keeps the week and month views whole.
   */
  it("leaves the paging arithmetic exactly as it was", async () => {
    await service.findAll({ page: 3, pageSize: 50, isPaid: true });

    expect(filterOf()).toMatchObject({ skip: 100, take: 50 });
  });
});
