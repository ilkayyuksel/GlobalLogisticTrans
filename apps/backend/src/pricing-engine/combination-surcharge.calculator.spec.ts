import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  COMBINATION_CALCULATION_ORDER,
  CombinationSurchargeCalculator,
} from "./combination-surcharge.calculator";
import { PricingCalculationContext } from "./pricing-calculation-context";
import { PricingComponentCode, PricingLine } from "./pricing-line";
import { PricingStrategy } from "./pricing-settings";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** A base price line, as the preceding step would have produced it. */
const BASE_LINE: PricingLine = {
  component: PricingComponentCode.BASE_PRICE,
  description: "PSA Antwerp - Dourges",
  amount: new Prisma.Decimal("520.00"),
  calculationOrder: 1,
  quantity: null,
  unitPrice: null,
};

function buildContext(
  isCombination: boolean,
  combinationSurcharge = "75",
): PricingCalculationContext {
  return {
    tripId: TRIP_ID,
    bookingNumber: "BK-2026-1002",
    tripStatus: TripStatus.CLOSED,
    planningDate: "2026-08-17",
    isCombination,
    waitingTimeMinutes: 0,
    baseSource: {
      strategy: PricingStrategy.ROUTE_BASED,
      routePricingId: "route-1",
      departure: "PSA Antwerp",
      destination: "Dourges",
      basePrice: "520.00",
    },
    rules: {
      strategy: PricingStrategy.ROUTE_BASED,
      fuelPercentage: "15",
      combinationSurcharge,
      waitingTimeFreeMinutes: 60,
      waitingTimeBlockMinutes: 30,
    },
    activeCustomProperties: [],
    existingSnapshot: null,
    preparedAt: new Date("2026-08-17T09:00:00.000Z"),
  };
}

