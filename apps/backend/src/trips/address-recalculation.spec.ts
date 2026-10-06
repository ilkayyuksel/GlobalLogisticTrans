import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { PricingEngineErrorCode } from "../pricing-engine/exceptions/pricing-engine.exceptions";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { toEffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import { resolveEffectivePricing } from "../trip-pricing/effective-pricing";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { stubTripWriteTransaction } from "./trip-write-transaction.double";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * Editing a Trip's address reprices it — only where pricing reads the address.
 *
 * ── WHY THESE FIELDS ────────────────────────────────────────────────────────
 * The terminal and the destination city are the two ends RoutePricing and the
 * route costs (toll, tunnel) are matched on, so changing either changes what a
 * CLOSED Trip owes. They go through the SAME recalculation a waiting-time edit
 * does — `changesPricingInput` names them — and no other trigger exists. The
 * destination COUNTRY is read by nothing in pricing, so it reprices nothing.
 *
 * The recalculation replaces the CLOSED Trip's current snapshot, exactly as for
 * every other pricing input; operator overrides live apart and survive it.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    pdfDocumentId: null,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.CLOSED,
    isLooseTrip: false,
    direction: null,
    bookingNumber: "ANRDUB2602247",
    containerNumber: "MSKU1234567",
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
    waitingTimeEndsNextDay: false,
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

/** A breakdown as the shared effective read produces one. */
function pricingWithWaitingTime(waitingTime: string) {
  return toEffectivePricingDto(
    resolveEffectivePricing(
      [
        {
          componentCode: "BASE_PRICE",
          amount: new Prisma.Decimal("520.00"),
          customPropertyId: null,
          description: "Base",
          unitPrice: null,
        },
        {
          componentCode: "WAITING_TIME",
          amount: new Prisma.Decimal(waitingTime),
          customPropertyId: null,
          description: "Waiting",
          unitPrice: null,
        },
      ],
      [],
    ),
  );
}

/** The eight columns the Trip arrived with, before anything was edited. */
const PREVIOUS_PRICING = pricingWithWaitingTime("30.00");

describe("an address change reprices the Trip", () => {
  let repository: jest.Mocked<TripRepository>;
  let recalculation: ReturnType<typeof stubPricingRecalculation>;
  let service: TripService;

  function serviceAnswering(
    outcome: Parameters<typeof stubPricingRecalculation>[0],
  ): TripService {
    recalculation = stubPricingRecalculation(outcome);

    return new TripService(
      repository,
      {} as unknown as VehicleService,
      {} as unknown as DriverService,
      {
        /*
         * The planning read still resolves the pricing the Trip ARRIVED with.
         * That is what makes the assertions below meaningful: if the update
         * path did not replace it, a failed recalculation would answer with
         * these stale figures.
         */
        resolveOne: () =>
          Promise.resolve({
            vehicle: null,
            effectiveDriver: null,
            customProperties: [],
            latestUpdate: null,
            costConfirmation: null,
            pricing: PREVIOUS_PRICING,
          }),
        resolveMany: () => Promise.resolve(new Map()),
      } as unknown as TripPlanningDataService,
      { synchronise: jest.fn() } as unknown as AutomaticFlatPropertyService,
      recalculation,
      { publish: jest.fn() } as unknown as DomainEventBus,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  }

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(buildTrip()),
      update: jest.fn().mockResolvedValue(
        buildTrip({
          waitingTimeStart: new Date("1970-01-01T10:00:00Z"),
          waitingTimeEnd: new Date("1970-01-01T12:15:00Z"),
          waitingTimeMinutes: 135,
        }),
      ),
      runInTransaction: jest.fn(),
      runTripWriteTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    (repository.runTripWriteTransaction as jest.Mock).mockImplementation(
      stubTripWriteTransaction(repository),
    );

    service = serviceAnswering({
      pricing: pricingWithWaitingTime("60.00"),
      reasonCode: null,
    });
  });

  it.each([
    ["the terminal", { terminal: "DP World Antwerp Gateway" }],
    ["the destination city", { destinationCity: "Bousbecque" }],
    ["both ends", { terminal: "Quay 1742", destinationCity: "Lille" }],
    ["a cleared terminal", { terminal: null }],
  ])("reprices once when %s changes", async (_, update) => {
    await service.update(TRIP_ID, update);

    expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
    expect(recalculation.recalculate).toHaveBeenCalledWith(TRIP_ID);
  });

  it("writes before it asks for a price", async () => {
    const order: string[] = [];

    repository.update.mockImplementation(async () => {
      order.push("write");

      return buildTrip({ terminal: "Quay 1742" });
    });
    recalculation.recalculate.mockImplementation(async () => {
      order.push("recalculate");

      return { pricing: null, reasonCode: null };
    });

    await service.update(TRIP_ID, { terminal: "Quay 1742" });

    expect(order).toEqual(["write", "recalculate"]);
  });

  /**
   * The answer is the stored row: the new address, and the route derived from
   * it — the same route the Excel exports print.
   */
  it("answers with the new address and the route built from it", async () => {
    repository.update.mockResolvedValue(
      buildTrip({ terminal: "Quay 1742", destinationCity: "Lille" }),
    );

    const trip = await service.update(TRIP_ID, {
      terminal: "Quay 1742",
      destinationCity: "Lille",
    });

    expect(trip.terminal).toBe("Quay 1742");
    expect(trip.destinationCity).toBe("Lille");
    expect(trip.route).toEqual({ from: "Quay 1742", to: "Lille" });
  });

  /** Nothing in pricing reads the country, so it is display data alone. */
  it("does not reprice for the destination country alone", async () => {
    await service.update(TRIP_ID, { destinationCountry: "Netherlands" });

    expect(recalculation.recalculate).not.toHaveBeenCalled();
  });

  it("answers with the recalculated pricing and leaves the Trip CLOSED", async () => {
    const trip = await service.update(TRIP_ID, { destinationCity: "Bousbecque" });

    expect(trip.pricing?.ek).toBe("60.00");
    expect(trip.status).toBe(TripStatus.CLOSED);
  });

  /** A road nobody configured: the edit stands, and the reason is said. */
  it("keeps the write and says why when the new route cannot be priced", async () => {
    service = serviceAnswering({
      pricing: null,
      reasonCode: PricingEngineErrorCode.MISSING_ROUTE_PRICING,
    });

    const trip = await service.update(TRIP_ID, { destinationCity: "Nowhere" });

    expect(repository.update).toHaveBeenCalled();
    expect(trip.pricing).toBeNull();
    expect(trip.reasonCode).toBe(PricingEngineErrorCode.MISSING_ROUTE_PRICING);
  });
});
