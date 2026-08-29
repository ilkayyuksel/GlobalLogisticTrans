import { Prisma, Trip, TripStatus } from "@prisma/client";

import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripPricingOverrideRepository } from "../trip-pricing/trip-pricing-override.repository";
import { TripPricingRepository } from "../trip-pricing/trip-pricing.repository";
import { VehicleAssignmentService } from "../vehicle-assignments/vehicle-assignment.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * The pricing the Ritten list carries.
 *
 * ── WHAT THESE TESTS ARE FOR ────────────────────────────────────────────────
 * Not the amounts — those are proved against the pure resolver in
 * `effective-pricing.spec.ts`, and proving them again here would only create a
 * second opinion about money. What matters HERE is that the list ANSWERS with
 * pricing at all, that each Trip gets its own, and above all the SHAPE of the
 * work: one batch read for a page, never one read per row.
 *
 * So the real EffectivePricingService is used, wired to counting repository
 * doubles. A mocked pricing service would let an N+1 through unnoticed, because
 * the thing being counted would no longer be the thing that queries.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PRICED_TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_PRICED_TRIP_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const UNPRICED_TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function buildTrip(id: string): Trip {
  return {
    id,
    pdfDocumentId: null,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.CLOSED,
    isLooseTrip: false,
    direction: null,
    bookingNumber: `BK-${id.slice(0, 6)}`,
    containerNumber: null,
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Bousbecque",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-17T00:00:00.000Z"),
    planningDate: new Date("2026-08-17T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

/** A stored snapshot, with a base price that identifies which Trip it is for. */
function buildSnapshot(tripId: string, basePrice: string) {
  return {
    id: `pricing-${tripId}`,
    tripId,
    items: [
      {
        pricingComponent: { code: "BASE_PRICE" },
        amount: new Prisma.Decimal(basePrice),
        customPropertyId: null,
        description: "Base price",
      },
    ],
  };
}

describe("the Ritten list carries the effective pricing of each Trip", () => {
  let findManyByTripIds: jest.Mock;
  let findByTripId: jest.Mock;
  let findOverridesForTrips: jest.Mock;
  let findOverridesForTrip: jest.Mock;
  let findByTripPricingId: jest.Mock;
  let findForTripsSpy: jest.SpyInstance;
  let findForTripSpy: jest.SpyInstance;
  let repository: jest.Mocked<TripRepository>;
  let service: TripService;

  /** The Trips the list will return, in the order the repository gives them. */
  function respondWithPage(trips: readonly Trip[]): void {
    (repository.findPage as jest.Mock).mockResolvedValue({
      items: [...trips],
      totalItems: trips.length,
    });
  }

  beforeEach(() => {
    findManyByTripIds = jest
      .fn()
      .mockImplementation((ids: readonly string[]) =>
        Promise.resolve(
          ids
            .filter((id) => id !== UNPRICED_TRIP_ID)
            .map((id) =>
              buildSnapshot(id, id === PRICED_TRIP_ID ? "100.00" : "250.00"),
            ),
        ),
      );

    /*
     * The per-Trip reads. Present so a "never called" assertion is a real check
     * rather than a vacuous one, and rejecting so a call that slipped through
     * would fail loudly instead of quietly returning nothing.
     */
    findByTripId = jest
      .fn()
      .mockRejectedValue(new Error("per-Trip snapshot read on a list path"));
    findByTripPricingId = jest
      .fn()
      .mockRejectedValue(new Error("per-Trip item read on a list path"));
    findOverridesForTrip = jest
      .fn()
      .mockRejectedValue(new Error("per-Trip override read on a list path"));
    findOverridesForTrips = jest.fn().mockResolvedValue([]);

    const effectivePricing = new EffectivePricingService(
      { findByTripPricingId } as unknown as TripPricingItemRepository,
      {
        findForTrips: findOverridesForTrips,
        findForTrip: findOverridesForTrip,
      } as unknown as TripPricingOverrideRepository,
      {
        findManyByTripIds,
        findByTripId,
      } as unknown as TripPricingRepository,
    );

    findForTripsSpy = jest.spyOn(effectivePricing, "findForTrips");
    findForTripSpy = jest.spyOn(effectivePricing, "findForTrip");

    const planningData = new TripPlanningDataService(
      {
        findManyByIds: () => Promise.resolve(new Map()),
      } as unknown as VehicleService,
      {
        findManyByIds: () => Promise.resolve(new Map()),
      } as unknown as DriverService,
      {
        findDriversForVehiclesOnDates: () => Promise.resolve(new Map()),
      } as unknown as VehicleAssignmentService,
      {
        findCustomPropertiesForTrips: () => Promise.resolve([]),
        findAppliedUpdateHistory: () => Promise.resolve([]),
      } as unknown as TripRepository,
      {
        findForTrips: () => Promise.resolve(new Map()),
      } as unknown as CostConfirmationService,
      effectivePricing,
    );

    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    } as unknown as jest.Mocked<TripRepository>;

    service = new TripService(
      repository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      planningData,
      {} as unknown as AutomaticFlatPropertyService,
      {} as unknown as DomainEventBus,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  describe("what each Trip carries", () => {
    it("gives every priced Trip a breakdown", async () => {
      respondWithPage([
        buildTrip(PRICED_TRIP_ID),
        buildTrip(OTHER_PRICED_TRIP_ID),
      ]);

      const page = await service.findAll({ page: 1, pageSize: 25 });

      expect(page.items).toHaveLength(2);
      expect(page.items[0].pricing).not.toBeNull();
      expect(page.items[1].pricing).not.toBeNull();
    });

    /**
     * The mapping, which is the mistake a batch read invites: every Trip must
     * receive ITS OWN pricing, not the first one in the map. The two snapshots
     * carry different base prices precisely so a swap would be visible.
     */
    it("gives each Trip the pricing of that Trip", async () => {
      respondWithPage([
        buildTrip(PRICED_TRIP_ID),
        buildTrip(OTHER_PRICED_TRIP_ID),
      ]);

      const page = await service.findAll({ page: 1, pageSize: 25 });
      const byId = new Map(page.items.map((trip) => [trip.id, trip.pricing]));

      expect(byId.get(PRICED_TRIP_ID)?.tarief).toBe("100.00");
      expect(byId.get(OTHER_PRICED_TRIP_ID)?.tarief).toBe("250.00");
    });

    /** Fixed-precision strings, exactly as the override endpoints spell them. */
    it("spells the amounts the way the pricing endpoints spell them", async () => {
      respondWithPage([buildTrip(PRICED_TRIP_ID)]);

      const [trip] = (await service.findAll({ page: 1, pageSize: 25 })).items;

      expect(trip.pricing).toMatchObject({
        tarief: "100.00",
        brandstof: "0.00",
        backload: "0.00",
        tol: "0.00",
        tunnel: "0.00",
        others: "0.00",
        ek: "0.00",
        totaal: "100.00",
      });
    });

    /**
     * Null, not a breakdown of zeros. A Trip that has never been priced and a
     * Trip priced at nothing are different facts, and zeros would state the
     * second while meaning the first.
     */
    it("reports null for a Trip that has never been priced", async () => {
      respondWithPage([buildTrip(UNPRICED_TRIP_ID)]);

      const [trip] = (await service.findAll({ page: 1, pageSize: 25 })).items;

      expect(trip.pricing).toBeNull();
    });

    it("mixes priced and unpriced Trips on one page without confusing them", async () => {
      respondWithPage([buildTrip(UNPRICED_TRIP_ID), buildTrip(PRICED_TRIP_ID)]);

      const page = await service.findAll({ page: 1, pageSize: 25 });
      const byId = new Map(page.items.map((trip) => [trip.id, trip.pricing]));

      expect(byId.get(UNPRICED_TRIP_ID)).toBeNull();
      expect(byId.get(PRICED_TRIP_ID)?.tarief).toBe("100.00");
    });

    /** An empty page asks the database nothing at all. */
    it("reads no pricing for a page with no Trips", async () => {
      respondWithPage([]);

      await service.findAll({ page: 1, pageSize: 25 });

      expect(findManyByTripIds).not.toHaveBeenCalled();
    });
  });

  /**
   * ── NO N+1, AT ANY PAGE SIZE ──────────────────────────────────────────────
   * The cost of pricing a page must follow the PAGE rather than the row count.
   * One hundred Trips is the size the requirement names, and it costs exactly
   * what one Trip costs.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("the cost of pricing a page", () => {
    function pageOf(count: number): Trip[] {
      return Array.from({ length: count }, (_, index) =>
        buildTrip(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
      );
    }

    it.each([1, 20, 100, 200])(
      "prices a page of %i Trips with one batch call",
      async (count) => {
        respondWithPage(pageOf(count));

        await service.findAll({ page: 1, pageSize: 200 });

        expect(findForTripsSpy).toHaveBeenCalledTimes(1);
      },
    );

    it.each([1, 20, 100, 200])(
      "uses two queries for a page of %i Trips, whatever its size",
      async (count) => {
        respondWithPage(pageOf(count));

        await service.findAll({ page: 1, pageSize: 200 });

        expect(findManyByTripIds).toHaveBeenCalledTimes(1);
        expect(findOverridesForTrips).toHaveBeenCalledTimes(1);
      },
    );

    it("asks about every Trip on the page in that one call", async () => {
      const trips = pageOf(100);
      respondWithPage(trips);

      await service.findAll({ page: 1, pageSize: 200 });

      expect(findManyByTripIds).toHaveBeenCalledWith(
        trips.map((trip) => trip.id),
      );
    });

    /**
     * The per-Trip path must not be reachable from here. Asserted on the
     * service AND on the repositories underneath it, because a caller could
     * bypass the service and issue the query itself.
     */
    it("never falls back to the per-Trip read", async () => {
      respondWithPage(pageOf(100));

      await service.findAll({ page: 1, pageSize: 200 });

      expect(findForTripSpy).not.toHaveBeenCalled();
      expect(findByTripId).not.toHaveBeenCalled();
      expect(findByTripPricingId).not.toHaveBeenCalled();
      expect(findOverridesForTrip).not.toHaveBeenCalled();
    });
  });
});
