import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingCalculationContext } from "./pricing-calculation-context";
import { PricingComponentCode } from "./pricing-line";
import { PricingStrategy } from "./pricing-settings";
import {
  WAITING_TIME_CALCULATION_ORDER,
  WaitingTimeCalculator,
} from "./waiting-time.calculator";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** The configuration used by pricing_examples.md and by the development seed. */
const FREE_MINUTES = 60;
const THRESHOLD_MINUTES = 0;
const BLOCK_MINUTES = 30;
const BLOCK_PRICE = "25.00";

function buildContext(
  waitingTimeMinutes: number,
  overrides: {
    free?: number;
    threshold?: number;
    blockMinutes?: number;
    blockPrice?: string;
  } = {},
): PricingCalculationContext {
  return {
    tripId: TRIP_ID,
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
      waitingTimeFreeMinutes: overrides.free ?? FREE_MINUTES,
      waitingTimeThresholdMinutes: overrides.threshold ?? THRESHOLD_MINUTES,
      waitingTimeBlockMinutes: overrides.blockMinutes ?? BLOCK_MINUTES,
      waitingTimeBlockPrice: overrides.blockPrice ?? BLOCK_PRICE,
      ruleVersion: "2026.1",
    },
    assignedCustomProperties: [],
    routeCosts: [],
    existingSnapshot: null,
    preparedAt: new Date("2026-08-17T09:00:00.000Z"),
  };
}

