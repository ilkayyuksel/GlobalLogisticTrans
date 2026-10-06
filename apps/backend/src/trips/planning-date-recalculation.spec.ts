import { Trip, TripDirection, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

const LEG1 = "11111111-1111-4111-8111-111111111111";
const LEG2 = "22222222-2222-4222-8222-222222222222";

/**
 * Moving a Combination leg to another day reprices its Leg 2 — automatically.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * Leg 2 owes Over ST exactly when its planningDate differs from Leg 1's, so
 * EITHER leg's date can switch it on or off. Which Trips that reaches is the
 * pricing domain's answer (`tripsAffectedByPlanningDate`, asserted in its own
 * specs); this asserts the Trip side: asked only on a real move, after the
 * write, CLOSED Trips only, each once, and nothing new for an ordinary Trip.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: LEG1,
    pdfDocumentId: "pdf-1",
    tripGroupId: "group-1",
    vehicleId: null,
    driverId: null,
    status: TripStatus.CLOSED,
    isLooseTrip: false,
    direction: TripDirection.DELIVERY,
    bookingNumber: "BK-1",
    containerNumber: null,
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-10-06T00:00:00Z"),
    planningDate: new Date("2026-10-06T00:00:00Z"),
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
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  } as Trip;
}

const LEG2_REPRICED = { pricing: null, reasonCode: "LEG2_REPRICED" };

describe("a planningDate change reprices the Combination's Leg 2", () => {
  let stored: Map<string, Trip>;
  let repository: jest.Mocked<TripRepository>;
  let recalculation: ReturnType<typeof stubPricingRecalculation>;
  let service: TripService;
  let order: string[];

  /** Edits one stored Trip as the write would, and returns the stored row. */
  function storeUpdate(id: string, data: { planningDate?: Date | null; terminal?: string }) {
    // Only what was written: the write leaves an unsent field as it was.
    const written = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    const updated = { ...stored.get(id)!, ...written } as Trip;
    stored.set(id, updated);
    order.push(`write ${id}`);

    return updated;
  }

  beforeEach(() => {
    order = [];
    stored = new Map([
      [LEG1, buildTrip()],
      [
        LEG2,
        buildTrip({
          id: LEG2,
          direction: TripDirection.COLLECTION,
          destinationCity: "Lille",
          planningDate: new Date("2026-10-07T00:00:00Z"),
        }),
      ],
    ]);
    repository = {
      findById: jest.fn(async (id: string) => stored.get(id) ?? null),
      update: jest.fn(async (id: string, data: { planningDate?: Date | null }) =>
        storeUpdate(id, data),
      ),
    } as unknown as jest.Mocked<TripRepository>;
    recalculation = stubPricingRecalculation();
    recalculation.recalculate.mockImplementation(async (id: string) => {
      order.push(`recalculate ${id}`);

      return id === LEG2 ? LEG2_REPRICED : { pricing: null, reasonCode: null };
    });
    // Leg 2 is the Combination's Leg 2, whichever leg moved.
    recalculation.tripsAffectedByPlanningDate.mockResolvedValue([LEG2]);

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
            pricing: null,
          }),
        resolveMany: () => Promise.resolve(new Map()),
      } as unknown as TripPlanningDataService,
      { synchronise: jest.fn() } as unknown as AutomaticFlatPropertyService,
      recalculation,
      { publish: jest.fn() } as unknown as DomainEventBus,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as AppLoggerService,
    );
  });

  it("7. Leg 1 moved: reprices Leg 2, after the write, without the reprice button", async () => {
    await service.update(LEG1, { planningDate: "2026-10-07" });

    expect(recalculation.tripsAffectedByPlanningDate).toHaveBeenCalledWith(LEG1);
    expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
    expect(order).toEqual([`write ${LEG1}`, `recalculate ${LEG2}`]);
  });

  it("8. Leg 2 moved: reprices Leg 2 and answers with its new pricing", async () => {
    const response = await service.update(LEG2, { planningDate: "2026-10-08" });

    expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
    expect(recalculation.recalculate).toHaveBeenCalledWith(LEG2);
    expect(response.reasonCode).toBe("LEG2_REPRICED");
  });

  it("9. a date and an address changed together: Leg 2 priced once, not twice", async () => {
    await service.update(LEG2, { planningDate: "2026-10-08", terminal: "Quay 1742" });

    expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
  });

  it("10. an OPEN Leg 2 gets no snapshot: it is priced when it closes", async () => {
    stored.set(LEG2, { ...stored.get(LEG2)!, status: TripStatus.OPEN });

    await service.update(LEG1, { planningDate: "2026-10-07" });

    expect(recalculation.recalculate).not.toHaveBeenCalled();
  });

  it("11. the same date sent again moves nothing and asks nothing", async () => {
    await service.update(LEG1, { planningDate: "2026-10-06" });

    expect(recalculation.tripsAffectedByPlanningDate).not.toHaveBeenCalled();
    expect(recalculation.recalculate).not.toHaveBeenCalled();
  });

  it("12. an ordinary Trip moved: no repricing, exactly as before", async () => {
    recalculation.tripsAffectedByPlanningDate.mockResolvedValue([]);

    await service.update(LEG1, { planningDate: "2026-10-09" });

    expect(recalculation.recalculate).not.toHaveBeenCalled();
  });

  it("an ordinary Trip's own pricing inputs still reprice it", async () => {
    recalculation.tripsAffectedByPlanningDate.mockResolvedValue([]);

    await service.update(LEG1, { planningDate: "2026-10-09", terminal: "Quay 1742" });

    expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
    expect(recalculation.recalculate).toHaveBeenCalledWith(LEG1);
  });
});
