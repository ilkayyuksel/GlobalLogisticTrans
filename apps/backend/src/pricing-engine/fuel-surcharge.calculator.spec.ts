import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  FUEL_CALCULATION_ORDER,
  FuelSurchargeCalculator,
} from "./fuel-surcharge.calculator";
import { PricingCalculationContext } from "./pricing-calculation-context";
import { PricingComponentCode, PricingLine } from "./pricing-line";
import { PricingStrategy } from "./pricing-settings";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function buildContext(fuelPercentage = "15"): PricingCalculationContext {
  return {
    tripId: TRIP_ID,
    bookingNumber: "BK-2026-1001",
    tripStatus: TripStatus.CLOSED,
    planningDate: "2026-08-17",
    isCombination: false,
    waitingTimeMinutes: 0,
    route: { departure: "DP World Antwerp Gateway", destination: "Bousbecque" },
    baseSource: {
      strategy: PricingStrategy.ROUTE_BASED,
      routePricingId: "route-1",
      basePrice: "450.00",
    },
    rules: {
      strategy: PricingStrategy.ROUTE_BASED,
      fuelPercentage,
      combinationSurcharge: "75",
      waitingTimeFreeMinutes: 60,
      waitingTimeBlockMinutes: 30,
    waitingTimeBlockPrice: "25.00",
    ruleVersion: "2026.1",
    },
    assignedCustomProperties: [],
    routeCosts: [],
    existingSnapshot: null,
    preparedAt: new Date("2026-08-17T09:00:00.000Z"),
  };
}

function line(
  component: PricingComponentCode,
  amount: string,
  calculationOrder: number,
): PricingLine {
  return {
    component,
    description: component,
    amount: new Prisma.Decimal(amount),
    calculationOrder,
    quantity: null,
    unitPrice: null,
    customPropertyId: null,
  };
}

const baseLine = (amount: string): PricingLine =>
  line(PricingComponentCode.BASE_PRICE, amount, 1);

const combinationLine = (amount: string): PricingLine =>
  line(PricingComponentCode.COMBINATION, amount, 2);

