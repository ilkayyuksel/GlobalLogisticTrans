import { NotFoundException } from "@nestjs/common";
import { PricingCalculationStatus, Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripResponseDto } from "../trips/dto/trip-response.dto";
import { TripService } from "../trips/trip.service";
import {
  MissingPricingSettingException,
  MissingRoutePricingException,
  TripNotFoundForPricingException,
  TripNotPriceableException,
} from "./exceptions/pricing-engine.exceptions";
import { PricingRuleConfiguration } from "./pricing-calculation-context";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { BasePriceCalculator } from "./base-price.calculator";
import { CombinationSurchargeCalculator } from "./combination-surcharge.calculator";
import { PricingEngineService } from "./pricing-engine.service";
import {
  PricingCalculationStep,
  PricingComponentCode,
  PricingLine,
} from "./pricing-line";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";
import { PricingStrategy } from "./pricing-settings";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PRICING_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const ROUTE_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function buildTrip(overrides: Partial<TripResponseDto> = {}): TripResponseDto {
  return {
    id: TRIP_ID,
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.CLOSED,
    bookingNumber: "BK-2026-0042",
    containerNumber: null,
    containerType: "45PH",
    terminal: "Antwerp",
    destinationCity: "Rotterdam",
    destinationCountry: "Netherlands",
    originalPlanningDate: "2026-08-17",
    planningDate: "2026-08-18",
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

const RULES: PricingRuleConfiguration = {
  strategy: PricingStrategy.ROUTE_BASED,
  fuelPercentage: "15",
  combinationSurcharge: "75",
  waitingTimeFreeMinutes: 60,
  waitingTimeBlockMinutes: 30,
};

const BASE_SOURCE = {
  strategy: PricingStrategy.ROUTE_BASED,
  routePricingId: ROUTE_ID,
  departure: "Antwerp",
  destination: "Rotterdam",
  basePrice: "380.00",
} as const;

/** Stand-in lines: the engine orchestrates steps, it does not calculate. */
const BASE_LINE: PricingLine = {
  component: PricingComponentCode.BASE_PRICE,
  description: "Antwerp - Rotterdam",
  amount: new Prisma.Decimal("380.00"),
  calculationOrder: 1,
  quantity: null,
  unitPrice: null,
};

const SECOND_LINE: PricingLine = {
  ...BASE_LINE,
  description: "a later component",
  amount: new Prisma.Decimal("57.00"),
  calculationOrder: 3,
};

describe("PricingEngineService", () => {
  let tripService: { findById: jest.Mock };
  let ruleResolver: { resolve: jest.Mock; resolveDistanceRatePerKm: jest.Mock };
  let componentResolver: {
    resolveBaseSource: jest.Mock;
    resolveActiveCustomProperties: jest.Mock;
  };
  let snapshotWriter: { findExistingSnapshot: jest.Mock };
  let firstStep: { calculate: jest.Mock };
  let secondStep: { calculate: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let engine: PricingEngineService;

  /** Rebuilds the engine with a specific ordered step list. */
  function buildEngine(steps: PricingCalculationStep[]): PricingEngineService {
    return new PricingEngineService(
      tripService as unknown as TripService,
      ruleResolver as unknown as PricingRuleResolver,
      componentResolver as unknown as PricingComponentResolver,
      snapshotWriter as unknown as PricingSnapshotWriter,
      steps,
      logger as unknown as AppLoggerService,
    );
  }

  beforeEach(() => {
    tripService = { findById: jest.fn().mockResolvedValue(buildTrip()) };
    ruleResolver = {
      resolve: jest.fn().mockResolvedValue(RULES),
      resolveDistanceRatePerKm: jest.fn(),
    };
    componentResolver = {
      resolveBaseSource: jest.fn().mockResolvedValue(BASE_SOURCE),
      resolveActiveCustomProperties: jest.fn().mockResolvedValue([]),
    };
    snapshotWriter = { findExistingSnapshot: jest.fn().mockResolvedValue(null) };
    firstStep = { calculate: jest.fn().mockReturnValue([BASE_LINE]) };
    secondStep = { calculate: jest.fn().mockReturnValue([SECOND_LINE]) };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    engine = buildEngine([firstStep]);
  });

  describe("dependency loading", () => {
    it("loads the Trip, the rules, the base source, the properties and the snapshot", async () => {
      await engine.prepareCalculation(TRIP_ID);

      expect(tripService.findById).toHaveBeenCalledWith(TRIP_ID);
      expect(ruleResolver.resolve).toHaveBeenCalledTimes(1);
      expect(componentResolver.resolveBaseSource).toHaveBeenCalledWith(
        buildTrip(),
        RULES,
      );
      expect(
        componentResolver.resolveActiveCustomProperties,
      ).toHaveBeenCalledTimes(1);
      expect(snapshotWriter.findExistingSnapshot).toHaveBeenCalledWith(TRIP_ID);
    });

    it("stops before loading anything else when the Trip is unusable", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.OPEN }),
      );

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeInstanceOf(
        TripNotPriceableException,
      );

      expect(ruleResolver.resolve).not.toHaveBeenCalled();
      expect(componentResolver.resolveBaseSource).not.toHaveBeenCalled();
      expect(snapshotWriter.findExistingSnapshot).not.toHaveBeenCalled();
    });

    it("resolves the rules before the base source, which depends on the strategy", async () => {
      const order: string[] = [];
      ruleResolver.resolve.mockImplementation(async () => {
        order.push("rules");
        return RULES;
      });
      componentResolver.resolveBaseSource.mockImplementation(async () => {
        order.push("baseSource");
        return BASE_SOURCE;
      });

      await engine.prepareCalculation(TRIP_ID);

      expect(order).toEqual(["rules", "baseSource"]);
    });
  });

  describe("missing trip", () => {
    it("translates the Trip module's 404 into a domain exception", async () => {
      tripService.findById.mockRejectedValue(new NotFoundException());

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeInstanceOf(
        TripNotFoundForPricingException,
      );
    });

    it("never lets an HTTP exception escape a domain service", async () => {
      tripService.findById.mockRejectedValue(new NotFoundException());

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.not.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("rethrows an unexpected Trip failure untouched", async () => {
      const failure = new Error("database unavailable");
      tripService.findById.mockRejectedValue(failure);

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBe(failure);
    });
  });

  describe("trip must be closed", () => {
    it.each([TripStatus.OPEN, TripStatus.CANCELLED, TripStatus.DELETED])(
      "refuses to price a %s Trip",
      async (status) => {
        tripService.findById.mockResolvedValue(buildTrip({ status }));

        await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeInstanceOf(
          TripNotPriceableException,
        );
      },
    );

    it("prices a CLOSED Trip", async () => {
      const result = await engine.prepareCalculation(TRIP_ID);

      expect(result.context.tripStatus).toBe(TripStatus.CLOSED);
    });
  });

  describe("missing configuration", () => {
    it("propagates a missing setting", async () => {
      ruleResolver.resolve.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeInstanceOf(
        MissingPricingSettingException,
      );
    });

    it("propagates missing route pricing", async () => {
      componentResolver.resolveBaseSource.mockRejectedValue(
        new MissingRoutePricingException("Antwerp", "Rotterdam"),
      );

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeInstanceOf(
        MissingRoutePricingException,
      );
    });

    it("never reports a partial context when a dependency fails", async () => {
      componentResolver.resolveBaseSource.mockRejectedValue(
        new MissingRoutePricingException("Antwerp", "Rotterdam"),
      );

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeDefined();
      expect(logger.log).not.toHaveBeenCalledWith(
        "Pricing calculation finished",
        expect.anything(),
      );
    });
  });

  describe("successful context creation", () => {
    it("carries every validated input", async () => {
      const properties = [
        { customPropertyId: "property-1", name: "TAR", defaultPrice: "35.00" },
      ];
      componentResolver.resolveActiveCustomProperties.mockResolvedValue(
        properties,
      );

      const { context } = await engine.prepareCalculation(TRIP_ID);

      expect(context).toMatchObject({
        tripId: TRIP_ID,
        bookingNumber: "BK-2026-0042",
        tripStatus: TripStatus.CLOSED,
        planningDate: "2026-08-18",
        isCombination: false,
        waitingTimeMinutes: 0,
        baseSource: BASE_SOURCE,
        rules: RULES,
        activeCustomProperties: properties,
        existingSnapshot: null,
      });
      expect(context.preparedAt).toBeInstanceOf(Date);
    });

    it("marks a grouped Trip as a Combination", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ tripGroupId: "group-1" }),
      );

      expect(
        (await engine.prepareCalculation(TRIP_ID)).context.isCombination,
      ).toBe(true);
    });

    it("treats absent waiting time as zero minutes, not as unknown", async () => {
      expect(
        (await engine.prepareCalculation(TRIP_ID)).context.waitingTimeMinutes,
      ).toBe(0);
    });

    it("carries a recorded waiting time through unchanged", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ waitingTimeMinutes: 90 }),
      );

      expect(
        (await engine.prepareCalculation(TRIP_ID)).context.waitingTimeMinutes,
      ).toBe(90);
    });

    it("reports a first calculation as not a reprocess", async () => {
      const result = await engine.prepareCalculation(TRIP_ID);

      expect(result.isReprocess).toBe(false);
      expect(result.context.existingSnapshot).toBeNull();
    });

    it("reports an existing snapshot as a reprocess", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue({
        tripPricingId: PRICING_ID,
        calculationStatus: PricingCalculationStatus.CALCULATED,
        itemCount: 4,
      });

      const result = await engine.prepareCalculation(TRIP_ID);

      expect(result.isReprocess).toBe(true);
      expect(result.context.existingSnapshot).toMatchObject({ itemCount: 4 });
    });

    it("reports a duration", async () => {
      const result = await engine.prepareCalculation(TRIP_ID);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("produces no monetary total, because nothing was calculated", async () => {
      const result = await engine.prepareCalculation(TRIP_ID);

      expect(result).not.toHaveProperty("totalPrice");
      expect(result).not.toHaveProperty("total");
      expect(result).not.toHaveProperty("items");
    });
  });

  describe("logging", () => {
    it("logs the requested, started and finished lifecycle", async () => {
      await engine.prepareCalculation(TRIP_ID);

      const messages = logger.log.mock.calls.map(([message]) => message);

      expect(messages).toEqual([
        "Pricing calculation requested",
        "Pricing calculation started",
        "Pricing calculation finished",
      ]);
    });

    it("logs a validation failure as a warning", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.OPEN }),
      );

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeDefined();

      expect(logger.warn).toHaveBeenCalledWith(
        "Pricing requested for a Trip that is not closed",
        { tripId: TRIP_ID, tripStatus: TripStatus.OPEN },
      );
    });

    it("logs the unknown-Trip failure as a warning", async () => {
      tripService.findById.mockRejectedValue(new NotFoundException());

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeDefined();

      expect(logger.warn).toHaveBeenCalledWith(
        "Pricing requested for an unknown Trip",
        { tripId: TRIP_ID },
      );
    });

    it("never logs a monetary value", async () => {
      componentResolver.resolveActiveCustomProperties.mockResolvedValue([
        { customPropertyId: "property-1", name: "TAR", defaultPrice: "35.00" },
      ]);

      await engine.prepareCalculation(TRIP_ID);

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("380.00");
      expect(logged).not.toContain("35.00");
      expect(logged).not.toContain("75");
      expect(logged).toContain(PricingStrategy.ROUTE_BASED);
    });
  });

  describe("calculate", () => {
    it("returns the preparation together with the produced lines", async () => {
      const result = await engine.calculate(TRIP_ID);

      expect(result.tripId).toBe(TRIP_ID);
      expect(result.context.baseSource).toEqual(BASE_SOURCE);
      expect(result.isReprocess).toBe(false);
      expect(result.lines).toEqual([BASE_LINE]);
    });

    it("hands each step the validated context", async () => {
      await engine.calculate(TRIP_ID);

      expect(firstStep.calculate).toHaveBeenCalledTimes(1);
      expect(firstStep.calculate.mock.calls[0][0]).toMatchObject({
        tripId: TRIP_ID,
        baseSource: BASE_SOURCE,
        rules: RULES,
      });
    });

    it("gives the first step no preceding lines", async () => {
      await engine.calculate(TRIP_ID);

      expect(firstStep.calculate.mock.calls[0][1]).toEqual([]);
    });

    it("runs steps in the configured order and accumulates their lines", async () => {
      engine = buildEngine([firstStep, secondStep]);

      const result = await engine.calculate(TRIP_ID);

      expect(result.lines).toEqual([BASE_LINE, SECOND_LINE]);
    });

    it("gives a later step what the earlier steps produced", async () => {
      // The Fuel Surcharge applies to the base price alone, so a step must be
      // able to see what came before it.
      engine = buildEngine([firstStep, secondStep]);

      await engine.calculate(TRIP_ID);

      expect(secondStep.calculate.mock.calls[0][1]).toEqual([BASE_LINE]);
    });

    it("passes a copy, so a step cannot mutate earlier lines", async () => {
      engine = buildEngine([firstStep, secondStep]);
      secondStep.calculate.mockImplementation(
        (_context: unknown, preceding: PricingLine[]) => {
          preceding.length = 0;
          return [SECOND_LINE];
        },
      );

      const result = await engine.calculate(TRIP_ID);

      expect(result.lines).toEqual([BASE_LINE, SECOND_LINE]);
    });

    it("runs no step when the Trip cannot be priced", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.OPEN }),
      );

      await expect(engine.calculate(TRIP_ID)).rejects.toBeInstanceOf(
        TripNotPriceableException,
      );
      expect(firstStep.calculate).not.toHaveBeenCalled();
    });

    it("runs no step when the configuration is incomplete", async () => {
      ruleResolver.resolve.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "PRICING_STRATEGY"),
      );

      await expect(engine.calculate(TRIP_ID)).rejects.toBeInstanceOf(
        MissingPricingSettingException,
      );
      expect(firstStep.calculate).not.toHaveBeenCalled();
    });

    it("runs no step when the route is not configured", async () => {
      componentResolver.resolveBaseSource.mockRejectedValue(
        new MissingRoutePricingException("Antwerp", "Rotterdam"),
      );

      await expect(engine.calculate(TRIP_ID)).rejects.toBeInstanceOf(
        MissingRoutePricingException,
      );
      expect(firstStep.calculate).not.toHaveBeenCalled();
    });

    it("produces no total, which belongs to a later phase", async () => {
      const result = await engine.calculate(TRIP_ID);

      expect(result).not.toHaveProperty("totalPrice");
      expect(result).not.toHaveProperty("total");
    });

    it("writes nothing", async () => {
      await engine.calculate(TRIP_ID);

      expect(snapshotWriter).not.toHaveProperty("write");
    });

    it("logs the component codes and the count, never an amount", async () => {
      await engine.calculate(TRIP_ID);

      expect(logger.log).toHaveBeenCalledWith(
        "Pricing calculation produced lines",
        {
          tripId: TRIP_ID,
          strategy: PricingStrategy.ROUTE_BASED,
          lineCount: 1,
          components: [PricingComponentCode.BASE_PRICE],
        },
      );

      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("380");
    });
  });

  /**
   * The two implemented steps wired together exactly as the module provides
   * them. This is where "does adding a phase break the previous one" is
   * actually answered.
   */
  describe("the real calculation sequence", () => {
    beforeEach(() => {
      engine = buildEngine([
        new BasePriceCalculator(logger as unknown as AppLoggerService),
        new CombinationSurchargeCalculator(
          logger as unknown as AppLoggerService,
        ),
      ]);
    });

    it("prices a normal Trip with the base price alone", async () => {
      const { lines } = await engine.calculate(TRIP_ID);

      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.BASE_PRICE,
      ]);
      expect(lines[0].amount.toFixed(2)).toBe("380.00");
    });

    it("adds the surcharge for a Combination Trip, in sequence", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ tripGroupId: "group-1" }),
      );

      const { lines } = await engine.calculate(TRIP_ID);

      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.BASE_PRICE,
        PricingComponentCode.COMBINATION,
      ]);
      expect(lines.map((line) => line.calculationOrder)).toEqual([1, 2]);
      expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
        "380.00",
        "75.00",
      ]);
    });

    it("leaves the base price untouched by the new phase", async () => {
      const normal = await engine.calculate(TRIP_ID);

      tripService.findById.mockResolvedValue(
        buildTrip({ tripGroupId: "group-1" }),
      );
      const combination = await engine.calculate(TRIP_ID);

      // Phase 2 must not have changed what Phase 1 produces.
      expect(combination.lines[0]).toEqual(normal.lines[0]);
    });

    it("still produces no total", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ tripGroupId: "group-1" }),
      );

      const result = await engine.calculate(TRIP_ID);

      expect(result).not.toHaveProperty("totalPrice");
      expect(result).not.toHaveProperty("total");
    });

    it("runs neither step when the combination setting is missing", async () => {
      // The foundation rejects it; no step re-validates the configuration.
      ruleResolver.resolve.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "COMBINATION_SURCHARGE"),
      );

      await expect(engine.calculate(TRIP_ID)).rejects.toBeInstanceOf(
        MissingPricingSettingException,
      );
    });
  });

  it("orchestrates but never calculates or writes", async () => {
    await engine.prepareCalculation(TRIP_ID);

    const source = PricingEngineService.prototype.constructor.toString();

    // Arithmetic belongs to the steps; storage belongs to a later phase.
    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("basePrice");
    expect(source).not.toContain("fuelPercentage");
    expect(source).not.toContain("Decimal");
    expect(source).not.toContain("create(");
    expect(source).not.toContain("update(");
  });
});
