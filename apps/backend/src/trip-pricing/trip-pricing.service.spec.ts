import { NotFoundException } from "@nestjs/common";
import {
  PricingCalculationStatus,
  Prisma,
  TripPricing,
  TripStatus,
} from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import { TripPricingNotFoundException } from "./exceptions/trip-pricing.exceptions";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingService } from "./trip-pricing.service";

const PRICING_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TRIP_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function buildTripPricing(overrides: Partial<TripPricing> = {}): TripPricing {
  return {
    id: PRICING_ID,
    tripId: TRIP_ID,
    totalPrice: new Prisma.Decimal("482.35"),
    currency: "EUR",
    calculatedAt: new Date("2026-08-11T09:15:00.000Z"),
    pricingEngineVersion: "1.4.0",
    pricingRuleVersion: "2026.08",
    calculationStatus: PricingCalculationStatus.CALCULATED,
    notes: null,
    createdAt: new Date("2026-08-11T09:15:00.000Z"),
    updatedAt: new Date("2026-08-11T09:15:00.000Z"),
    ...overrides,
  };
}

describe("TripPricingService", () => {
  let repository: jest.Mocked<TripPricingRepository>;
  let tripService: { findById: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: TripPricingService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(null),
      findByTripId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildTripPricing()),
      update: jest.fn().mockResolvedValue(buildTripPricing()),
    } as unknown as jest.Mocked<TripPricingRepository>;

    tripService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: TRIP_ID, status: TripStatus.CLOSED }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new TripPricingService(
      repository,
      tripService as unknown as TripService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("findById", () => {
    it("returns the snapshot", async () => {
      repository.findById.mockResolvedValue(buildTripPricing());

      expect((await service.findById(PRICING_ID)).id).toBe(PRICING_ID);
    });

    it("throws when the snapshot does not exist", async () => {
      await expect(service.findById(PRICING_ID)).rejects.toBeInstanceOf(
        TripPricingNotFoundException,
      );
    });
  });

  describe("findByTripId", () => {
    it("returns the snapshot belonging to the Trip", async () => {
      repository.findByTripId.mockResolvedValue(buildTripPricing());

      const result = await service.findByTripId(TRIP_ID);

      expect(repository.findByTripId).toHaveBeenCalledWith(TRIP_ID);
      expect(result?.tripId).toBe(TRIP_ID);
    });

    it("returns null when the Trip has no snapshot", async () => {
      expect(await service.findByTripId(TRIP_ID)).toBeNull();
    });

    it("propagates the Trip's own 404 rather than reporting no pricing", async () => {
      tripService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.findByTripId(TRIP_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.findByTripId).not.toHaveBeenCalled();
    });

    it("does not require the Trip to be CLOSED in order to be queried", async () => {
      tripService.findById.mockResolvedValue({
        id: TRIP_ID,
        status: TripStatus.OPEN,
      });

      expect(await service.findByTripId(TRIP_ID)).toBeNull();
    });
  });

  describe("update", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildTripPricing());
    });

    it("throws when the snapshot does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update(PRICING_ID, {})).rejects.toBeInstanceOf(
        TripPricingNotFoundException,
      );
    });

    it("writes only the two metadata fields", async () => {
      await service.update(PRICING_ID, {
        calculationStatus: PricingCalculationStatus.MANUAL_OVERRIDE,
        notes: "agreed with the customer",
      });

      expect(repository.update).toHaveBeenCalledWith(PRICING_ID, {
        calculationStatus: PricingCalculationStatus.MANUAL_OVERRIDE,
        notes: "agreed with the customer",
      });
    });

    it("leaves omitted fields undefined so Prisma does not touch them", async () => {
      await service.update(PRICING_ID, {
        notes: "note only",
      });

      expect(repository.update).toHaveBeenCalledWith(PRICING_ID, {
        calculationStatus: undefined,
        notes: "note only",
      });
    });

    it("passes an explicit null through so the note is cleared", async () => {
      await service.update(PRICING_ID, { notes: null });

      expect(repository.update.mock.calls[0][1].notes).toBeNull();
    });

    it("never writes a monetary or provenance field", async () => {
      await service.update(PRICING_ID, {
        calculationStatus: PricingCalculationStatus.FAILED,
      });

      const data = repository.update.mock.calls[0][1];

      expect(data).not.toHaveProperty("totalPrice");
      expect(data).not.toHaveProperty("currency");
      expect(data).not.toHaveProperty("calculatedAt");
      expect(data).not.toHaveProperty("pricingEngineVersion");
      expect(data).not.toHaveProperty("pricingRuleVersion");
      expect(data).not.toHaveProperty("tripId");
    });

    it("logs the changed field names but never their values", async () => {
      await service.update(PRICING_ID, { notes: "commercially sensitive" });

      expect(logger.log).toHaveBeenCalledWith("Pricing snapshot updated", {
        tripPricingId: PRICING_ID,
        tripId: TRIP_ID,
        changedFields: ["notes"],
      });
    });

    it("logs a status change as its own event", async () => {
      repository.update.mockResolvedValue(
        buildTripPricing({
          calculationStatus: PricingCalculationStatus.MANUAL_OVERRIDE,
        }),
      );

      await service.update(PRICING_ID, {
        calculationStatus: PricingCalculationStatus.MANUAL_OVERRIDE,
      });

      expect(logger.log).toHaveBeenCalledWith(
        "Pricing calculation status changed",
        {
          tripPricingId: PRICING_ID,
          tripId: TRIP_ID,
          fromStatus: PricingCalculationStatus.CALCULATED,
          toStatus: PricingCalculationStatus.MANUAL_OVERRIDE,
        },
      );
    });

    it("does not log a status change when the status stayed the same", async () => {
      await service.update(PRICING_ID, { notes: "just a note" });

      expect(logger.log).not.toHaveBeenCalledWith(
        "Pricing calculation status changed",
        expect.anything(),
      );
    });

    it("never re-checks the Trip, because the snapshot already exists", async () => {
      // A Trip cannot leave CLOSED, and correcting metadata must stay possible.
      await service.update(PRICING_ID, { notes: "x" });

      expect(tripService.findById).not.toHaveBeenCalled();
    });
  });

  describe("response shape", () => {
    it("renders the total as a fixed two-decimal string", async () => {
      repository.findById.mockResolvedValue(
        buildTripPricing({ totalPrice: new Prisma.Decimal("482.3") }),
      );

      expect((await service.findById(PRICING_ID)).totalPrice).toBe("482.30");
    });

    it("keeps a zero total distinct from an absent one", async () => {
      repository.findById.mockResolvedValue(
        buildTripPricing({ totalPrice: new Prisma.Decimal("0") }),
      );

      expect((await service.findById(PRICING_ID)).totalPrice).toBe("0.00");
    });

    it("exposes the stored currency", async () => {
      repository.findById.mockResolvedValue(buildTripPricing());

      expect((await service.findById(PRICING_ID)).currency).toBe("EUR");
    });
  });

  it("contains no pricing arithmetic of any kind", () => {
    // The Pricing Engine owns every formula. This module must stay a store.
    const source = TripPricingService.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("percentage");
    expect(source).not.toContain("surcharge");
    expect(source).not.toMatch(/totalPrice\s*[*+/-]/);
  });
});
