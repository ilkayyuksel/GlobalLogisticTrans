import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  BASE_PRICE_CALCULATION_ORDER,
  BasePriceCalculator,
} from "./base-price.calculator";
import {
  PricingBaseSource,
  PricingCalculationContext,
} from "./pricing-calculation-context";
import { PricingComponentCode } from "./pricing-line";
import { PricingStrategy } from "./pricing-settings";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function buildContext(baseSource: PricingBaseSource): PricingCalculationContext {
  return {
    tripId: TRIP_ID,
    bookingNumber: "BK-2026-0042",
    tripStatus: TripStatus.CLOSED,
    planningDate: "2026-08-17",
    isCombination: false,
    waitingTimeMinutes: 0,
    baseSource,
    rules: {
      strategy: baseSource.strategy,
      fuelPercentage: "15",
      combinationSurcharge: "75",
      waitingTimeFreeMinutes: 60,
      waitingTimeBlockMinutes: 30,
    },
    activeCustomProperties: [],
    existingSnapshot: null,
    preparedAt: new Date("2026-08-17T09:00:00.000Z"),
  };
}

function routeSource(basePrice: string): PricingBaseSource {
  return {
    strategy: PricingStrategy.ROUTE_BASED,
    routePricingId: "route-1",
    departure: "Antwerp",
    destination: "Rotterdam",
    basePrice,
  };
}

function distanceSource(
  distanceKm: string,
  ratePerKm: string,
): PricingBaseSource {
  return { strategy: PricingStrategy.DISTANCE_BASED, distanceKm, ratePerKm };
}

