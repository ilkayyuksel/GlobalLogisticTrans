import { PricingCalculationStatus, Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingItemService } from "../trip-pricing-items/trip-pricing-item.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { UnknownPricingComponentException } from "./exceptions/pricing-engine.exceptions";
import { PricingCalculationResult } from "./pricing-calculation-result";
import { PricingComponentCode, PricingLine } from "./pricing-line";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PRICING_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

const COMPONENT_IDS = new Map([
  ["BASE_PRICE", "component-base"],
  ["FUEL_SURCHARGE", "component-fuel"],
  ["TUNNEL", "component-tunnel"],
  ["CUSTOM_PROPERTY", "component-custom"],
]);

function line(overrides: Partial<PricingLine> = {}): PricingLine {
  return {
    component: PricingComponentCode.BASE_PRICE,
    description: "Antwerp - Rotterdam",
    amount: new Prisma.Decimal("380.00"),
    calculationOrder: 1,
    quantity: null,
    unitPrice: null,
    customPropertyId: null,
    ...overrides,
  };
}

function buildResult(
  lines: PricingLine[],
  overrides: Partial<PricingCalculationResult> = {},
): PricingCalculationResult {
  return {
    tripId: TRIP_ID,
    context: {} as PricingCalculationResult["context"],
    isReprocess: false,
    preparedAt: new Date("2026-08-17T09:00:00.000Z"),
    durationMs: 12,
    lines,
    totalPrice: new Prisma.Decimal("380.00"),
    calculatedAt: new Date("2026-08-17T09:00:01.000Z"),
    pricingEngineVersion: "1.0.0",
    pricingRuleVersion: "2026.1",
    calculationStatus: PricingCalculationStatus.CALCULATED,
    ...overrides,
  };
}

