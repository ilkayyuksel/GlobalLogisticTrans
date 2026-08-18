import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  CUSTOM_PROPERTY_CALCULATION_ORDER,
  CustomPropertyCalculator,
} from "./custom-property.calculator";
import { MissingCustomPropertyPriceException } from "./exceptions/pricing-engine.exceptions";
import {
  PricingCalculationContext,
  PricingCustomPropertyInput,
  PricingRouteCostInput,
} from "./pricing-calculation-context";
import { PricingCalculationStep, PricingComponentCode } from "./pricing-line";
import { PricingStrategy } from "./pricing-settings";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TOLL_COMPONENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TUNNEL_COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const FUTURE_COMPONENT_ID = "4e9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function fixedPrice(
  id: string,
  name: string,
  defaultPrice: string | null,
): PricingCustomPropertyInput {
  return {
    customPropertyId: id,
    name,
    pricingComponentId: null,
    defaultPrice,
  };
}

function routePriced(
  id: string,
  name: string,
  pricingComponentId: string,
): PricingCustomPropertyInput {
  return { customPropertyId: id, name, pricingComponentId, defaultPrice: null };
}

const TAR = fixedPrice("property-tar", "TAR", "35.00");
const FLAT = fixedPrice("property-flat", "Flat", "50.00");
const DETOUR = fixedPrice("property-detour", "Over Sint-Niklaas", "27.50");

const TOLL_PROPERTY = routePriced(
  "property-toll",
  "Toll",
  TOLL_COMPONENT_ID,
);
const TUNNEL_PROPERTY = routePriced(
  "property-tunnel",
  "Tunnel",
  TUNNEL_COMPONENT_ID,
);

const TOLL_COST: PricingRouteCostInput = {
  routeCostId: "cost-toll",
  pricingComponentId: TOLL_COMPONENT_ID,
  componentCode: "TOLL",
  amount: "9.75",
};

