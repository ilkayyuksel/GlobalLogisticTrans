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
const TUNNEL_COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

/**
 * The Toll: the route's length times one configured rate.
 *
 * ── WHAT THIS REPLACED ──────────────────────────────────────────────────────
 * A toll used to be an amount stored per route, and before that it also needed
 * an assigned Custom Property to say it applied at all. Both are gone. The road
 * contributes its LENGTH — a fact about that road, which changes only when the
 * road does — and the Settings contribute the price of one kilometre, which is
 * one number for the whole business rather than an amount to re-enter on every
 * route when tolls rise.
 *
 * ── AND WHAT SILENCE MEANS ──────────────────────────────────────────────────
 * Either half missing produces NO line rather than a line of zero: no line says
 * nobody has stated what this road costs, while a zero line would claim it was
 * considered and priced at nothing. A route stated AS nought kilometres is a
 * decision somebody made, so it does produce a line — of zero.
 *
 * The calculator stays pure: it reads the validated context and returns a line.
 * No lookup, no validation, no write.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TUNNEL_COST: PricingRouteCostInput = {
  routeCostId: "cost-tunnel",
  pricingComponentId: TUNNEL_COMPONENT_ID,
  componentCode: "TUNNEL",
  amount: "12.50",
};

/** A fixed-price property: carries its own amount, links to no component. */
const FLAT_PROPERTY: PricingCustomPropertyInput = {
  customPropertyId: "property-flat",
  name: "Flat",
  pricingComponentId: null,
  defaultPrice: "50.00",
};

interface Road {
  /** What the route configuration states, or null when nobody has. */
  readonly kilometres?: string | null;
  /** What Settings states a kilometre costs, or null when nobody has. */
  readonly ratePerKm?: string | null;
  readonly assignedCustomProperties?: PricingCustomPropertyInput[];
  readonly routeCosts?: PricingRouteCostInput[];
}

