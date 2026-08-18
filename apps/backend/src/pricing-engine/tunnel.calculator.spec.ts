import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PricingCalculationContext,
  PricingCustomPropertyInput,
  PricingRouteCostInput,
} from "./pricing-calculation-context";
import { PricingCalculationStep, PricingComponentCode } from "./pricing-line";
import { PricingStrategy } from "./pricing-settings";
import {
  TUNNEL_CALCULATION_ORDER,
  TunnelCalculator,
} from "./tunnel.calculator";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TOLL_COMPONENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TUNNEL_COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

const TUNNEL_COST: PricingRouteCostInput = {
  routeCostId: "cost-tunnel",
  pricingComponentId: TUNNEL_COMPONENT_ID,
  componentCode: "TUNNEL",
  amount: "12.50",
};

const TOLL_COST: PricingRouteCostInput = {
  routeCostId: "cost-toll",
  pricingComponentId: TOLL_COMPONENT_ID,
  componentCode: "TOLL",
  amount: "9.75",
};

/** A property linked to a component: applicability only, never a price. */
const TUNNEL_PROPERTY: PricingCustomPropertyInput = {
  customPropertyId: "property-tunnel",
  name: "Tunnel",
  pricingComponentId: TUNNEL_COMPONENT_ID,
  defaultPrice: null,
};

