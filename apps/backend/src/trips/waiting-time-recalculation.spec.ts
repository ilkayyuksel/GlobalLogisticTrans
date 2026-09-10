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
import { IncompleteWaitingWindowException } from "./exceptions/trip.exceptions";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";
import { stubTripWriteTransaction } from "./trip-write-transaction.double";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * Editing a waiting-time window reprices the Trip.
 *
 * ── WHY THIS FIELD ──────────────────────────────────────────────────────────
 * The window is one of the two inputs on the Trip update endpoint that an
 * operator edits AFTER the work is finished and that the Pricing Engine bills
 * from; the other is the TAR-nummer, covered in `tar-nummer-recalculation.spec`.
 * The assertions below pin the window down in both directions: a waiting-time
 * edit reprices, a container-number edit does not.
 *
 * ── AND WHAT THE ANSWER CARRIES ─────────────────────────────────────────────
 * The recalculated pricing, or nothing at all with a reason. Never the figures
 * the Trip had before the edit: those describe a window that no longer exists,
 * and a screen has no way to tell them from current ones. The write stands
 * either way, and the Trip stays CLOSED.
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

describe("a waiting-time change reprices the Trip", () => {
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

  describe("the write", () => {
    /** 10:00 to 12:15 is 135 minutes. The backend derives it; nobody sends it. */
    it("stores the window and the duration derived from it", async () => {
      await service.update(TRIP_ID, {
        waitingTimeStart: "10:00",
        waitingTimeEnd: "12:15",
      });

      expect(repository.update).toHaveBeenCalledWith(
        TRIP_ID,
        expect.objectContaining({ waitingTimeMinutes: 135 }),
      );
    });

    it("writes before it asks for a price", async () => {
      const order: string[] = [];

      repository.update.mockImplementation(async () => {
        order.push("write");

        return buildTrip({ waitingTimeMinutes: 135 });
      });
      recalculation.recalculate.mockImplementation(async () => {
        order.push("recalculate");

        return { pricing: null, reasonCode: null };
      });

      await service.update(TRIP_ID, {
        waitingTimeStart: "10:00",
        waitingTimeEnd: "12:15",
      });

      expect(order).toEqual(["write", "recalculate"]);
    });

    /*
     * The rule that makes the money and the evidence for it agree: a half
     * window is refused before anything is written, so nothing is repriced
     * either.
     */
    it("refuses an incomplete window and reprices nothing", async () => {
      await expect(
        service.update(TRIP_ID, { waitingTimeStart: "10:00" }),
      ).rejects.toBeInstanceOf(IncompleteWaitingWindowException);

      expect(repository.update).not.toHaveBeenCalled();
      expect(recalculation.recalculate).not.toHaveBeenCalled();
    });
  });

  describe("the recalculation", () => {
    it("runs exactly once, for exactly this Trip", async () => {
      await service.update(TRIP_ID, {
        waitingTimeStart: "10:00",
        waitingTimeEnd: "12:15",
      });

      expect(recalculation.recalculate).toHaveBeenCalledTimes(1);
      expect(recalculation.recalculate).toHaveBeenCalledWith(TRIP_ID);
    });

    it("runs when the window is CLEARED, which is a change like any other", async () => {
      await service.update(TRIP_ID, {
        waitingTimeStart: null,
        waitingTimeEnd: null,
      });

      expect(recalculation.recalculate).toHaveBeenCalledWith(TRIP_ID);
    });

    /*
     * A container number is not a pricing input. Repricing on every field would
     * put a calculation behind edits that cannot change an amount.
     */
    it("does not run for an update that touches no pricing input", async () => {
      await service.update(TRIP_ID, { containerNumber: "MSKU7654321" });

      expect(recalculation.recalculate).not.toHaveBeenCalled();
    });

    it("waits for it before answering", async () => {
      let hasFinished = false;

      recalculation.recalculate.mockImplementation(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        hasFinished = true;

        return { pricing: pricingWithWaitingTime("60.00"), reasonCode: null };
      });

      const trip = await service.update(TRIP_ID, {
        waitingTimeStart: "10:00",
        waitingTimeEnd: "12:15",
      });

      expect(hasFinished).toBe(true);
      expect(trip.pricing?.others).toBe("60.00");
    });
  });

  describe("the response", () => {
    it("carries the new duration and the recalculated pricing", async () => {
      const trip = await service.update(TRIP_ID, {
        waitingTimeStart: "10:00",
        waitingTimeEnd: "12:15",
      });

      expect(trip.waitingTimeMinutes).toBe(135);
      expect(trip.pricing?.others).toBe("60.00");
      expect(trip.pricing?.totaal).toBe("580.00");
      expect(trip.reasonCode).toBeNull();
    });

    it("leaves the Trip CLOSED", async () => {
      const trip = await service.update(TRIP_ID, {
        waitingTimeStart: "10:00",
        waitingTimeEnd: "12:15",
      });

      expect(trip.status).toBe(TripStatus.CLOSED);
      expect(repository.update).toHaveBeenCalledWith(
        TRIP_ID,
        expect.not.objectContaining({ status: expect.anything() }),
      );
    });

    /**
     * ── THE FAILURE CONTRACT ────────────────────────────────────────────────
     * The stale figures are RIGHT THERE: the planning read resolved them a line
     * earlier. Returning them would be the easy mistake and an invisible one,
     * so this asserts they are replaced rather than merely absent.
     */
    describe("when the Trip cannot be priced", () => {
      beforeEach(() => {
        service = serviceAnswering({
          pricing: null,
          reasonCode: PricingEngineErrorCode.MISSING_ROUTE_PRICING,
        });
      });

      it("keeps the write", async () => {
        const trip = await service.update(TRIP_ID, {
          waitingTimeStart: "10:00",
          waitingTimeEnd: "12:15",
        });

        expect(repository.update).toHaveBeenCalledTimes(1);
        expect(trip.waitingTimeMinutes).toBe(135);
      });

      it("returns no pricing rather than the figures from before the edit", async () => {
        const trip = await service.update(TRIP_ID, {
          waitingTimeStart: "10:00",
          waitingTimeEnd: "12:15",
        });

        expect(trip.pricing).toBeNull();
        expect(trip.pricing).not.toEqual(PREVIOUS_PRICING);
      });

      it("says why", async () => {
        const trip = await service.update(TRIP_ID, {
          waitingTimeStart: "10:00",
          waitingTimeEnd: "12:15",
        });

        expect(trip.reasonCode).toBe(
          PricingEngineErrorCode.MISSING_ROUTE_PRICING,
        );
      });

      it("still leaves the Trip CLOSED", async () => {
        const trip = await service.update(TRIP_ID, {
          waitingTimeStart: "10:00",
          waitingTimeEnd: "12:15",
        });

        expect(trip.status).toBe(TripStatus.CLOSED);
      });
    });
  });

  /**
   * A plain READ never attempted a recalculation, so it has nothing to explain.
   * A reason code on a list row would suggest a failure where none happened.
   */
  it("reports no reason on an update that did not reprice", async () => {
    const trip = await service.update(TRIP_ID, {
      containerNumber: "MSKU7654321",
    });

    expect(trip.reasonCode).toBeNull();
    expect(trip.pricing).toEqual(PREVIOUS_PRICING);
  });
});
