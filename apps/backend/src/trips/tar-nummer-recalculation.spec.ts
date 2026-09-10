import { Prisma, Trip, TripStatus } from "@prisma/client";

import { DomainEventBus } from "../common/events/domain-event-bus";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { toEffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import { resolveEffectivePricing } from "../trip-pricing/effective-pricing";
import { VehicleService } from "../vehicles/vehicle.service";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { changesPricingInput } from "./billable-fields";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { stubTripWriteTransaction } from "./trip-write-transaction.double";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";

/**
 * Editing the TAR-nummer reprices the Trip.
 *
 * ── THE BUG THIS PINS ───────────────────────────────────────────────────────
 * The automatic TAR follows from a stated `tar_nummer`, so the number is a
 * pricing input. But the update endpoint repriced only when the waiting-time
 * window was sent. Adding a number to a CLOSED Trip stored it and left the
 * Trip's pricing exactly as it was — Others and Totaal without the TAR — until
 * somebody reopened it and closed it again, which prices a Trip through the
 * other path. Removing a number left a TAR charge behind the same way.
 *
 * The fix routes the number through the same trigger the window uses, and the
 * recalculation is the same one closing performs, so the two paths cannot
 * disagree. These tests pin both directions: a TAR-nummer edit reprices, an
 * edit that leaves it alone does not.
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
    isPaid: false,
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
function pricingWithTar(tar: string | null) {
  return toEffectivePricingDto(
    resolveEffectivePricing(
      [
        {
          componentCode: "BASE_PRICE",
          amount: new Prisma.Decimal("300.00"),
          customPropertyId: null,
          description: "Base",
          unitPrice: null,
        },
        ...(tar === null
          ? []
          : [
              {
                componentCode: "CUSTOM_PROPERTY",
                amount: new Prisma.Decimal(tar),
                customPropertyId: TAR_ID,
                description: "TAR",
                unitPrice: null,
              },
            ]),
      ],
      [],
    ),
  );
}

/** What the Trip arrived with: priced, no TAR. */
const PREVIOUS_PRICING = pricingWithTar(null);

describe("a TAR-nummer change reprices the Trip", () => {
  let stored: Trip;
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
        // The pricing the Trip ARRIVED with — which a missed recalculation
        // would answer with, and which the assertions below must never see.
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
    stored = buildTrip();

    repository = {
      findById: jest.fn(() => Promise.resolve(stored)),
      update: jest.fn((_id: string, data: Record<string, unknown>) => {
        // Only the fields actually written: an update's absent fields arrive
        // as `undefined` and must not erase what the row already holds.
        const written = Object.fromEntries(
          Object.entries(data).filter(([, value]) => value !== undefined),
        );

        stored = { ...stored, ...written } as Trip;

        return Promise.resolve(stored);
      }),
      runInTransaction: jest.fn(),
      runTripWriteTransaction: jest.fn(),
    } as unknown as jest.Mocked<TripRepository>;

    (repository.runTripWriteTransaction as jest.Mock).mockImplementation(
      stubTripWriteTransaction(repository),
    );

    service = serviceAnswering({
      pricing: pricingWithTar("50.00"),
      reasonCode: null,
    });
  });

  describe("on a CLOSED Trip", () => {
    it("reprices when a number is added", async () => {
      await service.update(TRIP_ID, { tarNummer: "TAR123" });

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
      expect(recalculation.recalculate).toHaveBeenCalledWith(TRIP_ID);
    });

    /** An explicit null is how a number is removed — and removing it reprices. */
    it("reprices when the number is removed", async () => {
      stored = buildTrip({ tarNummer: "TAR123" });

      await service.update(TRIP_ID, { tarNummer: null });

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
    });

    it("reprices when the number is changed", async () => {
      stored = buildTrip({ tarNummer: "TAR123" });

      await service.update(TRIP_ID, { tarNummer: "TAR456" });

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
    });

    /** Stored FIRST, so the Engine reads the number the operator just wrote. */
    it("writes the number before it asks for a price", async () => {
      await service.update(TRIP_ID, { tarNummer: "TAR123" });

      expect(
        (repository.update as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(recalculation.recalculate.mock.invocationCallOrder[0]);
      expect(stored.tarNummer).toBe("TAR123");
    });

    /** The answer is the NEW pricing, never the figures it arrived with. */
    it("answers with the recalculated Others and Totaal", async () => {
      const result = await service.update(TRIP_ID, { tarNummer: "TAR123" });

      expect(result.pricing?.others).toBe("50.00");
      expect(result.pricing?.totaal).toBe("350.00");
      expect(result.pricing?.others).not.toBe(PREVIOUS_PRICING.others);
    });

    it("leaves the Trip CLOSED", async () => {
      const result = await service.update(TRIP_ID, { tarNummer: "TAR123" });

      expect(result.status).toBe(TripStatus.CLOSED);
    });

    /** A window and a number in one request are one pricing input change. */
    it("prices once when the window and the number change together", async () => {
      await service.update(TRIP_ID, {
        tarNummer: "TAR123",
        waitingTimeStart: "10:00",
        waitingTimeEnd: "12:15",
      });

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
    });
  });

  describe("an edit that leaves the number alone", () => {
    it.each([
      ["a note", { internalNotes: "call the customer" }],
      ["a container number", { containerNumber: "MSKU7654321" }],
      ["a distance", { distanceKm: 120 }],
    ])("does not reprice %s", async (_label, dto) => {
      await service.update(TRIP_ID, dto);

      expect(recalculation.recalculate).not.toHaveBeenCalled();
    });

    it("answers with the pricing the Trip already had", async () => {
      const result = await service.update(TRIP_ID, {
        internalNotes: "call the customer",
      });

      expect(result.pricing?.others).toBe(PREVIOUS_PRICING.others);
    });
  });

  /**
   * The existing failure contract, unchanged: the write stands, and the answer
   * carries no pricing and a reason — never the stale figures.
   */
  describe("when the Trip cannot be priced", () => {
    beforeEach(() => {
      service = serviceAnswering({
        pricing: null,
        reasonCode: "PRICING_TRIP_NOT_CLOSED",
      });
    });

    it("keeps the number", async () => {
      await service.update(TRIP_ID, { tarNummer: "TAR123" });

      expect(stored.tarNummer).toBe("TAR123");
    });

    it("answers null with the reason, not the stale pricing", async () => {
      const result = await service.update(TRIP_ID, { tarNummer: "TAR123" });

      expect(result.pricing).toBeNull();
      expect(result.reasonCode).toBe("PRICING_TRIP_NOT_CLOSED");
    });
  });
});

describe("which updates count as a pricing input", () => {
  it.each([
    [{ tarNummer: "TAR123" }, true],
    [{ tarNummer: null }, true],
    [{ waitingTimeStart: "10:00", waitingTimeEnd: "11:00" }, true],
    [{ waitingTimeStart: null, waitingTimeEnd: null }, true],
    [{}, false],
  ])("%j -> %s", (update, expected) => {
    expect(changesPricingInput(update)).toBe(expected);
  });
});