const TOLL_PROPERTY: PricingCustomPropertyInput = {
  customPropertyId: "property-toll",
  name: "Toll",
  pricingComponentId: TOLL_COMPONENT_ID,
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
      automaticCustomPropertyId: "property-tar",
      waitingTimeFreeMinutes: 60,
      waitingTimeThresholdMinutes: 0,
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

describe("TunnelCalculator", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let calculator: TunnelCalculator;

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    calculator = new TunnelCalculator(logger as unknown as AppLoggerService);
  });

  /**
   * Two independent facts decide a tunnel charge: the Trip's assignment says it
   * applies, the route's cost says how much. Both are required.
   */
  describe("applicability", () => {
    it("produces a line when the property is assigned and the cost exists", () => {
      const lines = calculator.calculate(
        buildContext([TUNNEL_PROPERTY], [TUNNEL_COST]),
      );

      expect(lines).toHaveLength(1);
      expect(lines[0].component).toBe(PricingComponentCode.TUNNEL);
    });

    it("produces no line when the Trip carries no properties at all", () => {
      expect(calculator.calculate(buildContext([], [TUNNEL_COST]))).toEqual([]);
    });

    it("produces no line when a cost exists but the property is not assigned", () => {
      // The route has a tunnel configured; this Trip simply does not use it.
      expect(
        calculator.calculate(buildContext([FLAT_PROPERTY], [TUNNEL_COST])),
      ).toEqual([]);
    });

    it("produces no line when the route has no costs configured", () => {
      expect(calculator.calculate(buildContext([FLAT_PROPERTY], []))).toEqual(
        [],
      );
    });

    it("never mistakes a toll route cost for a tunnel one", () => {
      expect(
        calculator.calculate(buildContext([TUNNEL_PROPERTY], [TOLL_COST])),
      ).toEqual([]);
    });

    it("produces no tunnel line for a Trip assigned only the toll", () => {
      expect(
        calculator.calculate(
          buildContext([TOLL_PROPERTY], [TOLL_COST, TUNNEL_COST]),
        ),
      ).toEqual([]);
    });

    it("picks the tunnel out of a route that also has a toll", () => {
      const lines = calculator.calculate(
        buildContext(
          [TOLL_PROPERTY, TUNNEL_PROPERTY],
          [TOLL_COST, TUNNEL_COST],
        ),
      );

      expect(lines).toHaveLength(1);
      expect(lines[0].component).toBe(PricingComponentCode.TUNNEL);
      expect(lines[0].amount.toFixed(2)).toBe("12.50");
    });

    it("matches on the component id, not on the property's name", () => {
      // A property renamed in the catalog still makes the tunnel apply; the
      // name is presentation only.
      const renamed = { ...TUNNEL_PROPERTY, name: "Liefkenshoek" };

      expect(
        calculator.calculate(buildContext([renamed], [TUNNEL_COST])),
      ).toHaveLength(1);
    });

    it("is unaffected by a route cost renamed in the catalog", () => {
      // The cost is found by component CODE; the property is matched by id.
      const lines = calculator.calculate(
        buildContext(
          [{ ...TUNNEL_PROPERTY, name: "Anything" }],
          [TUNNEL_COST],
        ),
      );

      expect(lines).toHaveLength(1);
    });

    it("produces no line when the ids differ despite both being route-priced", () => {
      const otherComponent = {
        ...TUNNEL_PROPERTY,
        pricingComponentId: "some-other-component",
      };

      expect(
        calculator.calculate(buildContext([otherComponent], [TUNNEL_COST])),
      ).toEqual([]);
    });

    it("produces at most one line even if the property is listed twice", () => {
      const lines = calculator.calculate(
        buildContext([TUNNEL_PROPERTY, { ...TUNNEL_PROPERTY }], [TUNNEL_COST]),
      );

      expect(lines).toHaveLength(1);
    });
  });

  describe("the produced line", () => {
    function tunnelLine() {
      return calculator.calculate(
        buildContext([TUNNEL_PROPERTY], [TUNNEL_COST]),
      )[0];
    }

    it("takes its amount exclusively from the route cost", () => {
      expect(tunnelLine().amount.toFixed(2)).toBe("12.50");
    });

    it("ignores the property's default price entirely", () => {
      // The database forbids a linked property carrying a price, but if one
      // ever arrived the route cost must still win.
      const pricedProperty = { ...TUNNEL_PROPERTY, defaultPrice: "999.99" };

      const [line] = calculator.calculate(
        buildContext([pricedProperty], [TUNNEL_COST]),
      );

      expect(line.amount.toFixed(2)).toBe("12.50");
    });

    it("classifies the line with the catalog's TUNNEL code", () => {
      expect(tunnelLine().component).toBe(PricingComponentCode.TUNNEL);
    });

    it("carries the position pricing_rules.md gives the Tunnel", () => {
      expect(tunnelLine().calculationOrder).toBe(TUNNEL_CALCULATION_ORDER);
      expect(TUNNEL_CALCULATION_ORDER).toBe(6);
    });

    it("runs after the Toll", () => {
      expect(TUNNEL_CALCULATION_ORDER).toBeGreaterThan(5);
    });

    it("describes the line as Tunnel", () => {
      expect(tunnelLine().description).toBe("Tunnel");
    });

    it("carries no quantity and no unit price, being a flat charge", () => {
      expect(tunnelLine().quantity).toBeNull();
      expect(tunnelLine().unitPrice).toBeNull();
    });

    it("carries no custom property reference", () => {
      // The property decided applicability; the charge is the route's, so the
      // reference is explicitly null rather than pointing at the property.
      expect(tunnelLine().customPropertyId).toBeNull();
      expect(JSON.stringify(tunnelLine())).not.toContain("property-tunnel");
    });
  });

  describe("decimal handling", () => {
    it("keeps the amount as a Decimal, never a JavaScript number", () => {
      const [line] = calculator.calculate(
        buildContext([TUNNEL_PROPERTY], [TUNNEL_COST]),
      );

      expect(Prisma.Decimal.isDecimal(line.amount)).toBe(true);
    });

    it("produces a real line for a configured cost of zero", () => {
      // Zero is a configured amount, not a missing one; the tunnel applies.
      const [line] = calculator.calculate(
        buildContext([TUNNEL_PROPERTY], [{ ...TUNNEL_COST, amount: "0.00" }]),
      );

      expect(line).toBeDefined();
      expect(line.component).toBe(PricingComponentCode.TUNNEL);
      expect(line.amount.toFixed(2)).toBe("0.00");
    });

    it("normalises a whole amount to two decimals", () => {
      const [line] = calculator.calculate(
        buildContext([TUNNEL_PROPERTY], [{ ...TUNNEL_COST, amount: "18" }]),
      );

      expect(line.amount.toFixed(2)).toBe("18.00");
    });

    it.each([
      ["0.01", "0.01"],
      ["7.05", "7.05"],
      ["12.50", "12.50"],
      ["9999999999.99", "9999999999.99"],
    ])("carries %s through exactly", (configured, expected) => {
      const [line] = calculator.calculate(
        buildContext(
          [TUNNEL_PROPERTY],
          [{ ...TUNNEL_COST, amount: configured }],
        ),
      );

      expect(line.amount.toFixed(2)).toBe(expected);
    });

    it("does not lose precision the way a float would", () => {
      // 0.1 + 0.2 !== 0.3 in binary floating point; Decimal is exact.
      const [line] = calculator.calculate(
        buildContext([TUNNEL_PROPERTY], [{ ...TUNNEL_COST, amount: "0.10" }]),
      );

      expect(line.amount.plus(new Prisma.Decimal("0.20")).toFixed(2)).toBe(
        "0.30",
      );
    });
  });

  /**
   * The missing-cost case never reaches this calculator. The Engine's
   * component-agnostic invariant refuses the calculation while building the
   * context, and a second Tunnel-specific check could only disagree with it.
   */
  describe("the missing-cost case is not this calculator's job", () => {
    it("does not throw when the property is assigned but no cost exists", () => {
      expect(() =>
        calculator.calculate(buildContext([TUNNEL_PROPERTY], [])),
      ).not.toThrow();
    });

    it("raises no exception of its own anywhere", () => {
      const source = TunnelCalculator.prototype.constructor.toString();

      expect(source).not.toContain("throw new");
    });
  });

  describe("purity", () => {
    it("never mutates the context", () => {
      const context = buildContext([TUNNEL_PROPERTY], [TUNNEL_COST]);
      const before = JSON.stringify(context);

      calculator.calculate(context);

      expect(JSON.stringify(context)).toBe(before);
    });

    it("ignores the preceding lines entirely", () => {
      const step: PricingCalculationStep = calculator;
      const context = buildContext([TUNNEL_PROPERTY], [TUNNEL_COST]);

      const withoutPreceding = step.calculate(context, []);
      const withPreceding = step.calculate(context, [
        {
          component: PricingComponentCode.TOLL,
          description: "Toll",
          amount: new Prisma.Decimal("9.75"),
          calculationOrder: 5,
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
      const source = TunnelCalculator.prototype.constructor.toString();

      expect(source).not.toContain("await");
      expect(source).not.toContain("Service");
      expect(source).not.toContain("prisma");
    });
  });

  describe("logging", () => {
    it("logs the trip and the line count only", () => {
      calculator.calculate(buildContext([TUNNEL_PROPERTY], [TUNNEL_COST]));

      expect(logger.log).toHaveBeenCalledWith("Tunnel calculation started", {
        tripId: TRIP_ID,
      });
      expect(logger.log).toHaveBeenCalledWith("Tunnel calculation completed", {
        tripId: TRIP_ID,
        lineCount: 1,
      });
    });

    it("never logs an amount or an identifier of the configuration", () => {
      calculator.calculate(
        buildContext(
          [TUNNEL_PROPERTY],
          [{ ...TUNNEL_COST, amount: "1234.56" }],
        ),
      );

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("1234.56");
      expect(logged).not.toContain("property-tunnel");
      expect(logged).not.toContain("cost-tunnel");
    });
  });
});
