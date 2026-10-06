import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { waitingWindowMinutes } from "../trips/waiting-window";
import { PricingCalculationContext } from "./pricing-calculation-context";
import { PricingStrategy } from "./pricing-settings";
import { WaitingTimeCalculator } from "./waiting-time.calculator";

/**
 * From a waiting window to its charge, through the UNCHANGED calculator.
 *
 * ── WHAT THIS HOLDS IN PLACE ────────────────────────────────────────────────
 * The 06:00 → 20:00 rule decides how many minutes a window COUNTS for; it is
 * applied once, where `waiting_time_minutes` is derived. The Waiting Time
 * calculator then applies the configured threshold, allowance and blocks to
 * those minutes exactly as it always did — there is no second pricing rule.
 *
 * The configuration is the business's own (pricing_rules.md, "The configured
 * rule"): threshold 150, free 120, blocks of 15 at EUR 13.75.
 * ────────────────────────────────────────────────────────────────────────────
 */

const CONFIGURED_RULE = {
  thresholdMinutes: 150,
  freeMinutes: 120,
  blockMinutes: 15,
  blockPrice: "13.75",
};

function at(clock: string): Date {
  return new Date(`1970-01-01T${clock}:00.000Z`);
}

function contextFor(waitingTimeMinutes: number): PricingCalculationContext {
  return {
    tripId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    bookingNumber: "BK-2026-1001",
    tripStatus: TripStatus.CLOSED,
    planningDate: "2026-08-17",
    isCombination: false,
    waitingTimeMinutes,
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
      waitingTimeFreeMinutes: CONFIGURED_RULE.freeMinutes,
      waitingTimeThresholdMinutes: CONFIGURED_RULE.thresholdMinutes,
      waitingTimeBlockMinutes: CONFIGURED_RULE.blockMinutes,
      waitingTimeBlockPrice: CONFIGURED_RULE.blockPrice,
      ruleVersion: "2026.1",
    },
    assignedCustomProperties: [],
    routeCosts: [],
    overSt: null,
    costConfirmation: null,
    existingSnapshot: null,
    preparedAt: new Date("2026-08-17T09:00:00.000Z"),
  };
}

describe("a waiting window, priced by the existing Waiting Time rule", () => {
  const calculator = new WaitingTimeCalculator({
    setContext: jest.fn(),
    log: jest.fn(),
  } as unknown as AppLoggerService);

  function chargeFor(begin: string, end: string, nextDay: boolean) {
    const minutes = waitingWindowMinutes(at(begin), at(end), nextDay);
    const [line] = calculator.calculate(contextFor(minutes));

    return { minutes, line };
  }

  it.each([
    // begin, end, next day, counted, blocks, amount
    ["10:00", "12:30", false, 150, 2, "27.50"],
    ["10:00", "08:00", true, 720, 40, "550.00"],
    ["10:00", "12:00", true, 960, 56, "770.00"],
    ["06:00", "20:00", false, 840, 48, "660.00"],
    // Reaches the threshold only by adding the morning after the night.
    ["19:00", "07:30", true, 150, 2, "27.50"],
    ["18:00", "08:00", true, 240, 8, "110.00"],
  ])(
    "%s → %s, next day %s: %i counted minutes, %i blocks, EUR %s",
    (begin, end, nextDay, counted, blocks, amount) => {
      const { minutes, line } = chargeFor(begin, end, nextDay);

      expect(minutes).toBe(counted);
      expect(line.quantity?.toString()).toBe(String(blocks));
      expect(line.unitPrice?.toFixed(2)).toBe(CONFIGURED_RULE.blockPrice);
      expect(line.amount.toFixed(2)).toBe(amount);
    },
  );

  /**
   * Below the threshold nothing is charged — and the night no longer pushes a
   * window over it: 05:00 → 08:29 waited 3h29 but counts only 2h29.
   */
  it.each([
    ["10:00", "12:00", false, 120],
    ["05:00", "08:29", false, 149],
    ["22:00", "02:00", true, 0],
    ["20:00", "06:00", true, 0],
  ])("%s → %s, next day %s: %i counted minutes, no line", (begin, end, nextDay, counted) => {
    const { minutes, line } = chargeFor(begin, end, nextDay);

    expect(minutes).toBe(counted);
    expect(line).toBeUndefined();
  });
});