function buildContext(
  assignedCustomProperties: PricingCustomPropertyInput[] = [],
  routeCosts: PricingRouteCostInput[] = [],
): PricingCalculationContext {
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

describe("CustomPropertyCalculator", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let calculator: CustomPropertyCalculator;

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    calculator = new CustomPropertyCalculator(
      logger as unknown as AppLoggerService,
    );
  });

  /**
   * A property with no component link is priced by its own default price; a
   * linked one was already priced by the Toll or Tunnel step from the route.
   * The single field separates them exactly.
   */
  describe("applicability", () => {
    it("produces no line for a Trip carrying no properties", () => {
      expect(calculator.calculate(buildContext([]))).toEqual([]);
    });

    it("produces exactly one line for one fixed-price property", () => {
      const lines = calculator.calculate(buildContext([TAR]));

      expect(lines).toHaveLength(1);
      expect(lines[0].component).toBe(PricingComponentCode.CUSTOM_PROPERTY);
    });

    it("produces one line per fixed-price property", () => {
      const lines = calculator.calculate(buildContext([TAR, FLAT, DETOUR]));

      expect(lines).toHaveLength(3);
      expect(lines.map((line) => line.amount.toFixed(2))).toEqual([
        "35.00",
        "50.00",
        "27.50",
      ]);
    });

    it("excludes a TOLL-linked property", () => {
      expect(calculator.calculate(buildContext([TOLL_PROPERTY]))).toEqual([]);
    });

    it("excludes a TUNNEL-linked property", () => {
      expect(calculator.calculate(buildContext([TUNNEL_PROPERTY]))).toEqual([]);
    });

    /**
     * The rule is "has no component link", not a list of excluded codes, so a
     * route-priced component invented later is excluded with no code change.
     */
    it("excludes a route-priced component that does not exist yet", () => {
      const future = routePriced(
        "property-future",
        "Ferry",
        FUTURE_COMPONENT_ID,
      );

      expect(calculator.calculate(buildContext([future]))).toEqual([]);
    });

    it("prices the fixed ones and skips the linked ones in a mixed set", () => {
      const lines = calculator.calculate(
        buildContext([TAR, TOLL_PROPERTY, FLAT, TUNNEL_PROPERTY]),
      );

      expect(lines).toHaveLength(2);
      expect(lines.map((line) => line.customPropertyId)).toEqual([
        "property-tar",
        "property-flat",
      ]);
    });

    it("prices a property that has since been deactivated", () => {
      // The Trip carries it; withdrawing it from the catalog must not change
      // what an already-planned Trip is charged. Active state is not even
      // present on the context, and this step must not reintroduce it.
      const lines = calculator.calculate(buildContext([TAR]));

      expect(lines).toHaveLength(1);
    });

    it("never consults the route costs", () => {
      const withCosts = calculator.calculate(buildContext([TAR], [TOLL_COST]));
      const withoutCosts = calculator.calculate(buildContext([TAR], []));

      expect(withCosts.map((line) => line.amount.toFixed(2))).toEqual(
        withoutCosts.map((line) => line.amount.toFixed(2)),
      );

      const source = CustomPropertyCalculator.prototype.constructor.toString();

      expect(source).not.toContain("routeCosts");
    });
  });

  describe("the produced line", () => {
    function tarLine() {
      return calculator.calculate(buildContext([TAR]))[0];
    }

    it("takes its amount from the property's default price", () => {
      expect(tarLine().amount.toFixed(2)).toBe("35.00");
    });

    it("classifies the line with the catalog's CUSTOM_PROPERTY code", () => {
      expect(tarLine().component).toBe(PricingComponentCode.CUSTOM_PROPERTY);
    });

    it("carries the position pricing_rules.md gives the Custom Properties", () => {
      expect(tarLine().calculationOrder).toBe(
        CUSTOM_PROPERTY_CALCULATION_ORDER,
      );
      expect(CUSTOM_PROPERTY_CALCULATION_ORDER).toBe(7);
    });

    it("runs after the Tunnel", () => {
      expect(CUSTOM_PROPERTY_CALCULATION_ORDER).toBeGreaterThan(6);
    });

    it("describes the line with the property's name", () => {
      expect(tarLine().description).toBe("TAR");
    });

    it("names the property that produced the charge", () => {
      expect(tarLine().customPropertyId).toBe("property-tar");
    });

    it("carries no quantity and no unit price, being a flat amount", () => {
      expect(tarLine().quantity).toBeNull();
      expect(tarLine().unitPrice).toBeNull();
    });

    it("gives each line its own property reference", () => {
      const lines = calculator.calculate(buildContext([TAR, FLAT]));

      expect(lines.map((line) => line.customPropertyId)).toEqual([
        "property-tar",
        "property-flat",
      ]);
      expect(lines.map((line) => line.description)).toEqual(["TAR", "Flat"]);
    });
  });

  /**
   * The context supplies the properties in their configured display order.
   * Re-sorting here could only disagree with the order an administrator set.
   */
  describe("ordering", () => {
    it("follows the order the context supplies", () => {
      const lines = calculator.calculate(buildContext([DETOUR, TAR, FLAT]));

      expect(lines.map((line) => line.customPropertyId)).toEqual([
        "property-detour",
        "property-tar",
        "property-flat",
      ]);
    });

    it("is deterministic across repeated calls", () => {
      const context = buildContext([DETOUR, TAR, FLAT]);

      const first = calculator.calculate(context).map((l) => l.customPropertyId);
      const second = calculator
        .calculate(context)
        .map((l) => l.customPropertyId);

      expect(second).toEqual(first);
    });

    it("gives every line the same calculation order", () => {
      const lines = calculator.calculate(buildContext([TAR, FLAT, DETOUR]));

      expect(lines.map((line) => line.calculationOrder)).toEqual([7, 7, 7]);
    });
  });

  describe("a property with no configured price", () => {
    const UNPRICED = fixedPrice("property-unpriced", "Unpriced", null);

    it("refuses the calculation", () => {
      expect(() => calculator.calculate(buildContext([UNPRICED]))).toThrow(
        MissingCustomPropertyPriceException,
      );
    });

    it("carries the stable error code", () => {
      try {
        calculator.calculate(buildContext([UNPRICED]));
        throw new Error("expected the calculation to be refused");
      } catch (error) {
        expect((error as MissingCustomPropertyPriceException).code).toBe(
          "PRICING_MISSING_CUSTOM_PROPERTY_PRICE",
        );
      }
    });

    it("does not silently produce a zero line", () => {
      let produced: unknown;

      try {
        produced = calculator.calculate(buildContext([UNPRICED]));
      } catch {
        produced = undefined;
      }

      expect(produced).toBeUndefined();
    });

    it("does not silently skip the property", () => {
      expect(() =>
        calculator.calculate(buildContext([TAR, UNPRICED])),
      ).toThrow(MissingCustomPropertyPriceException);
    });

    it("names the property by id, never by name or price", () => {
      try {
        calculator.calculate(buildContext([UNPRICED]));
      } catch (error) {
        const message = (error as Error).message;

        expect(message).toContain("property-unpriced");
        expect(message).not.toContain("Unpriced");
      }
    });

    it("does not fire for a linked property, which correctly has no price", () => {
      expect(() =>
        calculator.calculate(buildContext([TOLL_PROPERTY])),
      ).not.toThrow();
    });
  });

  describe("decimal handling", () => {
    it("keeps the amount as a Decimal, never a JavaScript number", () => {
      expect(
        Prisma.Decimal.isDecimal(calculator.calculate(buildContext([TAR]))[0].amount),
      ).toBe(true);
    });

    it("produces a real line for a configured price of zero", () => {
      const free = fixedPrice("property-free", "Included", "0.00");

      const [line] = calculator.calculate(buildContext([free]));

      expect(line).toBeDefined();
      expect(line.component).toBe(PricingComponentCode.CUSTOM_PROPERTY);
      expect(line.amount.toFixed(2)).toBe("0.00");
      expect(line.customPropertyId).toBe("property-free");
    });

    it.each([
      ["0.01", "0.01"],
      ["27.50", "27.50"],
      ["35", "35.00"],
      ["9999999999.99", "9999999999.99"],
    ])("carries %s through exactly", (configured, expected) => {
      const [line] = calculator.calculate(
        buildContext([fixedPrice("property-x", "X", configured)]),
      );

      expect(line.amount.toFixed(2)).toBe(expected);
    });

    it("sums exactly across several properties, as a float would not", () => {
      const lines = calculator.calculate(
        buildContext([
          fixedPrice("a", "A", "0.10"),
          fixedPrice("b", "B", "0.20"),
        ]),
      );

      const total = lines.reduce(
        (running, line) => running.plus(line.amount),
        new Prisma.Decimal(0),
      );

      expect(total.toFixed(2)).toBe("0.30");
    });
  });

  describe("purity", () => {
    it("never mutates the context", () => {
      const context = buildContext([TAR, TOLL_PROPERTY]);
      const before = JSON.stringify(context);

      calculator.calculate(context);

      expect(JSON.stringify(context)).toBe(before);
    });

    it("ignores the preceding lines entirely", () => {
      const step: PricingCalculationStep = calculator;
      const context = buildContext([TAR]);

      const withoutPreceding = step.calculate(context, []);
      const withPreceding = step.calculate(context, [
        {
          component: PricingComponentCode.BASE_PRICE,
          description: "irrelevant",
          amount: new Prisma.Decimal("450.00"),
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
      const source = CustomPropertyCalculator.prototype.constructor.toString();

      expect(source).not.toContain("await");
      expect(source).not.toContain("Service");
      expect(source).not.toContain("prisma");
    });

    it("re-checks neither duplicates nor active state", () => {
      const source = CustomPropertyCalculator.prototype.constructor.toString();

      expect(source).not.toContain("isActive");
      expect(source).not.toContain("Set(");
      expect(source).not.toContain("sort(");
    });
  });

  describe("logging", () => {
    it("logs counts only", () => {
      calculator.calculate(buildContext([TAR, TOLL_PROPERTY]));

      expect(logger.log).toHaveBeenCalledWith(
        "Custom property calculation started",
        { tripId: TRIP_ID, assignedCount: 2 },
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Custom property calculation completed",
        { tripId: TRIP_ID, lineCount: 1 },
      );
    });

    it("never logs a price or a property name", () => {
      calculator.calculate(
        buildContext([fixedPrice("property-x", "Secret Name", "1234.56")]),
      );

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("1234.56");
      expect(logged).not.toContain("Secret Name");
    });

    it("logs only ids when refusing an unpriced property", () => {
      expect(() =>
        calculator.calculate(
          buildContext([fixedPrice("property-unpriced", "Secret Name", null)]),
        ),
      ).toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        "Fixed-price custom property has no configured price",
        { tripId: TRIP_ID, customPropertyId: "property-unpriced" },
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
        "Secret Name",
      );
    });
  });
});

