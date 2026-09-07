import { AppLoggerService } from "../logger/app-logger.service";
import { CostConfirmationCalculator } from "./cost-confirmation.calculator";
import { PricingCalculationContext } from "./pricing-calculation-context";
import { PricingComponentCode } from "./pricing-line";

/**
 * The Cost Confirmation as a pricing component.
 *
 * ── WHY IT IS CALCULATED AND NOT READ AT DISPLAY TIME ───────────────────────
 * The confirmed cost belongs in what the Trip is worth. Reading it only when a
 * screen asked would leave the persisted `total_price` disagreeing with the
 * total shown — two numbers for one Trip, one of them wrong wherever it was
 * read. So it becomes a stored line like every other component.
 *
 * The amount is taken VERBATIM. There is no rate and no threshold: the figure
 * was not derived, it was confirmed by the party paying it.
 */
function buildContext(
  costConfirmation: PricingCalculationContext["costConfirmation"],
): PricingCalculationContext {
  return {
    tripId: "trip-1",
    bookingNumber: "ANRDUB2602247",
    tripStatus: "CLOSED",
    planningDate: "2026-08-24",
    isCombination: false,
    waitingTimeMinutes: 0,
    route: { departure: "PSA Quay 869", destination: "Gent" },
    baseSource: {
      strategy: "ROUTE_BASED",
      routePricingId: "route-1",
      basePrice: "500.00",
    },
    rules: {} as PricingCalculationContext["rules"],
    assignedCustomProperties: [],
    routeCosts: [],
    costConfirmation,
    existingSnapshot: null,
    preparedAt: new Date("2026-08-28T10:00:00.000Z"),
  } as unknown as PricingCalculationContext;
}

describe("pricing a Cost Confirmation", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock };
  let calculator: CostConfirmationCalculator;

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn() };
    calculator = new CostConfirmationCalculator(
      logger as unknown as AppLoggerService,
    );
  });

  it("produces one line carrying the confirmed amount", () => {
    const lines = calculator.calculate(
      buildContext({ ccNumbers: ["CC4139505"], amount: "27.50" }),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].component).toBe(PricingComponentCode.COST_CONFIRMATION);
    expect(lines[0].amount.toFixed(2)).toBe("27.50");
  });

  /** The reference explains WHICH document an amount came from. */
  it("names the confirmation in the description", () => {
    const lines = calculator.calculate(
      buildContext({ ccNumbers: ["CC4149079"], amount: "165.00" }),
    );

    expect(lines[0].description).toBe("Cost confirmation CC4149079");
  });

  it("takes the amount verbatim rather than deriving one", () => {
    const lines = calculator.calculate(
      buildContext({ ccNumbers: ["CC1"], amount: "165.00" }),
    );

    expect(lines[0].amount.toFixed(2)).toBe("165.00");
    expect(lines[0].quantity).toBeNull();
    expect(lines[0].unitPrice).toBeNull();
  });

  /**
   * No confirmation is no line — not a line of zero, which would claim a
   * confirmed cost of nothing.
   */
  it("produces no line when the Trip has no confirmation", () => {
    expect(calculator.calculate(buildContext(null))).toEqual([]);
  });

  /** `cost_confirmation.trip_id` is unique, so one is all there can be. */
  it("never produces more than one line", () => {
    const lines = calculator.calculate(
      buildContext({ ccNumbers: ["CC1"], amount: "10.00" }),
    );

    expect(lines).toHaveLength(1);
  });

  /** It belongs to no Custom Property; that reference explains a different charge. */
  it("leaves the custom property reference empty", () => {
    const lines = calculator.calculate(
      buildContext({ ccNumbers: ["CC1"], amount: "10.00" }),
    );

    expect(lines[0].customPropertyId).toBeNull();
  });

  /** A log line identifies the document; the amount is never in it. */
  it("never logs the amount", () => {
    calculator.calculate(buildContext({ ccNumbers: ["CC1"], amount: "1234.56" }));

    expect(JSON.stringify(logger.log.mock.calls)).not.toContain("1234.56");
  });
});
