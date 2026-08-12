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
const BLOCK_MINUTES = 30;
const BLOCK_PRICE = "25.00";

function buildContext(
  waitingTimeMinutes: number,
  overrides: {
    free?: number;
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
      waitingTimeFreeMinutes: overrides.free ?? FREE_MINUTES,
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
