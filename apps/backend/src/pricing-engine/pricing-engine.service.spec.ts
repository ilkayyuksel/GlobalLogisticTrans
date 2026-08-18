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
import { MissingRouteCostException } from "./exceptions/pricing-engine.exceptions";
import {
  PricingCustomPropertyInput,
  PricingRouteCostInput,
  PricingRuleConfiguration,
} from "./pricing-calculation-context";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { BasePriceCalculator } from "./base-price.calculator";
import { CombinationSurchargeCalculator } from "./combination-surcharge.calculator";
import { CustomPropertyCalculator } from "./custom-property.calculator";
import { FuelSurchargeCalculator } from "./fuel-surcharge.calculator";
import { PricingEngineService } from "./pricing-engine.service";
import { PRICING_ENGINE_VERSION } from "./pricing-engine.version";
import {
  PricingCalculationStep,
  PricingComponentCode,
  PricingLine,
} from "./pricing-line";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";
import { RouteCostResolver } from "./route-cost.resolver";
import { TollCalculator } from "./toll.calculator";
import { TunnelCalculator } from "./tunnel.calculator";
import { WaitingTimeCalculator } from "./waiting-time.calculator";
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
  customProperties: [],
    status: TripStatus.CLOSED,
    direction: null,
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
  vehicle: null,
  effectiveDriver: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

const RULES: PricingRuleConfiguration = {
  strategy: PricingStrategy.ROUTE_BASED,
  fuelPercentage: "15",
  combinationSurcharge: "75",
  automaticCustomPropertyId: "property-tar",
  waitingTimeFreeMinutes: 60,
  waitingTimeThresholdMinutes: 0,
  waitingTimeBlockMinutes: 30,
    waitingTimeBlockPrice: "25.00",
    ruleVersion: "2026.1",
};

const BASE_SOURCE = {
  strategy: PricingStrategy.ROUTE_BASED,
  routePricingId: ROUTE_ID,
  basePrice: "380.00",
} as const;

/** The Trip's route, resolved independently of the strategy. */
const ROUTE = { departure: "Antwerp", destination: "Rotterdam" } as const;

const ROUTE_COSTS = [
  {
    routeCostId: "cost-1",
    pricingComponentId: "component-toll",
    componentCode: "TOLL",
    amount: "14.25",
  },
];