describe("WaitingTimeCalculator", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let calculator: WaitingTimeCalculator;

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    calculator = new WaitingTimeCalculator(
      logger as unknown as AppLoggerService,
    );
  });

  /**
   * Every worked example from pricing_examples.md, asserted as a table.
   *
   * The document and this test are the same specification written twice; if one
   * changes without the other, this fails.
   */
  describe("the worked examples in pricing_examples.md", () => {
    it.each([
      ["1/2. no waiting time", 0, undefined, 0, null],
      ["3. below the free allowance", 45, undefined, 0, null],
      ["4. exactly the free allowance", 60, undefined, 0, null],
      ["5. one billable block", 90, "25.00", 1, "30 billable minutes"],
      ["6. multiple billable blocks", 180, "100.00", 4, "120 billable minutes"],
      ["7. partial block rounds up", 105, "50.00", 2, "45 billable minutes"],
      ["8. one minute over the allowance", 61, "25.00", 1, "1 billable minutes"],
    ])(
      "example %s",
      (_case, waited, expectedAmount, expectedBlocks, expectedDescription) => {
        const lines = calculator.calculate(buildContext(waited as number));

        if (expectedAmount === undefined) {
          expect(lines).toEqual([]);
          return;
        }

        expect(lines).toHaveLength(1);
        expect(lines[0].amount.toFixed(2)).toBe(expectedAmount);
        expect(lines[0].quantity?.toFixed(0)).toBe(String(expectedBlocks));
        expect(lines[0].description).toBe(expectedDescription);
      },
    );

    it("example 9: a zero block price still produces a line", () => {
      const lines = calculator.calculate(
        buildContext(90, { blockPrice: "0.00" }),
      );

      expect(lines).toHaveLength(1);
      expect(lines[0].amount.toFixed(2)).toBe("0.00");
      expect(lines[0].quantity?.toFixed(0)).toBe("1");
    });

    it("example 10: no free allowance charges from the first minute", () => {
      const [line] = calculator.calculate(buildContext(10, { free: 0 }));

      expect(line.amount.toFixed(2)).toBe("25.00");
      expect(line.description).toBe("10 billable minutes");
    });
  });

  describe("no waiting time", () => {
    it("produces no line for zero minutes", () => {
      expect(calculator.calculate(buildContext(0))).toEqual([]);
    });

    it("produces no line rather than a line of zero", () => {
      // A zero line would claim waiting was charged at nothing; no line says
      // the component did not apply.
      const lines = calculator.calculate(buildContext(0));

      expect(lines).toHaveLength(0);
      expect(lines.map((line) => line.component)).not.toContain(
        PricingComponentCode.WAITING_TIME,
      );
    });

    it("produces no line even when a block price is configured", () => {
      expect(
        calculator.calculate(buildContext(0, { blockPrice: "999.99" })),
      ).toEqual([]);
    });
  });

  describe("the free allowance", () => {
    it("is deducted once, not per block", () => {
      // 180 waited, 60 free = 120 billable = 4 blocks, not 5.
      const [line] = calculator.calculate(buildContext(180));

      expect(line.quantity?.toFixed(0)).toBe("4");
    });

    it("is inclusive at its boundary", () => {
      expect(calculator.calculate(buildContext(FREE_MINUTES))).toEqual([]);
    });

    it("charges a whole block one minute past its boundary", () => {
      const [line] = calculator.calculate(buildContext(FREE_MINUTES + 1));

      expect(line.quantity?.toFixed(0)).toBe("1");
      expect(line.amount.toFixed(2)).toBe("25.00");
    });

    it("never produces negative billable minutes", () => {
      expect(calculator.calculate(buildContext(1, { free: 10_000 }))).toEqual(
        [],
      );
    });
  });

  describe("block rounding", () => {
    it.each([
      [61, 1],
      [89, 1],
      [90, 1],
      [91, 2],
      [105, 2],
      [120, 2],
      [121, 3],
    ])("charges %d waited minutes as %d block(s)", (waited, expectedBlocks) => {
      const [line] = calculator.calculate(buildContext(waited));

      expect(line.quantity?.toFixed(0)).toBe(String(expectedBlocks));
    });

    it("charges a started block in full", () => {
      // 45 billable minutes is one and a half blocks; both are charged.
      const [line] = calculator.calculate(buildContext(105));

      expect(line.amount.toFixed(2)).toBe("50.00");
    });

    it("handles a block size of one minute", () => {
      const [line] = calculator.calculate(
        buildContext(75, { blockMinutes: 1 }),
      );

      expect(line.quantity?.toFixed(0)).toBe("15");
      expect(line.amount.toFixed(2)).toBe("375.00");
    });

    it("handles a block larger than the billable time", () => {
      const [line] = calculator.calculate(
        buildContext(70, { blockMinutes: 1440 }),
      );

      expect(line.quantity?.toFixed(0)).toBe("1");
    });
  });

  describe("the produced line", () => {
    it("classifies the line with the catalog's WAITING_TIME code", () => {
      const [line] = calculator.calculate(buildContext(90));

      expect(line.component).toBe(PricingComponentCode.WAITING_TIME);
    });

    it("carries the position pricing_rules.md gives the Waiting Time", () => {
      const [line] = calculator.calculate(buildContext(90));

      expect(line.calculationOrder).toBe(WAITING_TIME_CALCULATION_ORDER);
      expect(WAITING_TIME_CALCULATION_ORDER).toBe(4);
    });

    it("records the block count as quantity and the block price as unit price", () => {
      const [line] = calculator.calculate(buildContext(150));

      expect(line.quantity?.toFixed(2)).toBe("3.00");
      expect(line.unitPrice?.toFixed(2)).toBe("25.00");
    });

    it("describes the billable minutes, as the seeded snapshot does", () => {
      const [line] = calculator.calculate(buildContext(90));

      expect(line.description).toBe("30 billable minutes");
    });

    it("produces exactly one line and no other component", () => {
      const lines = calculator.calculate(buildContext(90));

      expect(lines.map((line) => line.component)).toEqual([
        PricingComponentCode.WAITING_TIME,
      ]);
    });
  });

  describe("decimal precision", () => {
    it("returns Decimal amounts, never JavaScript numbers", () => {
      const [line] = calculator.calculate(buildContext(90));

      expect(Prisma.Decimal.isDecimal(line.amount)).toBe(true);
      expect(Prisma.Decimal.isDecimal(line.quantity as Prisma.Decimal)).toBe(
        true,
      );
      expect(Prisma.Decimal.isDecimal(line.unitPrice as Prisma.Decimal)).toBe(
        true,
      );
    });

    it("keeps a decimal block price exact across many blocks", () => {
      // 3 x 0.07 is 0.21000000000000002 in binary floating point.
      const [line] = calculator.calculate(
        buildContext(150, { blockPrice: "0.07" }),
      );

      expect(line.amount.toFixed(2)).toBe("0.21");
    });

    it("keeps a one-decimal block price exact", () => {
      const [line] = calculator.calculate(
        buildContext(150, { blockPrice: "12.5" }),
      );

      expect(line.amount.toFixed(2)).toBe("37.50");
    });

    it("keeps a large charge exact", () => {
      const [line] = calculator.calculate(
        buildContext(600, { blockPrice: "9999.99" }),
      );

      // 18 blocks x 9999.99
      expect(line.amount.toFixed(2)).toBe("179999.82");
    });
  });

  describe("interaction with the earlier steps", () => {
    it("is priced from Trip data alone, so it never receives earlier lines", () => {
      // Waiting time depends on no other component, unlike the Fuel Surcharge.
      expect(calculator.calculate).toHaveLength(1);
    });
  });

  describe("logging", () => {
    it("logs the start and the completion", () => {
      calculator.calculate(buildContext(90));

      expect(logger.log).toHaveBeenNthCalledWith(
        1,
        "Waiting time calculation started",
        { tripId: TRIP_ID },
      );
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        "Waiting time calculation completed",
        { tripId: TRIP_ID, lineCount: 1 },
      );
    });

    it("logs both events even when no line is produced", () => {
      calculator.calculate(buildContext(0));

      expect(logger.log).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        "Waiting time calculation completed",
        { tripId: TRIP_ID, lineCount: 0 },
      );
    });

    it("never logs an amount or a block price", () => {
      calculator.calculate(buildContext(90, { blockPrice: "82.35" }));

      const logged = JSON.stringify(logger.log.mock.calls);

      expect(logged).not.toContain("82.35");

      for (const [, payload] of logger.log.mock.calls) {
        expect(Object.keys(payload as object)).toEqual(
          expect.not.arrayContaining([
            "amount",
            "blockPrice",
            "unitPrice",
            "waitingTimeBlockPrice",
          ]),
        );
      }
    });
  });

  describe("validation is not duplicated", () => {
    it("performs no lookup and raises nothing itself", () => {
      // A missing setting, or a block size of zero, is rejected by
      // PricingRuleResolver before any step runs.
      const source = WaitingTimeCalculator.prototype.constructor.toString();

      expect(source).not.toContain("await");
      expect(source).not.toContain("Service");
      expect(source).not.toContain("throw new");
    });

    it("calculates no other pricing component", () => {
      const source = WaitingTimeCalculator.prototype.constructor.toString();

      expect(source).not.toContain("fuelPercentage");
      expect(source).not.toContain("combinationSurcharge");
      expect(source).not.toContain("basePrice");
    });
  });
});

