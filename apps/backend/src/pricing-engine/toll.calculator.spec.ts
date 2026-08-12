import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PricingCalculationContext,
  PricingCustomPropertyInput,
  PricingRouteCostInput,
} from "./pricing-calculation-context";
import { PricingCalculationStep, PricingComponentCode } from "./pricing-line";
import { PricingStrategy } from "./pricing-settings";
import { TOLL_CALCULATION_ORDER, TollCalculator } from "./toll.calculator";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TOLL_COMPONENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TUNNEL_COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

const TOLL_COST: PricingRouteCostInput = {
  routeCostId: "cost-toll",
  pricingComponentId: TOLL_COMPONENT_ID,
  componentCode: "TOLL",
  amount: "9.75",
};

const TUNNEL_COST: PricingRouteCostInput = {
  routeCostId: "cost-tunnel",
  pricingComponentId: TUNNEL_COMPONENT_ID,
  componentCode: "TUNNEL",
  amount: "12.50",
};

/** A property linked to a component: applicability only, never a price. */
const TOLL_PROPERTY: PricingCustomPropertyInput = {
  customPropertyId: "property-toll",
  name: "Toll",
  pricingComponentId: TOLL_COMPONENT_ID,
  defaultPrice: null,
};

const TUNNEL_PROPERTY: PricingCustomPropertyInput = {
  customPropertyId: "property-tunnel",
  name: "Tunnel",
  pricingComponentId: TUNNEL_COMPONENT_ID,
  defaultPrice: null,
};

/** A fixed-price property: carries its own amount, links to no component. */
const FLAT_PROPERTY: PricingCustomPropertyInput = {
  customPropertyId: "property-flat",
  name: "Flat",
  pricingComponentId: null,
  defaultPrice: "50.00",
};

function buildContext(
  assignedCustomProperties: PricingCustomPropertyInput[] = [],
  routeCosts: PricingRouteCostInput[] = [],
): PricingCalculationContext {
  return {
    tripId: TRIP_ID,
    bookingNumber: "BK-2026-1003",
    tripStatus: TripStatus.CLOSED,
    planningDate: "2026-08-17",
    isCombination: false,
    waitingTimeMinutes: 0,
    route: { departure: "MSC PSA European Terminal", destination: "Rotterdam" },
    baseSource: {
      strategy: PricingStrategy.ROUTE_BASED,
      routePricingId: "route-1",
      basePrice: "380.00",
    },
    rules: {
      strategy: PricingStrategy.ROUTE_BASED,
      fuelPercentage: "15",
      combinationSurcharge: "75",
      waitingTimeFreeMinutes: 60,
      waitingTimeBlockMinutes: 30,
      waitingTimeBlockPrice: "25.00",
      ruleVersion: "2026.1",
    },
    assignedCustomProperties,
    routeCosts,
    existingSnapshot: null,
    preparedAt: new Date("2026-08-17T09:00:00.000Z"),
  };
}