/** Stand-in lines: the engine orchestrates steps, it does not calculate. */
const BASE_LINE: PricingLine = {
  component: PricingComponentCode.BASE_PRICE,
  description: "Antwerp - Rotterdam",
  amount: new Prisma.Decimal("380.00"),
  calculationOrder: 1,
  quantity: null,
  unitPrice: null,
  customPropertyId: null,
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
    resolveAssignedCustomProperties: jest.Mock;
  };
  let routeCostResolver: { resolve: jest.Mock };
  let snapshotWriter: {
    findExistingSnapshot: jest.Mock;
    writeSnapshot: jest.Mock;
  };
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
      routeCostResolver as unknown as RouteCostResolver,
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
      resolveAssignedCustomProperties: jest.fn().mockResolvedValue([]),
    };
    routeCostResolver = { resolve: jest.fn().mockResolvedValue([]) };
    snapshotWriter = {
      findExistingSnapshot: jest.fn().mockResolvedValue(null),
      writeSnapshot: jest.fn().mockResolvedValue("stored-pricing-id"),
    };
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
      // The Trip itself, not just its id: the resolver needs the group and the
      // direction to decide whether this leg carries the automatic property.
      expect(
        componentResolver.resolveAssignedCustomProperties,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ id: TRIP_ID }),
        expect.objectContaining({ automaticCustomPropertyId: "property-tar" }),
      );
      expect(routeCostResolver.resolve).toHaveBeenCalledWith(TRIP_ID, ROUTE);
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
        {
          customPropertyId: "property-1",
          name: "TAR",
          pricingComponentId: null,
          defaultPrice: "35.00",
        },
      ];
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue(
        properties,
      );
      routeCostResolver.resolve.mockResolvedValue(ROUTE_COSTS);

      const { context } = await engine.prepareCalculation(TRIP_ID);

      expect(context).toMatchObject({
        tripId: TRIP_ID,
        bookingNumber: "BK-2026-0042",
        tripStatus: TripStatus.CLOSED,
        planningDate: "2026-08-18",
        isCombination: false,
        waitingTimeMinutes: 0,
        route: ROUTE,
        baseSource: BASE_SOURCE,
        rules: RULES,
        assignedCustomProperties: properties,
        routeCosts: ROUTE_COSTS,
        existingSnapshot: null,
      });
      expect(context.preparedAt).toBeInstanceOf(Date);
    });

    /**
     * A Trip runs one route however its base price is derived, so route
     * identity is read off the Trip and never off the strategy's base source.
     */
    it("exposes the route under Distance-Based Pricing too", async () => {
      componentResolver.resolveBaseSource.mockResolvedValue({
        strategy: PricingStrategy.DISTANCE_BASED,
        distanceKm: "132.50",
        ratePerKm: "1.85",
      });

      const { context } = await engine.prepareCalculation(TRIP_ID);

      expect(context.route).toEqual(ROUTE);
    });

    it("reads the route from the Trip, not from the configured route pricing", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ terminal: "PSA Antwerp", destinationCity: "Dourges" }),
      );

      const { context } = await engine.prepareCalculation(TRIP_ID);

      expect(context.route).toEqual({
        departure: "PSA Antwerp",
        destination: "Dourges",
      });
    });

    it("carries a null departure through for a Trip with no terminal", async () => {
      // trip.terminal is nullable; a distance-priced Trip may have none.
      tripService.findById.mockResolvedValue(buildTrip({ terminal: null }));
      componentResolver.resolveBaseSource.mockResolvedValue({
        strategy: PricingStrategy.DISTANCE_BASED,
        distanceKm: "132.50",
        ratePerKm: "1.85",
      });

      const { context } = await engine.prepareCalculation(TRIP_ID);

      expect(context.route.departure).toBeNull();
      expect(context.route.destination).toBe("Rotterdam");
    });

    it("accepts a route with no costs configured, which is not an error", async () => {
      routeCostResolver.resolve.mockResolvedValue([]);

      const { context } = await engine.prepareCalculation(TRIP_ID);

      expect(context.routeCosts).toEqual([]);
    });
  });

  /**
   * A property linked to a Pricing Component declares only that the component
   * APPLIES; its amount lives in the route cost configuration. Assigned but
   * unpriced is a configuration error, not a Trip that owes nothing.
   *
   * The rule names no component, so it holds for Toll, for Tunnel and for any
   * route-priced component added later.
   */
  describe("route-priced properties must have a route cost", () => {
    const TOLL_PROPERTY = {
      customPropertyId: "property-toll",
      name: "Toll",
      pricingComponentId: "component-toll",
      defaultPrice: null,
    };

    const FLAT_PROPERTY = {
      customPropertyId: "property-flat",
      name: "Flat",
      pricingComponentId: null,
      defaultPrice: "50.00",
    };

    it("refuses the calculation when the matching cost is missing", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        TOLL_PROPERTY,
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeInstanceOf(
        MissingRouteCostException,
      );
    });

    it("refuses before any calculation step runs", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        TOLL_PROPERTY,
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(engine.calculate(TRIP_ID)).rejects.toBeInstanceOf(
        MissingRouteCostException,
      );
      expect(firstStep.calculate).not.toHaveBeenCalled();
    });

    it("refuses rather than pricing the component at zero", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        TOLL_PROPERTY,
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(engine.calculate(TRIP_ID)).rejects.toThrow();
    });

    it("names the component and the route so the gap can be configured", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        TOLL_PROPERTY,
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toThrow(
        /component-toll/,
      );
      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toThrow(
        /Antwerp/,
      );
    });

    it("accepts a fixed-price property, which needs no route cost", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        FLAT_PROPERTY,
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(
        engine.prepareCalculation(TRIP_ID),
      ).resolves.toBeDefined();
    });

    it("accepts a route cost that no assigned property claims", async () => {
      // A route may have a toll configured that this Trip simply does not owe.
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([]);
      routeCostResolver.resolve.mockResolvedValue(ROUTE_COSTS);

      await expect(
        engine.prepareCalculation(TRIP_ID),
      ).resolves.toBeDefined();
    });

    it("accepts a matched pair", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        TOLL_PROPERTY,
      ]);
      routeCostResolver.resolve.mockResolvedValue([
        {
          routeCostId: "cost-1",
          pricingComponentId: "component-toll",
          componentCode: "TOLL",
          amount: "9.75",
        },
      ]);

      await expect(
        engine.prepareCalculation(TRIP_ID),
      ).resolves.toBeDefined();
    });

    it("checks every assigned property, not only the first", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        FLAT_PROPERTY,
        TOLL_PROPERTY,
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toBeInstanceOf(
        MissingRouteCostException,
      );
    });

    it("logs identifiers only when refusing", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        { ...TOLL_PROPERTY, defaultPrice: "1234.56" },
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(engine.prepareCalculation(TRIP_ID)).rejects.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        "Route-priced custom property has no route cost",
        {
          tripId: TRIP_ID,
          customPropertyId: "property-toll",
          pricingComponentId: "component-toll",
        },
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("1234.56");
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
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        {
          customPropertyId: "property-1",
          name: "TAR",
          pricingComponentId: null,
          defaultPrice: "35.00",
        },
      ]);
      routeCostResolver.resolve.mockResolvedValue(ROUTE_COSTS);

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

    it("produces a total alongside the lines", async () => {
      const result = await engine.calculate(TRIP_ID);

      expect(result.totalPrice.toFixed(2)).toBe("380.00");
    });

    /** Calculating and storing stay separate operations. */
    it("writes nothing", async () => {
      await engine.calculate(TRIP_ID);

      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
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
   * Every implemented step wired together exactly as the module provides them,
   * in the module's order. This is where "does adding a phase break the
   * previous one" is actually answered.
   */
  describe("the real calculation sequence", () => {
    beforeEach(() => {
      engine = buildEngine([
        new BasePriceCalculator(logger as unknown as AppLoggerService),
        new CombinationSurchargeCalculator(
          logger as unknown as AppLoggerService,
        ),
        new FuelSurchargeCalculator(logger as unknown as AppLoggerService),
        new WaitingTimeCalculator(logger as unknown as AppLoggerService),
        new TollCalculator(logger as unknown as AppLoggerService),
        new TunnelCalculator(logger as unknown as AppLoggerService),
        new CustomPropertyCalculator(logger as unknown as AppLoggerService),
      ]);
    });

    it("prices a normal Trip with the base price and fuel", async () => {
      const { lines } = await engine.calculate(TRIP_ID);

      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.BASE_PRICE,
        PricingComponentCode.FUEL_SURCHARGE,
      ]);
      expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
        "380.00",
        "57.00",
      ]);
    });

    it("adds the surcharge for a Combination Trip, in sequence", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ tripGroupId: "group-1" }),
      );

      const { lines } = await engine.calculate(TRIP_ID);

      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.BASE_PRICE,
        PricingComponentCode.COMBINATION,
        PricingComponentCode.FUEL_SURCHARGE,
      ]);
      expect(lines.map((line) => line.calculationOrder)).toEqual([1, 2, 3]);
      expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
        "380.00",
        "75.00",
        "57.00",
      ]);
    });

    it("charges fuel on the base price only, never on the combination", async () => {
      // 15% of 380 is 57.00. 15% of 380 + 75 would be 68.25.
      tripService.findById.mockResolvedValue(
        buildTrip({ tripGroupId: "group-1" }),
      );

      const { lines } = await engine.calculate(TRIP_ID);
      const fuel = lines.find(
        (line) => line.component === PricingComponentCode.FUEL_SURCHARGE,
      );

      expect(fuel?.amount.toFixed(2)).toBe("57.00");
    });

    it("leaves the base price untouched by the new phase", async () => {
      const normal = await engine.calculate(TRIP_ID);

      tripService.findById.mockResolvedValue(
        buildTrip({ tripGroupId: "group-1" }),
      );
      const combination = await engine.calculate(TRIP_ID);

      // Later phases must not have changed what Phase 1 produces.
      expect(combination.lines[0]).toEqual(normal.lines[0]);
    });

    it("adds waiting time when the Trip waited beyond the free allowance", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ waitingTimeMinutes: 90 }),
      );

      const { lines } = await engine.calculate(TRIP_ID);

      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.BASE_PRICE,
        PricingComponentCode.FUEL_SURCHARGE,
        PricingComponentCode.WAITING_TIME,
      ]);
      expect(lines.map((line) => line.calculationOrder)).toEqual([1, 3, 4]);
      expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
        "380.00",
        "57.00",
        "25.00",
      ]);
    });

    it("charges fuel on the base price only, never on the waiting time", async () => {
      // 15% of 380 is 57.00. 15% of 380 + 25 would be 60.75.
      tripService.findById.mockResolvedValue(
        buildTrip({ waitingTimeMinutes: 90 }),
      );

      const { lines } = await engine.calculate(TRIP_ID);
      const fuel = lines.find(
        (line) => line.component === PricingComponentCode.FUEL_SURCHARGE,
      );

      expect(fuel?.amount.toFixed(2)).toBe("57.00");
    });

    it("produces the full documented sequence for a Combination that waited", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ tripGroupId: "group-1", waitingTimeMinutes: 105 }),
      );

      const { lines } = await engine.calculate(TRIP_ID);

      expect(lines.map((line) => line.calculationOrder)).toEqual([1, 2, 3, 4]);
      expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
        "380.00",
        "75.00",
        "57.00",
        "50.00",
      ]);
    });

    /**
     * Toll and Tunnel are route-dependent: the Trip's assignment decides that
     * they apply, the route's cost decides how much.
     */
    describe("the route-dependent components", () => {
      const TOLL_COMPONENT_ID = "component-toll";
      const TUNNEL_COMPONENT_ID = "component-tunnel";

      const TOLL_PROPERTY = {
        customPropertyId: "property-toll",
        name: "Toll",
        pricingComponentId: TOLL_COMPONENT_ID,
        defaultPrice: null,
      };

      const TUNNEL_PROPERTY = {
        customPropertyId: "property-tunnel",
        name: "Tunnel",
        pricingComponentId: TUNNEL_COMPONENT_ID,
        defaultPrice: null,
      };

      const TOLL_ROUTE_COST = {
        routeCostId: "cost-toll",
        pricingComponentId: TOLL_COMPONENT_ID,
        componentCode: "TOLL",
        amount: "9.75",
      };

      const TUNNEL_ROUTE_COST = {
        routeCostId: "cost-tunnel",
        pricingComponentId: TUNNEL_COMPONENT_ID,
        componentCode: "TUNNEL",
        amount: "12.50",
      };

      function assign(
        properties: PricingCustomPropertyInput[],
        costs: PricingRouteCostInput[],
      ) {
        componentResolver.resolveAssignedCustomProperties.mockResolvedValue(
          properties,
        );
        routeCostResolver.resolve.mockResolvedValue(costs);
      }

      it("produces no Tunnel line without the assignment", async () => {
        assign([], [TUNNEL_ROUTE_COST]);

        const { lines } = await engine.calculate(TRIP_ID);

        expect(lines.map((line) => line.component)).toEqual([
          PricingComponentCode.BASE_PRICE,
          PricingComponentCode.FUEL_SURCHARGE,
        ]);
      });

      it("produces exactly one Tunnel line when both halves are present", async () => {
        assign([TUNNEL_PROPERTY], [TUNNEL_ROUTE_COST]);

        const { lines } = await engine.calculate(TRIP_ID);
        const tunnel = lines.filter(
          (line) => line.component === PricingComponentCode.TUNNEL,
        );

        expect(tunnel).toHaveLength(1);
        expect(tunnel[0].amount.toFixed(2)).toBe("12.50");
        expect(tunnel[0].calculationOrder).toBe(6);
        expect(tunnel[0].description).toBe("Tunnel");
      });

      it("refuses when the Tunnel cost is missing entirely", async () => {
        assign([TUNNEL_PROPERTY], []);

        await expect(engine.calculate(TRIP_ID)).rejects.toMatchObject({
          code: "PRICING_MISSING_ROUTE_COST",
        });
      });

      /**
       * The resolver returns only ACTIVE costs, so a deactivated one reaches
       * the Engine as an absent one — and must be refused just the same.
       */
      it("refuses when the Tunnel cost has been deactivated", async () => {
        assign([TUNNEL_PROPERTY], [TOLL_ROUTE_COST]);

        await expect(engine.calculate(TRIP_ID)).rejects.toMatchObject({
          code: "PRICING_MISSING_ROUTE_COST",
        });
      });

      it("never mistakes the Toll cost for the Tunnel", async () => {
        assign([TOLL_PROPERTY], [TOLL_ROUTE_COST, TUNNEL_ROUTE_COST]);

        const { lines } = await engine.calculate(TRIP_ID);

        expect(lines.map((line) => line.component)).not.toContain(
          PricingComponentCode.TUNNEL,
        );
        expect(lines.map((line) => line.component)).toContain(
          PricingComponentCode.TOLL,
        );
      });

      it("produces the full documented sequence when everything applies", async () => {
        tripService.findById.mockResolvedValue(
          buildTrip({ tripGroupId: "group-1", waitingTimeMinutes: 105 }),
        );
        assign(
          [TOLL_PROPERTY, TUNNEL_PROPERTY],
          [TOLL_ROUTE_COST, TUNNEL_ROUTE_COST],
        );

        const { lines } = await engine.calculate(TRIP_ID);

        expect(lines.map((line) => line.component)).toEqual([
          PricingComponentCode.BASE_PRICE,
          PricingComponentCode.COMBINATION,
          PricingComponentCode.FUEL_SURCHARGE,
          PricingComponentCode.WAITING_TIME,
          PricingComponentCode.TOLL,
          PricingComponentCode.TUNNEL,
        ]);
        expect(lines.map((line) => line.calculationOrder)).toEqual([
          1, 2, 3, 4, 5, 6,
        ]);
        expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
          "380.00",
          "75.00",
          "57.00",
          "50.00",
          "9.75",
          "12.50",
        ]);
      });

      it("charges fuel on the base price only, never on toll or tunnel", async () => {
        assign(
          [TOLL_PROPERTY, TUNNEL_PROPERTY],
          [TOLL_ROUTE_COST, TUNNEL_ROUTE_COST],
        );

        const { lines } = await engine.calculate(TRIP_ID);
        const fuel = lines.find(
          (line) => line.component === PricingComponentCode.FUEL_SURCHARGE,
        );

        // 15% of 380.00, untouched by the 9.75 and 12.50 that follow it.
        expect(fuel?.amount.toFixed(2)).toBe("57.00");
      });

      /**
       * The seventh step prices the properties that carry their own amount.
       * Toll and Tunnel properties are excluded because they are linked, not
       * because they are named anywhere.
       */
      describe("fixed-price custom properties", () => {
        const TAR = {
          customPropertyId: "property-tar",
          name: "TAR",
          pricingComponentId: null,
          defaultPrice: "35.00",
        };

        const FLAT = {
          customPropertyId: "property-flat",
          name: "Flat",
          pricingComponentId: null,
          defaultPrice: "50.00",
        };

        it("adds one line at order 7 for a fixed-price property", async () => {
          assign([TAR], []);

          const { lines } = await engine.calculate(TRIP_ID);
          const custom = lines.filter(
            (line) => line.component === PricingComponentCode.CUSTOM_PROPERTY,
          );

          expect(custom).toHaveLength(1);
          expect(custom[0].calculationOrder).toBe(7);
          expect(custom[0].amount.toFixed(2)).toBe("35.00");
          expect(custom[0].customPropertyId).toBe("property-tar");
          expect(custom[0].description).toBe("TAR");
        });

        it("adds one line per property, after the route-dependent ones", async () => {
          assign(
            [TAR, TUNNEL_PROPERTY, FLAT],
            [TUNNEL_ROUTE_COST],
          );

          const { lines } = await engine.calculate(TRIP_ID);

          expect(lines.map((line) => line.component)).toEqual([
            PricingComponentCode.BASE_PRICE,
            PricingComponentCode.FUEL_SURCHARGE,
            PricingComponentCode.TUNNEL,
            PricingComponentCode.CUSTOM_PROPERTY,
            PricingComponentCode.CUSTOM_PROPERTY,
          ]);
          expect(lines.map((line) => line.calculationOrder)).toEqual([
            1, 3, 6, 7, 7,
          ]);
          expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
            "380.00",
            "57.00",
            "12.50",
            "35.00",
            "50.00",
          ]);
        });

        it("produces no CUSTOM_PROPERTY line for a Tunnel assignment", async () => {
          assign([TUNNEL_PROPERTY], [TUNNEL_ROUTE_COST]);

          const { lines } = await engine.calculate(TRIP_ID);

          expect(lines.map((line) => line.component)).not.toContain(
            PricingComponentCode.CUSTOM_PROPERTY,
          );
        });

        it("refuses the whole calculation for an unpriced property", async () => {
          assign([{ ...TAR, defaultPrice: null }], []);

          await expect(engine.calculate(TRIP_ID)).rejects.toMatchObject({
            code: "PRICING_MISSING_CUSTOM_PROPERTY_PRICE",
          });
        });

        it("charges fuel on the base price only, never on a property", async () => {
          assign([TAR, FLAT], []);

          const { lines } = await engine.calculate(TRIP_ID);
          const fuel = lines.find(
            (line) => line.component === PricingComponentCode.FUEL_SURCHARGE,
          );

          expect(fuel?.amount.toFixed(2)).toBe("57.00");
        });

        it("produces the whole documented sequence, all seven components", async () => {
          tripService.findById.mockResolvedValue(
            buildTrip({ tripGroupId: "group-1", waitingTimeMinutes: 105 }),
          );
          assign(
            [TOLL_PROPERTY, TUNNEL_PROPERTY, TAR],
            [TOLL_ROUTE_COST, TUNNEL_ROUTE_COST],
          );

          const { lines } = await engine.calculate(TRIP_ID);

          expect(lines.map((line) => line.component)).toEqual([
            PricingComponentCode.BASE_PRICE,
            PricingComponentCode.COMBINATION,
            PricingComponentCode.FUEL_SURCHARGE,
            PricingComponentCode.WAITING_TIME,
            PricingComponentCode.TOLL,
            PricingComponentCode.TUNNEL,
            PricingComponentCode.CUSTOM_PROPERTY,
          ]);
          expect(lines.map((line) => line.calculationOrder)).toEqual([
            1, 2, 3, 4, 5, 6, 7,
          ]);
        });

        it("carries a property reference only on the property lines", async () => {
          assign([TOLL_PROPERTY, TAR], [TOLL_ROUTE_COST]);

          const { lines } = await engine.calculate(TRIP_ID);

          const referenced = lines.filter(
            (line) => line.customPropertyId !== null,
          );

          expect(referenced).toHaveLength(1);
          expect(referenced[0].component).toBe(
            PricingComponentCode.CUSTOM_PROPERTY,
          );
        });
      });

      it("leaves the earlier phases identical whether or not tunnel applies", async () => {
        assign([], []);
        const without = await engine.calculate(TRIP_ID);

        assign([TUNNEL_PROPERTY], [TUNNEL_ROUTE_COST]);
        const with_ = await engine.calculate(TRIP_ID);

        const earlier = (result: { lines: readonly PricingLine[] }) =>
          result.lines
            .filter((line) => line.calculationOrder < 5)
            .map((line) => `${line.component}=${line.amount.toFixed(2)}`);

        expect(earlier(with_)).toEqual(earlier(without));
      });
    });

    /**
     * The Final Total is the exact Decimal sum of the already-rounded line
     * amounts and nothing else. No component is recalculated to produce it.
     */
    describe("the final total", () => {
      it("is the sum of the produced lines", async () => {
        const { lines, totalPrice } = await engine.calculate(TRIP_ID);

        expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
          "380.00",
          "57.00",
        ]);
        expect(totalPrice.toFixed(2)).toBe("437.00");
      });

      it("is a Decimal, never a JavaScript number", async () => {
        const { totalPrice } = await engine.calculate(TRIP_ID);

        expect(Prisma.Decimal.isDecimal(totalPrice)).toBe(true);
      });

      it("equals the sum recomputed from the lines themselves", async () => {
        tripService.findById.mockResolvedValue(
          buildTrip({ tripGroupId: "group-1", waitingTimeMinutes: 105 }),
        );

        const { lines, totalPrice } = await engine.calculate(TRIP_ID);
        const recomputed = lines.reduce(
          (running, line) => running.plus(line.amount),
          new Prisma.Decimal(0),
        );

        expect(totalPrice.equals(recomputed)).toBe(true);
      });

      it("includes every component when all seven apply", async () => {
        tripService.findById.mockResolvedValue(
          buildTrip({ tripGroupId: "group-1", waitingTimeMinutes: 105 }),
        );
        componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
          {
            customPropertyId: "property-toll",
            name: "Toll",
            pricingComponentId: "component-toll",
            defaultPrice: null,
          },
          {
            customPropertyId: "property-tunnel",
            name: "Tunnel",
            pricingComponentId: "component-tunnel",
            defaultPrice: null,
          },
          {
            customPropertyId: "property-tar",
            name: "TAR",
            pricingComponentId: null,
            defaultPrice: "35.00",
          },
        ]);
        routeCostResolver.resolve.mockResolvedValue([
          {
            routeCostId: "cost-toll",
            pricingComponentId: "component-toll",
            componentCode: "TOLL",
            amount: "9.75",
          },
          {
            routeCostId: "cost-tunnel",
            pricingComponentId: "component-tunnel",
            componentCode: "TUNNEL",
            amount: "12.50",
          },
        ]);

        const { totalPrice } = await engine.calculate(TRIP_ID);

        // 380 + 75 + 57 + 50 + 9.75 + 12.50 + 35
        expect(totalPrice.toFixed(2)).toBe("619.25");
      });

      it("counts a zero-amount line without changing the total", async () => {
        componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
          {
            customPropertyId: "property-free",
            name: "Included",
            pricingComponentId: null,
            defaultPrice: "0.00",
          },
        ]);

        const { lines, totalPrice } = await engine.calculate(TRIP_ID);

        expect(lines).toHaveLength(3);
        expect(totalPrice.toFixed(2)).toBe("437.00");
      });

      it("includes every one of several fixed-price properties", async () => {
        componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
          {
            customPropertyId: "property-tar",
            name: "TAR",
            pricingComponentId: null,
            defaultPrice: "35.00",
          },
          {
            customPropertyId: "property-detour",
            name: "Over Sint-Niklaas",
            pricingComponentId: null,
            defaultPrice: "27.50",
          },
        ]);

        const { totalPrice } = await engine.calculate(TRIP_ID);

        expect(totalPrice.toFixed(2)).toBe("499.50");
      });
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

  /**
   * `trip_pricing.total_price` carries a non-negative CHECK. Refusing before
   * the transaction opens names the pricing concept instead of surfacing a
   * constraint violation. It is a persistence guard, not a pricing rule.
   */
  describe("a total below zero", () => {
    function withNegativeLine() {
      firstStep.calculate.mockReturnValue([
        { ...BASE_LINE, amount: new Prisma.Decimal("-10.00") },
      ]);
      return buildEngine([firstStep as unknown as PricingCalculationStep]);
    }

    it("is refused rather than left to the database", async () => {
      await expect(withNegativeLine().calculate(TRIP_ID)).rejects.toMatchObject(
        { code: "PRICING_NEGATIVE_TOTAL" },
      );
    });

    it("is never stored", async () => {
      await expect(
        withNegativeLine().calculateAndStore(TRIP_ID),
      ).rejects.toThrow();
      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });

    it("accepts a total of exactly zero, which is not negative", async () => {
      firstStep.calculate.mockReturnValue([
        { ...BASE_LINE, amount: new Prisma.Decimal("0.00") },
      ]);

      const { totalPrice } = await buildEngine([
        firstStep as unknown as PricingCalculationStep,
      ]).calculate(TRIP_ID);

      expect(totalPrice.toFixed(2)).toBe("0.00");
    });

    it("names no amount in the refusal", async () => {
      await expect(withNegativeLine().calculate(TRIP_ID)).rejects.not.toThrow(
        /10\.00/,
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("-10.00");
    });
  });

  describe("the complete result", () => {
    it("carries everything a snapshot needs", async () => {
      const result = await engine.calculate(TRIP_ID);

      expect(result.tripId).toBe(TRIP_ID);
      expect(result.pricingEngineVersion).toBe(PRICING_ENGINE_VERSION);
      expect(result.pricingRuleVersion).toBe("2026.1");
      expect(result.calculationStatus).toBe(
        PricingCalculationStatus.CALCULATED,
      );
      expect(result.calculatedAt).toBeInstanceOf(Date);
      expect(result.isReprocess).toBe(false);
      expect(result.lines).toBeDefined();
      expect(result.totalPrice).toBeDefined();
    });

    it("takes the rule version from the configured Settings, not from code", async () => {
      ruleResolver.resolve.mockResolvedValue({
        ...RULES,
        ruleVersion: "2027.4",
      });

      expect((await engine.calculate(TRIP_ID)).pricingRuleVersion).toBe(
        "2027.4",
      );
    });

    it("reports a reprocess when a snapshot already exists", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue({
        tripPricingId: "existing-1",
        calculationStatus: PricingCalculationStatus.CALCULATED,
        itemCount: 4,
      });

      expect((await engine.calculate(TRIP_ID)).isReprocess).toBe(true);
    });
  });

  describe("calculateAndStore", () => {
    it("calculates, then hands the finished result to the writer", async () => {
      const result = await engine.calculateAndStore(TRIP_ID);

      expect(snapshotWriter.writeSnapshot).toHaveBeenCalledTimes(1);
      expect(snapshotWriter.writeSnapshot).toHaveBeenCalledWith(result);
    });

    it("returns the same result `calculate` would have", async () => {
      const stored = await engine.calculateAndStore(TRIP_ID);

      expect(stored.lines).toEqual([BASE_LINE]);
      expect(stored.totalPrice.toFixed(2)).toBe("380.00");
    });

    it("writes nothing when the calculation is refused", async () => {
      ruleResolver.resolve.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

      await expect(engine.calculateAndStore(TRIP_ID)).rejects.toThrow();
      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });

    it("writes nothing when a route cost is missing", async () => {
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        {
          customPropertyId: "property-toll",
          name: "Toll",
          pricingComponentId: "component-toll",
          defaultPrice: null,
        },
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(engine.calculateAndStore(TRIP_ID)).rejects.toThrow();
      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });

    it("propagates a persistence failure rather than reporting success", async () => {
      const failure = new Error("transaction rolled back");
      snapshotWriter.writeSnapshot.mockRejectedValue(failure);

      await expect(engine.calculateAndStore(TRIP_ID)).rejects.toBe(failure);
    });

    it("logs identifiers and counts only", async () => {
      await engine.calculateAndStore(TRIP_ID);

      expect(logger.log).toHaveBeenCalledWith("Pricing calculation stored", {
        tripId: TRIP_ID,
        isReprocess: false,
        lineCount: 1,
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("380.00");
    });

    /** Calculation and persistence stay separate operations. */
    it("leaves `calculate` free of any write", async () => {
      await engine.calculate(TRIP_ID);

      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });
  });

  /**
   * Reprocess is `calculateAndStore` with one extra precondition: something
   * must already be there to replace. Every other rule comes from `calculate`,
   * so the two operations cannot drift apart.
   */
  describe("reprocess", () => {
    const EXISTING_SNAPSHOT = {
      tripPricingId: "existing-1",
      calculationStatus: PricingCalculationStatus.CALCULATED,
      itemCount: 4,
    };

    it("recalculates and stores when a snapshot exists", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);

      const result = await engine.reprocess(TRIP_ID);

      expect(result.isReprocess).toBe(true);
      expect(snapshotWriter.writeSnapshot).toHaveBeenCalledWith(result);
    });

    /**
     * The recovery path. Automatic pricing runs once, on OPEN -> CLOSED, and
     * CLOSED is terminal — so a Trip whose automatic pricing failed could never
     * be priced again if this operation insisted a snapshot already existed.
     */
    it("calculates the first snapshot when the Trip has none", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(null);

      const result = await engine.reprocess(TRIP_ID);

      expect(result.isReprocess).toBe(false);
      expect(snapshotWriter.writeSnapshot).toHaveBeenCalledWith(result);
    });

    it("stores through the same path in both states", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(null);
      const first = await engine.reprocess(TRIP_ID);

      snapshotWriter.writeSnapshot.mockClear();
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);
      const replacement = await engine.reprocess(TRIP_ID);

      // One write operation, whichever state the Trip was in.
      expect(first.totalPrice.equals(replacement.totalPrice)).toBe(true);
      expect(snapshotWriter.writeSnapshot).toHaveBeenCalledTimes(1);
    });

    it.each([
      [true, "Replacing the Trip's existing pricing snapshot"],
      [false, "Calculating the Trip's first pricing snapshot"],
    ])(
      "logs the two states apart (hasExistingSnapshot=%p)",
      async (hasExisting, message) => {
        snapshotWriter.findExistingSnapshot.mockResolvedValue(
          hasExisting ? EXISTING_SNAPSHOT : null,
        );

        await engine.reprocess(TRIP_ID);

        expect(logger.log).toHaveBeenCalledWith(message, {
          tripId: TRIP_ID,
          hasExistingSnapshot: hasExisting,
        });
      },
    );

    it("still rejects a Trip that is not CLOSED, in either state", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(null);
      tripService.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CANCELLED }),
      );

      await expect(engine.reprocess(TRIP_ID)).rejects.toBeInstanceOf(
        TripNotPriceableException,
      );
      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });

    it("applies every precondition `calculate` applies", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);
      tripService.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.OPEN }),
      );

      await expect(engine.reprocess(TRIP_ID)).rejects.toBeInstanceOf(
        TripNotPriceableException,
      );
      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });

    it("leaves the old snapshot alone when the configuration is unusable", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);
      ruleResolver.resolve.mockRejectedValue(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

      await expect(engine.reprocess(TRIP_ID)).rejects.toBeInstanceOf(
        MissingPricingSettingException,
      );
      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });

    it("leaves the old snapshot alone when a route cost is missing", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        {
          customPropertyId: "property-toll",
          name: "Toll",
          pricingComponentId: "component-toll",
          defaultPrice: null,
        },
      ]);
      routeCostResolver.resolve.mockResolvedValue([]);

      await expect(engine.reprocess(TRIP_ID)).rejects.toMatchObject({
        code: "PRICING_MISSING_ROUTE_COST",
      });
      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });

    it("leaves the old snapshot alone when a property has no price", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);
      engine = buildEngine([
        new CustomPropertyCalculator(logger as unknown as AppLoggerService),
      ]);
      componentResolver.resolveAssignedCustomProperties.mockResolvedValue([
        {
          customPropertyId: "property-unpriced",
          name: "Unpriced",
          pricingComponentId: null,
          defaultPrice: null,
        },
      ]);

      await expect(engine.reprocess(TRIP_ID)).rejects.toMatchObject({
        code: "PRICING_MISSING_CUSTOM_PROPERTY_PRICE",
      });
      expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
    });

    it("propagates a persistence failure without reporting success", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);
      const failure = new Error("transaction rolled back");
      snapshotWriter.writeSnapshot.mockRejectedValue(failure);

      await expect(engine.reprocess(TRIP_ID)).rejects.toBe(failure);
    });

    it("never removes the old snapshot before calculating", async () => {
      // The only write is the atomic replacement, which happens last. The old
      // snapshot is read, never discarded up front.
      const order: string[] = [];
      snapshotWriter.findExistingSnapshot.mockImplementation(async () => {
        order.push("read-existing");
        return EXISTING_SNAPSHOT;
      });
      snapshotWriter.writeSnapshot.mockImplementation(async () => {
        order.push("write");
        return "stored-pricing-id";
      });

      await engine.reprocess(TRIP_ID);

      expect(order).toEqual(["read-existing", "write"]);
      expect(Object.keys(snapshotWriter)).toEqual([
        "findExistingSnapshot",
        "writeSnapshot",
      ]);
    });

    it("stamps the current versions and status onto the new result", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);
      ruleResolver.resolve.mockResolvedValue({
        ...RULES,
        ruleVersion: "2027.9",
      });

      const result = await engine.reprocess(TRIP_ID);

      expect(result.pricingRuleVersion).toBe("2027.9");
      expect(result.pricingEngineVersion).toBe(PRICING_ENGINE_VERSION);
      expect(result.calculationStatus).toBe(
        PricingCalculationStatus.CALCULATED,
      );
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    it("uses the configuration current at reprocess time", async () => {
      // A real calculator, so a changed base price actually reaches the line.
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);
      componentResolver.resolveBaseSource.mockResolvedValue({
        ...BASE_SOURCE,
        basePrice: "400.00",
      });

      const result = await buildEngine([
        new BasePriceCalculator(logger as unknown as AppLoggerService),
      ]).reprocess(TRIP_ID);

      expect(result.lines[0].amount.toFixed(2)).toBe("400.00");
      expect(result.totalPrice.toFixed(2)).toBe("400.00");
    });

    it("logs the request and the store, with identifiers only", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(EXISTING_SNAPSHOT);

      await engine.reprocess(TRIP_ID);

      expect(logger.log).toHaveBeenCalledWith("Pricing reprocess requested", {
        tripId: TRIP_ID,
      });
      expect(logger.log).toHaveBeenCalledWith("Pricing calculation stored", {
        tripId: TRIP_ID,
        isReprocess: true,
        lineCount: 1,
        calculationStatus: PricingCalculationStatus.CALCULATED,
      });
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("380.00");
    });

    it("logs no amount on the recovery path either", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue(null);

      await engine.reprocess(TRIP_ID);

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("380.00");
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
