import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { resolveEffectivePricing } from "../trip-pricing/effective-pricing";
import {
  MissingRoutePricingException,
  PricingEngineErrorCode,
  TripNotPriceableException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingEngineService } from "./pricing-engine.service";
import {
  PricingRecalculationService,
  UNEXPECTED_RECALCULATION_FAILURE,
} from "./pricing-recalculation.service";
import { TripStatus } from "@prisma/client";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * The contract every dynamic-pricing write depends on.
 *
 * Three modules call this after a write — Custom Properties, waiting time and
 * Cost Confirmations — and all three answer 2xx whatever it reports. So the
 * rules below are asserted once, here, rather than three times over:
 *
 *   it NEVER throws. The write already committed and cannot be undone;
 *   success returns the complete EFFECTIVE breakdown, corrections included;
 *   failure returns pricing: null with a stable reason code — never the
 *     previous figures, which describe the Trip before the change;
 *   an expected pricing failure is a WARNING, an unexpected one an ERROR,
 *     because one is configuration to fix and the other is an incident;
 *   and one call is one calculation.
 */
describe("PricingRecalculationService", () => {
  let engine: { calculateAndStore: jest.Mock };
  let effectivePricing: { findForTrip: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let recalculation: PricingRecalculationService;

  /** A stored breakdown, as the shared effective read produces one. */
  function breakdown(
    lines: readonly { componentCode: string; amount: string }[],
    overrides: readonly { componentCode: string; amount: string }[] = [],
  ) {
    return resolveEffectivePricing(
      lines.map((line) => ({
        componentCode: line.componentCode,
        amount: new Prisma.Decimal(line.amount),
        customPropertyId: null,
        description: line.componentCode,
      })),
      overrides.map((override) => ({
        componentCode: override.componentCode,
        amount: new Prisma.Decimal(override.amount),
      })),
    );
  }

  beforeEach(() => {
    engine = {
      calculateAndStore: jest.fn().mockResolvedValue({
        tripId: TRIP_ID,
        isReprocess: true,
        lines: [],
        calculationStatus: "CALCULATED",
      }),
    };
    effectivePricing = {
      findForTrip: jest.fn().mockResolvedValue(
        breakdown([
          { componentCode: "BASE_PRICE", amount: "520.00" },
          { componentCode: "FUEL_SURCHARGE", amount: "78.00" },
          { componentCode: "TOLL", amount: "18.00" },
          { componentCode: "WAITING_TIME", amount: "30.00" },
          { componentCode: "CUSTOM_PROPERTY", amount: "100.00" },
        ]),
      ),
    };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    recalculation = new PricingRecalculationService(
      engine as unknown as PricingEngineService,
      effectivePricing as unknown as EffectivePricingService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("a successful recalculation", () => {
    it("prices the Trip again and stores the result", async () => {
      await recalculation.recalculate(TRIP_ID);

      expect(engine.calculateAndStore).toHaveBeenCalledWith(TRIP_ID);
    });

    /*
     * The Engine resolves every input of a Trip in ONE preparation, so a Trip
     * carrying five properties costs exactly what a Trip carrying one costs.
     * A caller that looped over components would produce the N+1 this asserts
     * against.
     */
    it("runs exactly one calculation per call", async () => {
      await recalculation.recalculate(TRIP_ID);

      expect(engine.calculateAndStore).toHaveBeenCalledTimes(1);
      expect(effectivePricing.findForTrip).toHaveBeenCalledTimes(1);
    });

    it("returns the eight amounts a screen reads", async () => {
      const { pricing } = await recalculation.recalculate(TRIP_ID);

      expect(pricing).toEqual(
        expect.objectContaining({
          tarief: "520.00",
          brandstof: "78.00",
          backload: "0.00",
          tol: "18.00",
          tunnel: "0.00",
          // Waiting Time plus every priced Custom Property.
          others: "130.00",
          ek: "0.00",
          totaal: "746.00",
        }),
      );
    });

    it("carries the per-component detail beside them", async () => {
      const { pricing } = await recalculation.recalculate(TRIP_ID);

      expect(pricing?.components).toContainEqual({
        componentCode: "BASE_PRICE",
        engineAmount: "520.00",
        effectiveAmount: "520.00",
        source: "ENGINE",
      });
    });

    it("reports no reason, because there is nothing to explain", async () => {
      expect((await recalculation.recalculate(TRIP_ID)).reasonCode).toBeNull();
    });

    /**
     * ── AN OPERATOR'S CORRECTION SURVIVES ──────────────────────────────────
     * Corrections live in their own table and are applied on top of the stored
     * snapshot at READ time, so replacing the snapshot cannot destroy one. The
     * Tarief stays at the corrected 620.00 and the Fuel follows it — recomputed
     * from the snapshot's own percentage, which is what keeps a closed Trip
     * historical.
     */
    it("keeps a Tarief correction, and derives Brandstof from it", async () => {
      effectivePricing.findForTrip.mockResolvedValue(
        breakdown(
          [
            { componentCode: "BASE_PRICE", amount: "520.00" },
            { componentCode: "FUEL_SURCHARGE", amount: "78.00" },
          ],
          [{ componentCode: "BASE_PRICE", amount: "620.00" }],
        ),
      );

      const { pricing } = await recalculation.recalculate(TRIP_ID);

      expect(pricing?.tarief).toBe("620.00");
      // 78 / 520 is 15%, applied to the corrected 620.
      expect(pricing?.brandstof).toBe("93.00");
      expect(pricing?.components).toContainEqual({
        componentCode: "BASE_PRICE",
        engineAmount: "520.00",
        effectiveAmount: "620.00",
        source: "OVERRIDE",
      });
    });
  });

  describe("a recalculation that could not price the Trip", () => {
    beforeEach(() => {
      engine.calculateAndStore.mockRejectedValue(
        new MissingRoutePricingException("Quay 869", "Nowhere"),
      );
    });

    it("never throws: the write it followed has already committed", async () => {
      await expect(
        recalculation.recalculate(TRIP_ID),
      ).resolves.toBeDefined();
    });

    it("returns no pricing at all, never the previous figures", async () => {
      expect((await recalculation.recalculate(TRIP_ID)).pricing).toBeNull();
      expect(effectivePricing.findForTrip).not.toHaveBeenCalled();
    });

    it("names the reason with the pricing domain's own stable code", async () => {
      expect((await recalculation.recalculate(TRIP_ID)).reasonCode).toBe(
        PricingEngineErrorCode.MISSING_ROUTE_PRICING,
      );
    });

    /*
     * Incomplete configuration, not broken software: an administrator adds the
     * route and the explicit reprocess makes the Trip current again.
     */
    it("logs it as a warning, with the code and no amount", async () => {
      await recalculation.recalculate(TRIP_ID);

      expect(logger.warn).toHaveBeenCalledWith(
        "Recalculation could not price the Trip",
        {
          tripId: TRIP_ID,
          pricingErrorCode: PricingEngineErrorCode.MISSING_ROUTE_PRICING,
        },
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("passes a Trip that is not CLOSED through the same contract", async () => {
      engine.calculateAndStore.mockRejectedValue(
        new TripNotPriceableException(
          TRIP_ID,
          TripStatus.OPEN,
          TripStatus.CLOSED,
        ),
      );

      expect(await recalculation.recalculate(TRIP_ID)).toEqual({
        pricing: null,
        reasonCode: PricingEngineErrorCode.TRIP_NOT_CLOSED,
      });
    });
  });

  describe("a recalculation that failed unexpectedly", () => {
    beforeEach(() => {
      engine.calculateAndStore.mockRejectedValue(
        new Error("database unavailable"),
      );
    });

    it("still keeps the write and still answers", async () => {
      expect(await recalculation.recalculate(TRIP_ID)).toEqual({
        pricing: null,
        reasonCode: UNEXPECTED_RECALCULATION_FAILURE,
      });
    });

    /*
     * Distinguishable from a configuration gap on purpose: this one is an
     * incident, and nothing is swallowed quietly.
     */
    it("logs it as an error rather than a warning", async () => {
      await recalculation.recalculate(TRIP_ID);

      expect(logger.error).toHaveBeenCalledWith(
        "Recalculation failed unexpectedly",
        { tripId: TRIP_ID, reason: "database unavailable" },
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