describe("TollCalculator", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let calculator: TollCalculator;

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    calculator = new TollCalculator(logger as unknown as AppLoggerService);
  });

  /**
   * Two independent facts decide a toll: the Trip's assignment says it applies,
   * the route's cost says how much. Both are required.
   */
  describe("applicability", () => {
    it("produces a line when the property is assigned and the cost exists", () => {
      const lines = calculator.calculate(
        buildContext([TOLL_PROPERTY], [TOLL_COST]),
      );

      expect(lines).toHaveLength(1);
      expect(lines[0].component).toBe(PricingComponentCode.TOLL);
    });

    it("produces no line when the Trip carries no properties at all", () => {
      expect(calculator.calculate(buildContext([], [TOLL_COST]))).toEqual([]);
    });

    it("produces no line when a cost exists but the property is not assigned", () => {
      // The route has a toll configured; this Trip simply does not owe it.
      expect(
        calculator.calculate(buildContext([FLAT_PROPERTY], [TOLL_COST])),
      ).toEqual([]);
    });

    it("produces no line when the route has no costs configured", () => {
      expect(calculator.calculate(buildContext([FLAT_PROPERTY], []))).toEqual(
        [],
      );
    });

    it("ignores a property linked to a different component", () => {
      const lines = calculator.calculate(
        buildContext([TUNNEL_PROPERTY], [TOLL_COST, TUNNEL_COST]),
      );

      expect(lines).toEqual([]);
    });

    it("ignores a route cost for a different component", () => {
      const lines = calculator.calculate(
        buildContext([TOLL_PROPERTY], [TUNNEL_COST]),
      );

      expect(lines).toEqual([]);
    });

    it("picks the toll out of a route that also has a tunnel", () => {
      const lines = calculator.calculate(
        buildContext(
          [TOLL_PROPERTY, TUNNEL_PROPERTY],
          [TUNNEL_COST, TOLL_COST],
        ),
      );

      expect(lines).toHaveLength(1);
      expect(lines[0].amount.toFixed(2)).toBe("9.75");
    });

    it("matches on the component id, not on the property's name", () => {
      // A property named something else entirely still makes the toll apply if
      // it links to the TOLL component; the name is presentation only.
      const renamed = { ...TOLL_PROPERTY, name: "Péage" };

      expect(
        calculator.calculate(buildContext([renamed], [TOLL_COST])),
      ).toHaveLength(1);
    });

    it("produces no line when the ids differ despite both being route-priced", () => {
      const otherComponent = {
        ...TOLL_PROPERTY,
        pricingComponentId: "some-other-component",
      };

      expect(
        calculator.calculate(buildContext([otherComponent], [TOLL_COST])),
      ).toEqual([]);
    });

    it("produces at most one line even if the property is somehow listed twice", () => {
      const lines = calculator.calculate(
        buildContext([TOLL_PROPERTY, { ...TOLL_PROPERTY }], [TOLL_COST]),
      );

      expect(lines).toHaveLength(1);
    });
  });

  describe("the produced line", () => {
    function tollLine() {
      return calculator.calculate(buildContext([TOLL_PROPERTY], [TOLL_COST]))[0];
    }

    it("takes its amount exclusively from the route cost", () => {
      expect(tollLine().amount.toFixed(2)).toBe("9.75");
    });

    it("ignores the property's default price entirely", () => {
      // The database forbids a linked property carrying a price, but if one
      // ever arrived the route cost must still win.
      const pricedProperty = { ...TOLL_PROPERTY, defaultPrice: "999.99" };

      const [line] = calculator.calculate(
        buildContext([pricedProperty], [TOLL_COST]),
      );

      expect(line.amount.toFixed(2)).toBe("9.75");
    });

    it("classifies the line with the catalog's TOLL code", () => {
      expect(tollLine().component).toBe(PricingComponentCode.TOLL);
    });

    it("carries the position pricing_rules.md gives the Toll", () => {
      expect(tollLine().calculationOrder).toBe(TOLL_CALCULATION_ORDER);
      expect(TOLL_CALCULATION_ORDER).toBe(5);
    });

    it("describes the line as Toll", () => {
      expect(tollLine().description).toBe("Toll");
    });

    it("carries no quantity and no unit price, being a flat charge", () => {
      expect(tollLine().quantity).toBeNull();
      expect(tollLine().unitPrice).toBeNull();
    });

    it("names no custom property, because the amount is the route's", () => {
      expect(JSON.stringify(tollLine())).not.toContain("property-toll");
      expect(tollLine().description).not.toContain("Toll property");
    });

    it("stores the amount at two decimals", () => {
      const [line] = calculator.calculate(
        buildContext([TOLL_PROPERTY], [{ ...TOLL_COST, amount: "18" }]),
      );

      expect(line.amount.toFixed(2)).toBe("18.00");
    });

    it("produces a line for a configured cost of zero", () => {
      // Zero is a configured amount, not a missing one; the toll applies.
      const [line] = calculator.calculate(
        buildContext([TOLL_PROPERTY], [{ ...TOLL_COST, amount: "0.00" }]),
      );

      expect(line.amount.toFixed(2)).toBe("0.00");
    });
  });

  /**
   * The missing-cost case never reaches this calculator: the Engine validates
   * the pairing while building the context and refuses there.
   */
  it("does not itself throw when the property is assigned but no cost exists", () => {
    expect(() =>
      calculator.calculate(buildContext([TOLL_PROPERTY], [])),
    ).not.toThrow();
  });

  describe("purity", () => {
    it("never mutates the context", () => {
      const context = buildContext([TOLL_PROPERTY], [TOLL_COST]);
      const before = JSON.stringify(context);

      calculator.calculate(context);

      expect(JSON.stringify(context)).toBe(before);
    });

    it("ignores the preceding lines entirely", () => {
      // Unlike the Fuel Surcharge, a toll does not derive from another line.
      const step: PricingCalculationStep = calculator;
      const context = buildContext([TOLL_PROPERTY], [TOLL_COST]);

      const withoutPreceding = step.calculate(context, []);
      const withPreceding = step.calculate(context, [
        {
          component: PricingComponentCode.BASE_PRICE,
          description: "irrelevant",
          amount: new Prisma.Decimal("380.00"),
          calculationOrder: 1,
          quantity: null,
          unitPrice: null,
          customPropertyId: null,
        },
      ]);

      expect(withPreceding[0].amount.toFixed(2)).toBe(
        withoutPreceding[0].amount.toFixed(2),
      );
    });

    it("performs no lookup and no persistence", () => {
      const source = TollCalculator.prototype.constructor.toString();

      expect(source).not.toContain("await");
      expect(source).not.toContain("Service");
      expect(source).not.toContain("prisma");
    });
  });

  describe("logging", () => {
    it("logs the trip and the line count only", () => {
      calculator.calculate(buildContext([TOLL_PROPERTY], [TOLL_COST]));

      expect(logger.log).toHaveBeenCalledWith("Toll calculation started", {
        tripId: TRIP_ID,
      });
      expect(logger.log).toHaveBeenCalledWith("Toll calculation completed", {
        tripId: TRIP_ID,
        lineCount: 1,
      });
    });

    it("never logs an amount or a property identifier", () => {
      calculator.calculate(
        buildContext([TOLL_PROPERTY], [{ ...TOLL_COST, amount: "1234.56" }]),
      );

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("1234.56");
      expect(logged).not.toContain("property-toll");
      expect(logged).not.toContain("cost-toll");
    });
  });
});