describe("PricingSnapshotWriter", () => {
  let tripPricingService: {
    findByTripId: jest.Mock;
    replaceSnapshot: jest.Mock;
  };
  let tripPricingItemService: {
    findByTripPricingId: jest.Mock;
    resolvePricingComponentIds: jest.Mock;
  };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let writer: PricingSnapshotWriter;

  beforeEach(() => {
    tripPricingService = {
      findByTripId: jest.fn().mockResolvedValue(null),
      replaceSnapshot: jest.fn().mockResolvedValue({
        id: PRICING_ID,
        calculationStatus: PricingCalculationStatus.CALCULATED,
      }),
    };
    tripPricingItemService = {
      findByTripPricingId: jest.fn().mockResolvedValue({ items: [] }),
      resolvePricingComponentIds: jest
        .fn()
        .mockResolvedValue(new Map(COMPONENT_IDS)),
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

  describe("writeSnapshot", () => {
    it("hands the whole snapshot to one atomic operation", async () => {
      await writer.writeSnapshot(buildResult([line()]));

      expect(tripPricingService.replaceSnapshot).toHaveBeenCalledTimes(1);
      expect(tripPricingService.replaceSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId: TRIP_ID,
          calculatedAt: new Date("2026-08-17T09:00:01.000Z"),
          pricingEngineVersion: "1.0.0",
          pricingRuleVersion: "2026.1",
          calculationStatus: PricingCalculationStatus.CALCULATED,
        }),
      );
    });

    it("passes the calculated total through untouched", async () => {
      await writer.writeSnapshot(
        buildResult([line()], { totalPrice: new Prisma.Decimal("484.50") }),
      );

      const command = tripPricingService.replaceSnapshot.mock.calls[0][0];

      expect(command.totalPrice.toFixed(2)).toBe("484.50");
      expect(Prisma.Decimal.isDecimal(command.totalPrice)).toBe(true);
    });

    /** Persistence is a mechanical mapping; no amount is recomputed. */
    it("maps every line field for field", async () => {
      await writer.writeSnapshot(
        buildResult([
          line({
            component: PricingComponentCode.CUSTOM_PROPERTY,
            description: "TAR",
            amount: new Prisma.Decimal("35.00"),
            calculationOrder: 7,
            customPropertyId: "property-tar",
          }),
        ]),
      );

      const [item] = tripPricingService.replaceSnapshot.mock.calls[0][0].items;

      expect(item).toEqual({
        pricingComponentId: "component-custom",
        customPropertyId: "property-tar",
        description: "TAR",
        amount: new Prisma.Decimal("35.00"),
        calculationOrder: 7,
        quantity: null,
        unitPrice: null,
      });
    });

    it("preserves a line's quantity and unit price", async () => {
      await writer.writeSnapshot(
        buildResult([
          line({
            quantity: new Prisma.Decimal("2"),
            unitPrice: new Prisma.Decimal("25.00"),
          }),
        ]),
      );

      const [item] = tripPricingService.replaceSnapshot.mock.calls[0][0].items;

      expect(item.quantity.toFixed(2)).toBe("2.00");
      expect(item.unitPrice.toFixed(2)).toBe("25.00");
    });

    it("stores one item per line, in order", async () => {
      await writer.writeSnapshot(
        buildResult([
          line(),
          line({
            component: PricingComponentCode.FUEL_SURCHARGE,
            calculationOrder: 3,
          }),
          line({
            component: PricingComponentCode.CUSTOM_PROPERTY,
            calculationOrder: 7,
            customPropertyId: "property-tar",
          }),
        ]),
      );

      const { items } = tripPricingService.replaceSnapshot.mock.calls[0][0];

      expect(items).toHaveLength(3);
      expect(items.map((item: { calculationOrder: number }) => item.calculationOrder)).toEqual([1, 3, 7]);
    });

    /**
     * A reference is copied, never inferred. Attaching a property to a charge
     * it did not produce would misattribute the amount on the breakdown.
     */
    it("never infers a customPropertyId", async () => {
      await writer.writeSnapshot(
        buildResult([
          line({ component: PricingComponentCode.TUNNEL, calculationOrder: 6 }),
          line({
            component: PricingComponentCode.CUSTOM_PROPERTY,
            calculationOrder: 7,
            customPropertyId: "property-flat",
          }),
        ]),
      );

      const { items } = tripPricingService.replaceSnapshot.mock.calls[0][0];

      expect(items[0].customPropertyId).toBeNull();
      expect(items[1].customPropertyId).toBe("property-flat");
    });

    describe("component identity", () => {
      it("resolves codes to catalog ids, never hardcoding a UUID", async () => {
        await writer.writeSnapshot(buildResult([line()]));

        expect(
          tripPricingItemService.resolvePricingComponentIds,
        ).toHaveBeenCalledWith(["BASE_PRICE"]);

        const source = PricingSnapshotWriter.prototype.constructor.toString();

        expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      });

      it("asks once for a breakdown that repeats a component", async () => {
        // Two fixed-price properties produce two CUSTOM_PROPERTY lines.
        await writer.writeSnapshot(
          buildResult([
            line({
              component: PricingComponentCode.CUSTOM_PROPERTY,
              calculationOrder: 7,
              customPropertyId: "property-tar",
            }),
            line({
              component: PricingComponentCode.CUSTOM_PROPERTY,
              calculationOrder: 7,
              customPropertyId: "property-flat",
            }),
          ]),
        );

        expect(
          tripPricingItemService.resolvePricingComponentIds,
        ).toHaveBeenCalledTimes(1);
        expect(
          tripPricingItemService.resolvePricingComponentIds,
        ).toHaveBeenCalledWith(["CUSTOM_PROPERTY"]);
      });

      it("resolves before writing, so the transaction holds writes only", async () => {
        const order: string[] = [];
        tripPricingItemService.resolvePricingComponentIds.mockImplementation(
          async () => {
            order.push("resolve");
            return new Map(COMPONENT_IDS);
          },
        );
        tripPricingService.replaceSnapshot.mockImplementation(async () => {
          order.push("write");
          return { id: PRICING_ID, calculationStatus: "CALCULATED" };
        });

        await writer.writeSnapshot(buildResult([line()]));

        expect(order).toEqual(["resolve", "write"]);
      });

      it("refuses a code the catalog does not hold, before writing", async () => {
        tripPricingItemService.resolvePricingComponentIds.mockResolvedValue(
          new Map(),
        );

        await expect(
          writer.writeSnapshot(buildResult([line()])),
        ).rejects.toBeInstanceOf(UnknownPricingComponentException);
        expect(tripPricingService.replaceSnapshot).not.toHaveBeenCalled();
      });

      it("names the missing component in the refusal", async () => {
        tripPricingItemService.resolvePricingComponentIds.mockResolvedValue(
          new Map(),
        );

        await expect(
          writer.writeSnapshot(buildResult([line()])),
        ).rejects.toThrow(/BASE_PRICE/);
      });
    });

    describe("logging", () => {
      it("logs identifiers and counts only", async () => {
        await writer.writeSnapshot(buildResult([line()]));

        expect(logger.log).toHaveBeenCalledWith("Pricing snapshot written", {
          tripId: TRIP_ID,
          tripPricingId: PRICING_ID,
          calculationStatus: PricingCalculationStatus.CALCULATED,
          itemCount: 1,
          isReprocess: false,
        });
      });

      it("never logs the total or a line amount", async () => {
        await writer.writeSnapshot(
          buildResult(
            [line({ amount: new Prisma.Decimal("1234.56") })],
            { totalPrice: new Prisma.Decimal("7890.12") },
          ),
        );

        const logged = JSON.stringify([
          ...logger.log.mock.calls,
          ...logger.warn.mock.calls,
        ]);

        expect(logged).not.toContain("1234.56");
        expect(logged).not.toContain("7890.12");
      });
    });
  });

  it("stores but never calculates", () => {
    const source = PricingSnapshotWriter.prototype.constructor.toString();

    // Every amount arrives already computed on the result.
    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("plus(");
    expect(source).not.toContain("mul(");
    expect(source).not.toContain("toDecimalPlaces");
  });
});