/**
 * ── TAR ─────────────────────────────────────────────────────────────────────
 * TAR is an ordinary fixed-price Custom Property. Its amount is the price
 * CONFIGURED on the property — 20.00 in this system — and the calculator reads
 * it rather than knowing it: nothing here recognises the name "TAR", which is
 * what lets an administrator change the price without a code change.
 *
 * A Trip is charged TAR when TAR is assigned to it, once, and never otherwise.
 * That is what makes "only one leg of a Combination pays TAR" achievable today:
 * the operator assigns it to one leg. WHICH leg should own it automatically is
 * an open business question — see the phase report — and nothing here guesses.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("TAR", () => {
  const TAR_AT_TWENTY = fixedPrice("property-tar", "TAR", "20.00");

  let calculator: CustomPropertyCalculator;

  beforeEach(() => {
    calculator = new CustomPropertyCalculator({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as AppLoggerService);
  });

  it("charges the configured 20.00 to a Trip it is assigned to", () => {
    const lines = calculator.calculate(buildContext([TAR_AT_TWENTY]));

    expect(lines).toHaveLength(1);
    expect(lines[0].amount.toFixed(2)).toBe("20.00");
    expect(lines[0].customPropertyId).toBe("property-tar");
  });

  it("takes the amount from the configuration, not from its name", () => {
    // The same property at a different configured price. A calculator that
    // knew "TAR is 20" would ignore this and be wrong.
    const lines = calculator.calculate(
      buildContext([fixedPrice("property-tar", "TAR", "24.50")]),
    );

    expect(lines[0].amount.toFixed(2)).toBe("24.50");
  });

  it("charges nothing to a Trip it is not assigned to", () => {
    const lines = calculator.calculate(buildContext([]));

    expect(lines).toEqual([]);
  });

  /*
   * The two legs of a Combination are priced independently — each is its own
   * calculation — so TAR is charged exactly where it is assigned. Assigning it
   * to one leg charges it once for the pair, whichever leg that is.
   */
  it("is charged once for a Combination when one leg carries it", () => {
    const carrying = calculator.calculate(buildContext([TAR_AT_TWENTY]));
    const other = calculator.calculate(buildContext([]));

    expect(carrying).toHaveLength(1);
    expect(carrying[0].amount.toFixed(2)).toBe("20.00");
    expect(other).toEqual([]);
  });

  it("is charged twice when both legs carry it — which is why one must not", () => {
    const first = calculator.calculate(buildContext([TAR_AT_TWENTY]));
    const second = calculator.calculate(buildContext([TAR_AT_TWENTY]));

    // Recorded, not endorsed: nothing in the system stops this today, and
    // nothing decides which leg should have been left out.
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it("does not depend on which leg is the delivery or the collection", () => {
    const asDelivery = calculator.calculate(buildContext([TAR_AT_TWENTY]));
    const asCollection = calculator.calculate(buildContext([TAR_AT_TWENTY]));

    // Direction plays no part in the amount. It could only decide WHERE the
    // property is assigned, and that decision has not been made.
    expect(asDelivery[0].amount.toFixed(2)).toBe(
      asCollection[0].amount.toFixed(2),
    );
  });
});