describe("CombinationSurchargeCalculator", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let calculator: CombinationSurchargeCalculator;

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    calculator = new CombinationSurchargeCalculator(
      logger as unknown as AppLoggerService,
    );
  });

  describe("a Trip outside a Combination", () => {
    it("produces no line at all", () => {
      expect(calculator.calculate(buildContext(false))).toEqual([]);
    });

    it("does not produce a line of zero", () => {
      // A zero line would claim the surcharge was priced at nothing; no line
      // says the component does not apply to this transport.
      const lines = calculator.calculate(buildContext(false));

      expect(lines).toHaveLength(0);
      expect(lines.map((line) => line.component)).not.toContain(
        PricingComponentCode.COMBINATION,
      );
    });

    it("still produces no line when a surcharge is configured", () => {
      expect(calculator.calculate(buildContext(false, "999.99"))).toEqual(
        [],
      );
    });
  });

  describe("a Combination Trip", () => {
    it("produces exactly one line", () => {
      expect(calculator.calculate(buildContext(true))).toHaveLength(1);
    });

    it("classifies the line with the catalog's COMBINATION code", () => {
      const [line] = calculator.calculate(buildContext(true));

      expect(line.component).toBe(PricingComponentCode.COMBINATION);
    });

    it("uses the configured surcharge as the amount", () => {
      const [line] = calculator.calculate(buildContext(true));

      expect(line.amount.toFixed(2)).toBe("75.00");
    });

    it("describes the line as the seeded snapshots do", () => {
      const [line] = calculator.calculate(buildContext(true));

      expect(line.description).toBe("Combination surcharge");
    });

    it("leaves quantity and unit price null, because the surcharge is flat", () => {
      const [line] = calculator.calculate(buildContext(true));

      expect(line.quantity).toBeNull();
      expect(line.unitPrice).toBeNull();
    });

    it("produces no other component", () => {
      const lines = calculator.calculate(buildContext(true));

      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.COMBINATION,
      ]);
    });
  });

  describe("calculation order", () => {
    it("carries the position pricing_rules.md gives the Combination Surcharge", () => {
      const [line] = calculator.calculate(buildContext(true));

      expect(line.calculationOrder).toBe(COMBINATION_CALCULATION_ORDER);
      expect(COMBINATION_CALCULATION_ORDER).toBe(2);
    });

    it("orders after the base price and before the fuel surcharge", () => {
      expect(COMBINATION_CALCULATION_ORDER).toBeGreaterThan(
        BASE_LINE.calculationOrder,
      );
      expect(COMBINATION_CALCULATION_ORDER).toBeLessThan(3);
    });
  });

  describe("amounts", () => {
    it("prices a zero surcharge as a real zero line", () => {
      // Unlike a non-Combination Trip, a Combination with a configured zero
      // surcharge HAS been priced — at nothing. The line records that.
      const lines = calculator.calculate(buildContext(true, "0"));

      expect(lines).toHaveLength(1);
      expect(lines[0].amount.toFixed(2)).toBe("0.00");
    });

    it("keeps a decimal surcharge exact", () => {
      const [line] = calculator.calculate(buildContext(true, "82.35"));

      expect(line.amount.toFixed(2)).toBe("82.35");
    });

    it("normalises a whole-number setting to two decimals", () => {
      const [line] = calculator.calculate(buildContext(true, "75"));

      expect(line.amount.toFixed(2)).toBe("75.00");
    });

    it("keeps a one-decimal setting exact", () => {
      const [line] = calculator.calculate(buildContext(true, "82.5"));

      expect(line.amount.toFixed(2)).toBe("82.50");
    });

    it("keeps a large surcharge exact", () => {
      const [line] = calculator.calculate(buildContext(true, "9999999999.99"));

      expect(line.amount.toFixed(2)).toBe("9999999999.99");
    });

    it("returns a Decimal, never a JavaScript number", () => {
      const [line] = calculator.calculate(buildContext(true, "0.07"));

      expect(Prisma.Decimal.isDecimal(line.amount)).toBe(true);
      expect(line.amount.toFixed(2)).toBe("0.07");
    });

    it("does not drift the way a float would", () => {
      // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
      const [line] = calculator.calculate(buildContext(true, "0.30"));

      expect(line.amount.toFixed(2)).toBe("0.30");
      expect(line.amount.equals(new Prisma.Decimal("0.3"))).toBe(true);
    });
  });

  describe("interaction with the preceding Base Price step", () => {
    it("cannot depend on the base price, because it never receives it", () => {
      // The step declares only the context, exactly as BasePriceCalculator
      // does. A flat surcharge has no input from earlier lines — unlike the
      // Fuel Surcharge, which will have to accept them.
      expect(calculator.calculate).toHaveLength(1);
    });

    it("appends after the base price when the two are combined", () => {
      const lines = [BASE_LINE, ...calculator.calculate(buildContext(true))];

      expect(lines.map((line) => line.calculationOrder)).toEqual([1, 2]);
      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.BASE_PRICE,
        PricingComponentCode.COMBINATION,
      ]);
    });
  });

  describe("logging", () => {
    it("logs the start and the completion for a Combination Trip", () => {
      calculator.calculate(buildContext(true));

      expect(logger.log).toHaveBeenNthCalledWith(
        1,
        "Combination surcharge calculation started",
        { tripId: TRIP_ID, isCombination: true },
      );
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        "Combination surcharge calculation completed",
        { tripId: TRIP_ID, isCombination: true, lineCount: 1 },
      );
    });

    it("logs both events even when no line is produced", () => {
      // Both events always pair up, so a skipped step is greppable rather than
      // an unexplained gap between two other steps.
      calculator.calculate(buildContext(false));

      expect(logger.log).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        "Combination surcharge calculation completed",
        { tripId: TRIP_ID, isCombination: false, lineCount: 0 },
      );
    });

    it("never logs the surcharge amount", () => {
      calculator.calculate(buildContext(true, "82.35"));

      const logged = JSON.stringify(logger.log.mock.calls);

      expect(logged).not.toContain("82.35");
      // No amount-bearing field reaches the log at all, under any name.
      for (const [, payload] of logger.log.mock.calls) {
        expect(Object.keys(payload as object)).toEqual(
          expect.not.arrayContaining([
            "amount",
            "surcharge",
            "combinationSurcharge",
          ]),
        );
      }
    });
  });

  describe("validation is not duplicated", () => {
    it("performs no lookup and raises nothing itself", () => {
      // A missing or unusable COMBINATION_SURCHARGE setting is rejected by
      // PricingRuleResolver with MissingPricingSettingException before any step
      // runs — see pricing-rule.resolver.spec.ts and the engine spec.
      const source =
        CombinationSurchargeCalculator.prototype.constructor.toString();

      expect(source).not.toContain("await");
      expect(source).not.toContain("Service");
      expect(source).not.toContain("throw");
    });

    it("calculates no other pricing component", () => {
      const source =
        CombinationSurchargeCalculator.prototype.constructor.toString();

      expect(source).not.toContain("fuelPercentage");
      expect(source).not.toContain("waitingTime");
      expect(source).not.toContain("basePrice");
      expect(source).not.toContain("customPropert");
    });
  });
});