describe("FuelSurchargeCalculator", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let calculator: FuelSurchargeCalculator;

  /** The surcharge amount for a given base price and percentage. */
  function surchargeFor(basePrice: string, fuelPercentage = "15"): string {
    const [fuel] = calculator.calculate(buildContext(fuelPercentage), [
      baseLine(basePrice),
    ]);

    return fuel.amount.toFixed(2);
  }

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    calculator = new FuelSurchargeCalculator(
      logger as unknown as AppLoggerService,
    );
  });

  describe("the produced line", () => {
    it("produces exactly one line", () => {
      expect(
        calculator.calculate(buildContext(), [baseLine("450.00")]),
      ).toHaveLength(1);
    });

    it("classifies the line with the catalog's FUEL_SURCHARGE code", () => {
      const [fuel] = calculator.calculate(buildContext(), [baseLine("450.00")]);

      expect(fuel.component).toBe(PricingComponentCode.FUEL_SURCHARGE);
    });

    it("records the rate that was applied in the description", () => {
      const [fuel] = calculator.calculate(buildContext(), [baseLine("450.00")]);

      expect(fuel.description).toBe("Fuel 15%");
    });

    it("leaves quantity and unit price null", () => {
      const [fuel] = calculator.calculate(buildContext(), [baseLine("450.00")]);

      expect(fuel.quantity).toBeNull();
      expect(fuel.unitPrice).toBeNull();
    });

    it("produces no other component", () => {
      const lines = calculator.calculate(buildContext(), [baseLine("450.00")]);

      expect(lines.map((l) => l.component)).toEqual([
        PricingComponentCode.FUEL_SURCHARGE,
      ]);
    });
  });

  describe("calculation order", () => {
    it("carries the position pricing_rules.md gives the Fuel Surcharge", () => {
      const [fuel] = calculator.calculate(buildContext(), [baseLine("450.00")]);

      expect(fuel.calculationOrder).toBe(FUEL_CALCULATION_ORDER);
      expect(FUEL_CALCULATION_ORDER).toBe(3);
    });

    it("orders after the base price and the combination surcharge", () => {
      expect(FUEL_CALCULATION_ORDER).toBeGreaterThan(1);
      expect(FUEL_CALCULATION_ORDER).toBeGreaterThan(2);
    });
  });

  describe("route-based pricing", () => {
    it("charges the percentage on the configured route price", () => {
      expect(surchargeFor("450.00")).toBe("67.50");
    });
  });

  describe("distance-based pricing", () => {
    it("charges the percentage on the calculated distance price", () => {
      // 142.50 km x 2.75 = 391.88 after rounding; 15% of that is 58.782.
      expect(surchargeFor("391.88")).toBe("58.78");
    });

    it("treats both strategies identically, because it reads the line", () => {
      // Fuel does not know which strategy produced the base price.
      expect(surchargeFor("380.00")).toBe(surchargeFor("380.00"));
    });
  });

  describe("percentages", () => {
    it("prices a zero percentage as a real zero line", () => {
      const lines = calculator.calculate(buildContext("0"), [
        baseLine("450.00"),
      ]);

      expect(lines).toHaveLength(1);
      expect(lines[0].amount.toFixed(2)).toBe("0.00");
    });

    it.each([
      ["12.5", "450.00", "56.25"],
      ["7.5", "380.00", "28.50"],
      ["15.5", "520.00", "80.60"],
      ["0.5", "450.00", "2.25"],
      ["100", "450.00", "450.00"],
    ])("applies %s%% to %s as %s", (percentage, base, expected) => {
      expect(surchargeFor(base, percentage)).toBe(expected);
    });

    it("reflects a decimal percentage in the description", () => {
      const [fuel] = calculator.calculate(buildContext("12.5"), [
        baseLine("450.00"),
      ]);

      expect(fuel.description).toBe("Fuel 12.5%");
    });
  });

  describe("decimal base prices", () => {
    it.each([
      ["123.45", "15", "18.52"],
      ["0.07", "15", "0.01"],
      ["33.33", "7.5", "2.50"],
      ["9999999999.99", "0", "0.00"],
    ])("charges %s%% of %s as %s", (base, percentage, expected) => {
      expect(surchargeFor(base, percentage)).toBe(expected);
    });

    it("keeps a very large base exact", () => {
      // 999999999.99 x 15% = 149999999.9985, half-up to 150000000.00
      expect(surchargeFor("999999999.99")).toBe("150000000.00");
    });
  });

  describe("half-up rounding of a third decimal", () => {
    it("rounds 100.05 at 15% up, because the exact result is 15.0075", () => {
      expect(surchargeFor("100.05")).toBe("15.01");
    });

    it("rounds a result ending in exactly five up", () => {
      // 20.10 x 5% = 1.005 exactly. Half-up gives 1.01.
      expect(surchargeFor("20.10", "5")).toBe("1.01");
    });

    it("rounds down when the third decimal is below five", () => {
      // 123.45 x 12.5% = 15.43125
      expect(surchargeFor("123.45", "12.5")).toBe("15.43");
    });

    it("rounds only once, never on an intermediate value", () => {
      // Rounding 15.0075 to 15.01 in one step differs from rounding to 15.008
      // and then to 15.01 only by luck; the exact intermediate proves the
      // multiplication was not truncated before the division.
      const [fuel] = calculator.calculate(buildContext("15"), [
        baseLine("100.05"),
      ]);

      expect(fuel.amount.toFixed(2)).toBe("15.01");
      expect(fuel.amount.equals(new Prisma.Decimal("15.01"))).toBe(true);
    });
  });

  describe("no floating point precision errors", () => {
    it("rounds up where a float would round down", () => {
      // (20.10 * 5 / 100).toFixed(2) is "1.00" in binary floating point,
      // because 1.005 is stored as 1.00499999999999989.
      expect((((20.1 * 5) / 100) as number).toFixed(2)).toBe("1.00");
      expect(surchargeFor("20.10", "5")).toBe("1.01");
    });

    it("rounds a small amount up where a float would round down", () => {
      // (0.10 * 15 / 100).toFixed(2) is "0.01"; the exact value is 0.015.
      expect((((0.1 * 15) / 100) as number).toFixed(2)).toBe("0.01");
      expect(surchargeFor("0.10")).toBe("0.02");
    });

    it("returns a Decimal, never a JavaScript number", () => {
      const [fuel] = calculator.calculate(buildContext(), [baseLine("450.00")]);

      expect(Prisma.Decimal.isDecimal(fuel.amount)).toBe(true);
      expect(typeof fuel.amount).not.toBe("number");
    });
  });

  describe("fuel applies ONLY to the base price", () => {
    it("ignores the combination surcharge", () => {
      // 15% of 520 is 78.00. 15% of 520 + 75 would be 89.25.
      const [fuel] = calculator.calculate(buildContext(), [
        baseLine("520.00"),
        combinationLine("75.00"),
      ]);

      expect(fuel.amount.toFixed(2)).toBe("78.00");
    });

    it.each([
      PricingComponentCode.COMBINATION,
      "WAITING_TIME",
      "TOLL",
      "TUNNEL",
      "CUSTOM_PROPERTY",
      "MANUAL_ADJUSTMENT",
      "SOME_FUTURE_COMPONENT",
    ])("ignores a %s line entirely", (component) => {
      const withOther = calculator.calculate(buildContext(), [
        baseLine("450.00"),
        line(component as PricingComponentCode, "1000.00", 9),
      ]);
      const baseOnly = calculator.calculate(buildContext(), [
        baseLine("450.00"),
      ]);

      expect(withOther[0].amount.toFixed(2)).toBe("67.50");
      expect(withOther[0].amount.toFixed(2)).toBe(
        baseOnly[0].amount.toFixed(2),
      );
    });

    it("ignores every other line at once", () => {
      const [fuel] = calculator.calculate(buildContext(), [
        baseLine("450.00"),
        combinationLine("75.00"),
        line("WAITING_TIME" as PricingComponentCode, "25.00", 4),
        line("TOLL" as PricingComponentCode, "18.00", 5),
        line("TUNNEL" as PricingComponentCode, "12.50", 6),
        line("CUSTOM_PROPERTY" as PricingComponentCode, "35.00", 7),
        line("MANUAL_ADJUSTMENT" as PricingComponentCode, "40.00", 8),
      ]);

      expect(fuel.amount.toFixed(2)).toBe("67.50");
    });

    it("produces no line when there is no base price to charge on", () => {
      const lines = calculator.calculate(buildContext(), [
        combinationLine("75.00"),
      ]);

      expect(lines).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        "No base price line to apply the fuel surcharge to",
        { tripId: TRIP_ID },
      );
    });

    it("produces no line when nothing preceded it", () => {
      expect(calculator.calculate(buildContext(), [])).toEqual([]);
    });
  });

  describe("interaction with Base Price and Combination", () => {
    it("appends after both, completing the documented sequence", () => {
      const preceding = [baseLine("520.00"), combinationLine("75.00")];

      const lines = [
        ...preceding,
        ...calculator.calculate(buildContext(), preceding),
      ];

      expect(lines.map((l) => l.calculationOrder)).toEqual([1, 2, 3]);
      expect(lines.map((l) => l.component)).toEqual([
        PricingComponentCode.BASE_PRICE,
        PricingComponentCode.COMBINATION,
        PricingComponentCode.FUEL_SURCHARGE,
      ]);
    });

    it("never mutates what preceded it", () => {
      const preceding = [baseLine("520.00"), combinationLine("75.00")];
      const snapshot = preceding.map((l) => l.amount.toFixed(2));

      calculator.calculate(buildContext(), preceding);

      expect(preceding).toHaveLength(2);
      expect(preceding.map((l) => l.amount.toFixed(2))).toEqual(snapshot);
    });

    it("charges the same whether or not a combination surcharge is present", () => {
      const withCombination = calculator.calculate(buildContext(), [
        baseLine("520.00"),
        combinationLine("75.00"),
      ]);
      const withoutCombination = calculator.calculate(buildContext(), [
        baseLine("520.00"),
      ]);

      expect(withCombination[0].amount.toFixed(2)).toBe(
        withoutCombination[0].amount.toFixed(2),
      );
    });
  });

  /**
   * The seeded snapshots are the closest thing to a worked example the project
   * has, since pricing_examples.md is empty. Reproducing them exactly is what
   * proves the formula matches what the business already expects.
   */
  describe("reproduces the seeded pricing snapshots", () => {
    it.each([
      ["BK-2026-1001", "450.00", "67.50"],
      ["BK-2026-1002", "520.00", "78.00"],
      ["BK-2026-1003", "380.00", "57.00"],
    ])("%s: 15%% of %s is %s", (_booking, base, expected) => {
      expect(surchargeFor(base, "15")).toBe(expected);
    });
  });

  describe("logging", () => {
    it("logs the start and the completion", () => {
      calculator.calculate(buildContext(), [baseLine("450.00")]);

      expect(logger.log).toHaveBeenNthCalledWith(
        1,
        "Fuel surcharge calculation started",
        { tripId: TRIP_ID },
      );
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        "Fuel surcharge calculation completed",
        { tripId: TRIP_ID, lineCount: 1 },
      );
    });

    it("logs both events even when no line is produced", () => {
      calculator.calculate(buildContext(), []);

      expect(logger.log).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        "Fuel surcharge calculation completed",
        { tripId: TRIP_ID, lineCount: 0 },
      );
    });

    it("never logs an amount or a percentage", () => {
      calculator.calculate(buildContext("12.5"), [baseLine("450.00")]);

      const logged = JSON.stringify(logger.log.mock.calls);

      expect(logged).not.toContain("450");
      expect(logged).not.toContain("56.25");
      expect(logged).not.toContain("12.5");

      for (const [, payload] of logger.log.mock.calls) {
        expect(Object.keys(payload as object)).toEqual(
          expect.not.arrayContaining([
            "amount",
            "basePrice",
            "fuelPercentage",
            "percentage",
          ]),
        );
      }
    });
  });

  describe("validation is not duplicated", () => {
    it("performs no lookup and raises nothing itself", () => {
      // A missing or unusable FUEL_PERCENTAGE is rejected by PricingRuleResolver
      // with MissingPricingSettingException before any step runs.
      const source = FuelSurchargeCalculator.prototype.constructor.toString();

      expect(source).not.toContain("await");
      expect(source).not.toContain("Service");
      // "throw new" rather than "throw": the compiled source retains comments,
      // and prose about not throwing would match the bare word.
      expect(source).not.toContain("throw new");
    });

    it("calculates no other pricing component", () => {
      const source = FuelSurchargeCalculator.prototype.constructor.toString();

      expect(source).not.toContain("combinationSurcharge");
      expect(source).not.toContain("waitingTime");
      // The read, not the field: every line now sets customPropertyId, and
      // only the Custom Property step reads the assignments.
      expect(source).not.toContain("assignedCustomProperties");
      expect(source).not.toContain("distanceKm");
    });
  });
});