describe("BasePriceCalculator", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let calculator: BasePriceCalculator;

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    calculator = new BasePriceCalculator(logger as unknown as AppLoggerService);
  });

  describe("route-based pricing", () => {
    it("uses the configured route price as the base price", () => {
      const [line] = calculator.calculate(buildContext(routeSource("380.00")));

      expect(line.amount.toFixed(2)).toBe("380.00");
    });

    it("classifies the line with the catalog's BASE_PRICE code", () => {
      const [line] = calculator.calculate(buildContext(routeSource("380.00")));

      expect(line.component).toBe(PricingComponentCode.BASE_PRICE);
    });

    it("names the route in the description", () => {
      const [line] = calculator.calculate(buildContext(routeSource("380.00")));

      expect(line.description).toBe("Antwerp - Rotterdam");
    });

    it("leaves quantity and unit price null, because the price is flat", () => {
      const [line] = calculator.calculate(buildContext(routeSource("380.00")));

      expect(line.quantity).toBeNull();
      expect(line.unitPrice).toBeNull();
    });

    it("passes the configured amount through untouched", () => {
      // No arithmetic at all: the configured price reaches the breakdown as-is.
      const [line] = calculator.calculate(buildContext(routeSource("1234.56")));

      expect(line.amount.toFixed(2)).toBe("1234.56");
    });
  });

  describe("distance-based pricing", () => {
    it("multiplies distance by the configured rate", () => {
      const [line] = calculator.calculate(
        buildContext(distanceSource("100.00", "1.50")),
      );

      expect(line.amount.toFixed(2)).toBe("150.00");
    });

    it("keeps the distance and the rate on the line as quantity and unit price", () => {
      const [line] = calculator.calculate(
        buildContext(distanceSource("132.50", "1.85")),
      );

      expect(line.quantity?.toFixed(2)).toBe("132.50");
      expect(line.unitPrice?.toFixed(2)).toBe("1.85");
    });

    it("states the distance in the description", () => {
      const [line] = calculator.calculate(
        buildContext(distanceSource("132.50", "1.85")),
      );

      expect(line.description).toBe("132.50 km");
    });

    it("classifies the line with the same component as the route strategy", () => {
      const [line] = calculator.calculate(
        buildContext(distanceSource("100.00", "1.50")),
      );

      expect(line.component).toBe(PricingComponentCode.BASE_PRICE);
    });
  });

  describe("decimal precision", () => {
    it("multiplies exactly where floating point would drift", () => {
      // 0.1 * 3 is 0.30000000000000004 in binary floating point.
      const [line] = calculator.calculate(
        buildContext(distanceSource("3.00", "0.10")),
      );

      expect(line.amount.toFixed(2)).toBe("0.30");
    });

    it("keeps a classic float trap exact", () => {
      // 1.10 * 3 is 3.3000000000000003 as a float.
      const [line] = calculator.calculate(
        buildContext(distanceSource("3.00", "1.10")),
      );

      expect(line.amount.toFixed(2)).toBe("3.30");
    });

    it("rounds a four-decimal product half-up to the storable precision", () => {
      // 132.50 x 1.85 = 245.1250 exactly; the amount column holds two decimals.
      const [line] = calculator.calculate(
        buildContext(distanceSource("132.50", "1.85")),
      );

      expect(line.amount.toFixed(2)).toBe("245.13");
    });

    it.each([
      ["10.00", "0.125", "1.25"],
      ["10.00", "0.135", "1.35"],
      ["3.00", "0.115", "0.35"],
      ["1.00", "0.005", "0.01"],
    ])(
      "rounds %s km at %s per km to %s",
      (distanceKm, ratePerKm, expected) => {
        const [line] = calculator.calculate(
          buildContext(distanceSource(distanceKm, ratePerKm)),
        );

        expect(line.amount.toFixed(2)).toBe(expected);
      },
    );

    it("returns a Decimal, never a JavaScript number", () => {
      const [line] = calculator.calculate(
        buildContext(distanceSource("132.50", "1.85")),
      );

      expect(Prisma.Decimal.isDecimal(line.amount)).toBe(true);
      expect(typeof line.amount).not.toBe("number");
    });

    it("never converts through a float on the route strategy either", () => {
      const [line] = calculator.calculate(buildContext(routeSource("0.07")));

      expect(Prisma.Decimal.isDecimal(line.amount)).toBe(true);
      expect(line.amount.toFixed(2)).toBe("0.07");
    });
  });

  describe("zero values", () => {
    it("prices a zero-distance Trip at zero, not as an absence", () => {
      const [line] = calculator.calculate(
        buildContext(distanceSource("0.00", "1.85")),
      );

      expect(line.amount.toFixed(2)).toBe("0.00");
      expect(line.quantity?.toFixed(2)).toBe("0.00");
    });

    it("accepts a zero rate", () => {
      const [line] = calculator.calculate(
        buildContext(distanceSource("132.50", "0.00")),
      );

      expect(line.amount.toFixed(2)).toBe("0.00");
    });

    it("accepts a configured route price of zero", () => {
      const [line] = calculator.calculate(buildContext(routeSource("0.00")));

      expect(line.amount.toFixed(2)).toBe("0.00");
    });

    it("still produces a line for a zero amount", () => {
      // A zero base price is a calculated result, not a missing one.
      const lines = calculator.calculate(buildContext(routeSource("0.00")));

      expect(lines).toHaveLength(1);
    });
  });

  describe("large values", () => {
    it("keeps a large route price exact", () => {
      const [line] = calculator.calculate(
        buildContext(routeSource("9999999999.99")),
      );

      expect(line.amount.toFixed(2)).toBe("9999999999.99");
    });

    it("multiplies large values without losing a cent", () => {
      // 999999.99 x 1000.00 is beyond the 2^53 integer range of a float.
      const [line] = calculator.calculate(
        buildContext(distanceSource("999999.99", "1000.00")),
      );

      expect(line.amount.toFixed(2)).toBe("999999990.00");
    });

    it("stays exact where a float would round to the nearest representable value", () => {
      const [line] = calculator.calculate(
        buildContext(distanceSource("99999.99", "99999.99")),
      );

      // Float arithmetic gives 9999998000.0001 with drift; Decimal does not.
      expect(line.amount.toFixed(2)).toBe("9999998000.00");
    });
  });

  describe("the produced line", () => {
    it("is exactly one line", () => {
      expect(calculator.calculate(buildContext(routeSource("380.00")))).toHaveLength(
        1,
      );
    });

    it("carries the calculation order pricing_rules.md gives the base price", () => {
      const [line] = calculator.calculate(buildContext(routeSource("380.00")));

      expect(line.calculationOrder).toBe(BASE_PRICE_CALCULATION_ORDER);
      expect(BASE_PRICE_CALCULATION_ORDER).toBe(1);
    });

    it("produces no other component", () => {
      const lines = calculator.calculate(
        buildContext(distanceSource("132.50", "1.85")),
      );

      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.BASE_PRICE,
      ]);
    });
  });

  describe("logging", () => {
    it("logs the start and the completion with the strategy", () => {
      calculator.calculate(buildContext(routeSource("380.00")));

      expect(logger.log).toHaveBeenNthCalledWith(
        1,
        "Base price calculation started",
        { tripId: TRIP_ID, strategy: PricingStrategy.ROUTE_BASED },
      );
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        "Base price calculation completed",
        {
          tripId: TRIP_ID,
          strategy: PricingStrategy.ROUTE_BASED,
          calculationOrder: BASE_PRICE_CALCULATION_ORDER,
        },
      );
    });

    it("reports the distance strategy when that one is active", () => {
      calculator.calculate(buildContext(distanceSource("132.50", "1.85")));

      expect(logger.log).toHaveBeenCalledWith(
        "Base price calculation started",
        { tripId: TRIP_ID, strategy: PricingStrategy.DISTANCE_BASED },
      );
    });

    it("never logs an amount, a rate or a distance", () => {
      calculator.calculate(buildContext(distanceSource("132.50", "1.85")));

      const logged = JSON.stringify(logger.log.mock.calls);

      expect(logged).not.toContain("245.13");
      expect(logged).not.toContain("132.50");
      expect(logged).not.toContain("1.85");
    });
  });

  it("performs no lookup, no validation and no write", () => {
    // The context is already complete when a step runs; a step is a formula.
    const source = BasePriceCalculator.prototype.constructor.toString();

    expect(source).not.toContain("await");
    expect(source).not.toContain("Service");
    expect(source).not.toContain("throw");
  });

  it("calculates no other pricing component", () => {
    const source = BasePriceCalculator.prototype.constructor.toString();

    expect(source).not.toContain("fuelPercentage");
    expect(source).not.toContain("combinationSurcharge");
    expect(source).not.toContain("waitingTime");
    expect(source).not.toContain("customPropert");
  });
});
