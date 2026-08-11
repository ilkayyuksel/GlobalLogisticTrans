import { PricingCalculationStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingItemService } from "../trip-pricing-items/trip-pricing-item.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PRICING_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

describe("PricingSnapshotWriter", () => {
  let tripPricingService: { findByTripId: jest.Mock };
  let tripPricingItemService: { findByTripPricingId: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let writer: PricingSnapshotWriter;

  beforeEach(() => {
    tripPricingService = { findByTripId: jest.fn().mockResolvedValue(null) };
    tripPricingItemService = {
      findByTripPricingId: jest.fn().mockResolvedValue({ items: [] }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    writer = new PricingSnapshotWriter(
      tripPricingService as unknown as TripPricingService,
      tripPricingItemService as unknown as TripPricingItemService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("findExistingSnapshot", () => {
    it("returns null on a Trip's first calculation", async () => {
      expect(await writer.findExistingSnapshot(TRIP_ID)).toBeNull();
      expect(tripPricingItemService.findByTripPricingId).not.toHaveBeenCalled();
    });

    it("summarises the snapshot a reprocess would replace", async () => {
      tripPricingService.findByTripId.mockResolvedValue({
        id: PRICING_ID,
        totalPrice: "482.35",
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });
      tripPricingItemService.findByTripPricingId.mockResolvedValue({
        items: [{ id: "item-1" }, { id: "item-2" }, { id: "item-3" }],
      });

      expect(await writer.findExistingSnapshot(TRIP_ID)).toEqual({
        tripPricingId: PRICING_ID,
        calculationStatus: PricingCalculationStatus.CALCULATED,
        itemCount: 3,
      });
    });

    it("counts the lines of that snapshot, not of another", async () => {
      tripPricingService.findByTripId.mockResolvedValue({
        id: PRICING_ID,
        totalPrice: "482.35",
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });

      await writer.findExistingSnapshot(TRIP_ID);

      expect(tripPricingItemService.findByTripPricingId).toHaveBeenCalledWith(
        PRICING_ID,
      );
    });

    it("reports a FAILED snapshot rather than treating it as absent", async () => {
      tripPricingService.findByTripId.mockResolvedValue({
        id: PRICING_ID,
        totalPrice: "0.00",
        calculationStatus: PricingCalculationStatus.FAILED,
      });

      expect(await writer.findExistingSnapshot(TRIP_ID)).toMatchObject({
        calculationStatus: PricingCalculationStatus.FAILED,
      });
    });

    it("never logs the stored total", async () => {
      tripPricingService.findByTripId.mockResolvedValue({
        id: PRICING_ID,
        totalPrice: "482.35",
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });

      await writer.findExistingSnapshot(TRIP_ID);

      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("482.35");
      expect(logger.log).toHaveBeenCalledWith("Existing pricing snapshot found", {
        tripId: TRIP_ID,
        tripPricingId: PRICING_ID,
        calculationStatus: PricingCalculationStatus.CALCULATED,
        itemCount: 0,
      });
    });
  });

  it("writes nothing in the foundation phase", () => {
    // The boundary exists; the write lands with the calculation phases.
    const methods = Object.getOwnPropertyNames(PricingSnapshotWriter.prototype);

    expect(methods).not.toContain("write");
    expect(methods).not.toContain("replace");

    const source = PricingSnapshotWriter.prototype.constructor.toString();

    expect(source).not.toContain("tripPricingService.create");
    expect(source).not.toContain("tripPricingService.update");
    expect(source).not.toContain("tripPricingItemService.create");
    expect(source).not.toContain("tripPricingItemService.update");
  });
});