/**
 * ── THE OPERATOR'S WAITING-TIME RULE ────────────────────────────────────────
 * Stated by the business in hours and minutes:
 *
 *   the first 2 hours are free;
 *   2h15 is still entirely free;
 *   charging starts at 2h30, and then covers everything past the 2 hours;
 *   €55.00 per chargeable hour.
 *
 * Expressed in the configuration the Pricing Engine already has:
 *
 *   WAITING_TIME_THRESHOLD_MINUTES = 150   charging starts at 2h30
 *   WAITING_TIME_FREE_MINUTES      = 120   the first 2 hours are never charged
 *   WAITING_TIME_BLOCK_MINUTES     = 15    a quarter of an hour
 *   WAITING_TIME_BLOCK_PRICE       = 13.75 €55.00 per hour
 *
 * Both the threshold and the allowance are needed. Without the threshold, 2h15
 * would cost a block; without the allowance, 2h30 would be charged for its full
 * two and a half hours.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the waiting-time rule as the business stated it", () => {
  const RULE = {
    threshold: 150,
    free: 120,
    blockMinutes: 15,
    blockPrice: "13.75",
  };

  let calculator: WaitingTimeCalculator;

  beforeEach(() => {
    calculator = new WaitingTimeCalculator({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as AppLoggerService);
  });

  /** The amount for a wait, or null when the component did not apply. */
  function amountFor(minutes: number): string | null {
    const lines = calculator.calculate(buildContext(minutes, RULE));

    return lines.length === 0 ? null : lines[0].amount.toFixed(2);
  }

  /*
   * Every value the business listed, and the boundaries either side of the
   * threshold. A wait short of 2h30 produces NO line at all — not a line of
   * zero: the component did not apply.
   */
  it.each([
    [0, null],
    [60, null],
    [120, null],
    [129, null],
    [135, null],
    [139, null],
    [140, null],
    [149, null],
    [150, "27.50"],
    [165, "41.25"],
    [180, "55.00"],
    [195, "68.75"],
    [210, "82.50"],
  ])("charges %i minutes of waiting as %s", (minutes, expected) => {
    expect(amountFor(minutes)).toBe(expected);
  });

  it("charges nothing for a wait one minute short of the threshold", () => {
    expect(amountFor(149)).toBeNull();
    expect(amountFor(150)).toBe("27.50");
  });

  /*
   * The threshold does not become the deduction. At 2h30 the charge covers the
   * 30 minutes past the 2-hour allowance — not the 0 minutes past the
   * threshold, which would be free, and not the full 150 minutes.
   */
  it("deducts the allowance, not the threshold", () => {
    const [line] = calculator.calculate(buildContext(150, RULE));

    expect(line.description).toBe("30 billable minutes");
    expect(line.quantity?.toFixed(0)).toBe("2");
    expect(line.unitPrice?.toFixed(2)).toBe("13.75");
  });

  it("prices a whole extra hour at exactly 55.00", () => {
    expect(amountFor(180)).toBe("55.00");
    expect(amountFor(240)).toBe("110.00");
  });

  /*
   * Money is Decimal from end to end. 13.75 is not representable in binary
   * floating point, and 5 blocks of it is where a float implementation drifts:
   * 5 * 13.75 is exact here, and 3 * 13.75 = 41.25 rather than 41.249999…
   */
  it("uses exact decimal arithmetic, never floating point", () => {
    for (const [minutes, expected] of [
      [165, "41.25"],
      [195, "68.75"],
      [255, "123.75"],
      [285, "151.25"],
    ] as const) {
      expect(amountFor(minutes)).toBe(expected);
    }
  });

  it("stores the amount as a Decimal, not a number", () => {
    const [line] = calculator.calculate(buildContext(150, RULE));

    expect(Prisma.Decimal.isDecimal(line.amount)).toBe(true);
    expect(line.amount.toFixed(2)).toBe("27.50");
  });

  /*
   * A minute past a block boundary costs the whole block. That rounding rule is
   * the one pricing_rules.md already states — "every block that is STARTED is
   * charged in full" — and it is not changed here.
   */
  it("charges a started block in full, as the existing rule requires", () => {
    // 151 minutes: 31 billable, which is three started quarter-hours.
    expect(amountFor(151)).toBe("41.25");
    expect(amountFor(155)).toBe("41.25");
    expect(amountFor(164)).toBe("41.25");
    expect(amountFor(166)).toBe("55.00");
  });

  it("classifies the line as WAITING_TIME at the fourth step", () => {
    const [line] = calculator.calculate(buildContext(150, RULE));

    expect(line.component).toBe(PricingComponentCode.WAITING_TIME);
    expect(line.calculationOrder).toBe(WAITING_TIME_CALCULATION_ORDER);
    expect(line.customPropertyId).toBeNull();
  });
});