function buildContext({
  kilometres = "25.00",
  ratePerKm = "0.35",
  assignedCustomProperties = [],
  routeCosts = [],
}: Road = {}): PricingCalculationContext {
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
      tollRatePerKm: ratePerKm,
    },
    assignedCustomProperties,
    routeKilometres: kilometres,
    routeCosts,
    existingSnapshot: null,
    costConfirmation: null,
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

  /** The amount of the single line, or null when none was produced. */
  function tollOf(road: Road = {}): string | null {
    const [line] = calculator.calculate(buildContext(road));

    return line ? line.amount.toFixed(2) : null;
  }

  describe("the rule", () => {
    /** 25 kilometres at 0.35 each. */
    it("charges the route's length times the configured rate", () => {
      expect(tollOf({ kilometres: "25.00", ratePerKm: "0.35" })).toBe("8.75");
    });

    it("follows the rate, so one change reprices every road", () => {
      expect(tollOf({ kilometres: "25.00", ratePerKm: "0.40" })).toBe("10.00");
    });

    it("follows the distance, so a longer road costs more", () => {
      expect(tollOf({ kilometres: "100.00", ratePerKm: "0.35" })).toBe("35.00");
    });

    /** Distances are configured to two decimals, as `trip.distance_km` is. */
    it("charges a fractional distance exactly", () => {
      expect(tollOf({ kilometres: "12.50", ratePerKm: "0.35" })).toBe("4.38");
    });

    /**
     * Decimal throughout. 0.1 + 0.2 is the reason money is never a float in
     * this system, and a rate per kilometre multiplied by a distance is money.
     */
    it("multiplies as Decimal rather than as floating point", () => {
      expect(tollOf({ kilometres: "3.00", ratePerKm: "0.10" })).toBe("0.30");
    });

    /** Somebody decided this road is free, and the breakdown says so. */
    it("produces a line of zero for a road stated as nought kilometres", () => {
      expect(tollOf({ kilometres: "0.00", ratePerKm: "0.35" })).toBe("0.00");
    });

    /** And the same for a rate configured as nothing. */
    it("produces a line of zero when a kilometre costs nothing", () => {
      expect(tollOf({ kilometres: "25.00", ratePerKm: "0.00" })).toBe("0.00");
    });
  });

  describe("when nobody has said", () => {
    /**
     * No configuration for this route at all, or one whose distance is still
     * blank — including every route configured before distances existed.
     */
    it("produces no line when the route has no stated length", () => {
      expect(calculator.calculate(buildContext({ kilometres: null }))).toEqual(
        [],
      );
    });

    /** A rate nobody has configured charges nothing, and says nothing. */
    it("produces no line when no rate is configured", () => {
      expect(calculator.calculate(buildContext({ ratePerKm: null }))).toEqual(
        [],
      );
    });

    it("produces no line when neither is known", () => {
      expect(
        calculator.calculate(buildContext({ kilometres: null, ratePerKm: null })),
      ).toEqual([]);
    });
  });

  describe("what no longer decides it", () => {
    /*
     * ── THE ROAD DECIDES, NOT AN ASSIGNMENT ─────────────────────────────────
     * Whether a Trip pays a toll once depended on an assigned Custom Property
     * linked to TOLL, so a real charge was lost whenever nobody ticked the box.
     */
    it("needs no assigned property", () => {
      expect(tollOf({ assignedCustomProperties: [] })).toBe("8.75");
    });

    it("is unaffected by what the Trip carries", () => {
      expect(tollOf({ assignedCustomProperties: [FLAT_PROPERTY] })).toBe("8.75");
    });

    /** And no longer by a stored route cost, which is not where tolls live. */
    it("ignores the route's other costs", () => {
      expect(tollOf({ routeCosts: [TUNNEL_COST] })).toBe("8.75");
    });

    /** One road, one line, however many costs the route carries. */
    it("produces exactly one line", () => {
      expect(
        calculator.calculate(buildContext({ routeCosts: [TUNNEL_COST] })),
      ).toHaveLength(1);
    });

    /** The Tunnel is a separate charge and stays one; this never produces it. */
    it("never produces a tunnel line", () => {
      const components = calculator
        .calculate(buildContext({ routeCosts: [TUNNEL_COST] }))
        .map((line) => line.component);

      expect(components).toEqual([PricingComponentCode.TOLL]);
    });
  });

  describe("the produced line", () => {
    const [line] = new TollCalculator({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as AppLoggerService).calculate(buildContext());

    it("classifies itself with the catalog's TOLL code", () => {
      expect(line.component).toBe(PricingComponentCode.TOLL);
    });

    it("carries the position pricing_rules.md gives the Toll", () => {
      expect(line.calculationOrder).toBe(TOLL_CALCULATION_ORDER);
      expect(TOLL_CALCULATION_ORDER).toBe(5);
    });

    it("describes itself as Toll", () => {
      expect(line.description).toBe("Toll");
    });

    /**
     * ── IT SHOWS ITS OWN WORKING ──────────────────────────────────────────
     * The distance and the rate are kept on the line, which is what those two
     * columns are for — the waiting time keeps the price of one block in the
     * same place. So a breakdown can say WHY the toll is what it is, and a Trip
     * closed today keeps the rate that applied today: moving the setting
     * tomorrow cannot restate it.
     */
    it("records the distance it charged for", () => {
      expect(line.quantity?.toFixed(2)).toBe("25.00");
    });

    it("records the rate it charged at", () => {
      expect(line.unitPrice?.toFixed(2)).toBe("0.35");
    });

    it("names no custom property, because the amount is the road's", () => {
      expect(line.customPropertyId).toBeNull();
    });

    it("stores the amount at two decimals", () => {
      expect(line.amount.decimalPlaces()).toBeLessThanOrEqual(2);
    });
  });

  describe("purity", () => {
    it("never mutates the context", () => {
      const context = buildContext({ routeCosts: [TUNNEL_COST] });
      const before = JSON.stringify(context);

      calculator.calculate(context);

      expect(JSON.stringify(context)).toBe(before);
    });

    it("ignores the preceding lines entirely", () => {
      const context = buildContext();

      const withoutPreceding = calculator.calculate(context);
      const withPreceding = (calculator as PricingCalculationStep).calculate(
        context,
        [
          {
            component: PricingComponentCode.BASE_PRICE,
            description: "Base",
            amount: new Prisma.Decimal("380.00"),
            calculationOrder: 1,
            quantity: null,
            unitPrice: null,
            customPropertyId: null,
          },
        ],
      );

      expect(withPreceding.map((line) => line.amount.toFixed(2))).toEqual(
        withoutPreceding.map((line) => line.amount.toFixed(2)),
      );
    });

    it("performs no lookup and no persistence", () => {
      expect(Object.getOwnPropertyNames(TollCalculator.prototype)).toEqual([
        "constructor",
        "calculate",
        "tollLines",
        "tollLine",
      ]);
    });
  });

  describe("logging", () => {
    it("logs the trip and the line count only", () => {
      calculator.calculate(buildContext());

      const logged = logger.log.mock.calls.map(([, payload]) => payload);

      for (const payload of logged) {
        expect(Object.keys(payload ?? {}).sort()).not.toContain("amount");
      }
      expect(logger.log).toHaveBeenCalledWith(
        "Toll calculation completed",
        expect.objectContaining({ tripId: TRIP_ID, lineCount: 1 }),
      );
    });

    /** An amount is commercial information and never reaches the log. */
    it("never logs an amount", () => {
      calculator.calculate(buildContext());

      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("8.75");
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("0.35");
    });
  });
});
