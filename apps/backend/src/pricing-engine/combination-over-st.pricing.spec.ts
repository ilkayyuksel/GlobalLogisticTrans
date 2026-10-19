import { Prisma, TripDirection, TripStatus } from "@prisma/client";

import { CostConfirmationReadService } from "../cost-confirmations/cost-confirmation-read.service";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyReadService } from "../trip-custom-properties/trip-custom-property-read.service";
import { resolveEffectivePricing } from "../trip-pricing/effective-pricing";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import { BasePriceCalculator } from "./base-price.calculator";
import { CombinationSurchargeCalculator } from "./combination-surcharge.calculator";
import { CostConfirmationCalculator } from "./cost-confirmation.calculator";
import { CustomPropertyCalculator } from "./custom-property.calculator";
import { FuelSurchargeCalculator } from "./fuel-surcharge.calculator";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingEngineService } from "./pricing-engine.service";
import type { PricingLine } from "./pricing-line";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";
import { PricingStrategy } from "./pricing-settings";
import { RouteCostResolver } from "./route-cost.resolver";
import { TollCalculator } from "./toll.calculator";
import { TunnelCalculator } from "./tunnel.calculator";
import { WaitingTimeCalculator } from "./waiting-time.calculator";

/**
 * Over ST, priced end to end through the real calculators.
 *
 * ── THE RULE (OWNER, 19 OCTOBER 2026) ───────────────────────────────────────
 * The leg planned on the LATER day owes Over ST — whichever leg position the
 * configuration gives it. Its Tarief carries the OVER_ST_SURCHARGE Setting
 * (€70) once, always — Over ST configured or not — and the configured Over ST
 * Tarief, Toll and Tunnel are added component by component. On the same day,
 * or with a date missing, neither leg carries any of it; the earlier leg
 * never. Fuel follows the effective Tarief. The €50 Backload, waiting time,
 * Cost Confirmations and EK are untouched.
 *
 * Leg 1 delivers Quay 869 → GENT; Leg 2 collects LESSINES → Quay 869 — each
 * configured in its real driving direction.
 *
 * The Combination is the one configured for the PAIR of roads its two Trips
 * drive — Tarief, Toll, Tunnel and Over ST all come from that configuration.
 */

const LEG1_TRIP = "11111111-1111-4111-8111-111111111111";
const LEG2_TRIP = "22222222-2222-4222-8222-222222222222";
const GROUP = "trip-group-1";
const DOCUMENT = "pdf-1";
const LEG1_ROW = "leg-row-1";
const LEG2_ROW = "leg-row-2";

const RULES = {
  strategy: PricingStrategy.ROUTE_BASED,
  fuelPercentage: "15",
  combinationSurcharge: "50.00",
  overStSurcharge: "70.00",
  automaticCustomPropertyId: "property-tar",
  waitingTimeFreeMinutes: 120,
  waitingTimeThresholdMinutes: 150,
  waitingTimeBlockMinutes: 15,
  waitingTimeBlockPrice: "13.75",
  ruleVersion: "2026.1",
};

function trip(overrides: Partial<TripReadView>): TripReadView {
  return {
    id: LEG1_TRIP,
    bookingNumber: "BK-1",
    status: TripStatus.CLOSED,
    direction: TripDirection.DELIVERY,
    terminal: "PSA Quay 869",
    destinationCity: "GENT",
    planningDate: "2026-10-06",
    distanceKm: null,
    waitingTimeMinutes: null,
    tarNummer: null,
    tripGroupId: GROUP,
    pdfDocumentId: DOCUMENT,
    manualRoutePricingId: null,
    ...overrides,
  };
}

function legRow(id: string, position: 1 | 2, departure: string, destination: string, basePrice: string) {
  return {
    id,
    routeName: `${departure} - ${destination}`,
    departure,
    destination,
    basePrice,
    combinationGroupId: "combination-1",
    combinationLegPosition: position,
    reviewed: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function cost(id: string, code: "TOLL" | "TUNNEL", amount: string, routePricingId: string) {
  return {
    id,
    departure: "x",
    destination: "y",
    pricingComponentId: `component-${code}`,
    pricingComponent: { id: `component-${code}`, code, name: code },
    amount,
    routePricingId,
    notes: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

type OverSt = { tarief: string | null; toll: string | null; tunnel: string | null };

const FULL_OVER_ST: OverSt = { tarief: "50.00", toll: "10.00", tunnel: "3.00" };

describe("Over ST on the later leg of a Combination", () => {
  let leg1: TripReadView;
  let leg2: TripReadView;
  let overSt: OverSt;
  let configuredPair: boolean;
  let configuredLegs: ReturnType<typeof legRow>[];
  let surcharge: string;
  let costConfirmation: { ccNumbers: string[]; amount: string } | null;
  let snapshotWriter: { findExistingSnapshot: jest.Mock; writeSnapshot: jest.Mock };
  let engine: PricingEngineService;
  let components: PricingComponentResolver;

  beforeEach(() => {
    leg1 = trip({ id: LEG1_TRIP, planningDate: "2026-10-06" });
    leg2 = trip({
      id: LEG2_TRIP,
      direction: TripDirection.COLLECTION,
      destinationCity: "LESSINES",
      planningDate: "2026-10-07",
    });
    surcharge = "70.00";
    overSt = { ...FULL_OVER_ST };
    configuredPair = true;
    configuredLegs = [
      legRow(LEG1_ROW, 1, "Quay 869", "GENT", "100.00"),
      legRow(LEG2_ROW, 2, "LESSINES", "Quay 869", "80.00"),
    ];
    costConfirmation = null;

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    const trips = {
      findById: jest.fn(async (id: string) => (id === LEG1_TRIP ? leg1 : leg2)),
      findByGroupId: jest.fn(async () => [leg1, leg2]),
    };
    const combinationPricing = {
      findAll: jest.fn(async () =>
        configuredPair
          ? [
              {
                id: "combination-1",
                reviewed: false,
                legs: configuredLegs,
                overSt,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]
          : [],
      ),
    };
    const routePricing = { findAllOrdinary: jest.fn().mockResolvedValue([]) };
    const routeCosts = {
      findActiveForRoute: jest.fn().mockResolvedValue([]),
      findActiveForRoutePricing: jest.fn(async (id: string) =>
        id === LEG1_ROW
          ? [cost("t1", "TOLL", "20.00", LEG1_ROW), cost("u1", "TUNNEL", "10.00", LEG1_ROW)]
          : [cost("t2", "TOLL", "15.00", LEG2_ROW), cost("u2", "TUNNEL", "5.00", LEG2_ROW)],
      ),
    };
    snapshotWriter = {
      findExistingSnapshot: jest.fn().mockResolvedValue(null),
      writeSnapshot: jest.fn().mockResolvedValue("snapshot-1"),
    };
    const ruleResolver = {
      resolve: jest.fn(async () => ({ ...RULES, overStSurcharge: surcharge })),
      resolveDistanceRatePerKm: jest.fn(),
    } as unknown as PricingRuleResolver;

    components = new PricingComponentResolver(
        routePricing as unknown as RoutePricingService,
        combinationPricing as unknown as CombinationRoutePricingService,
        { findByTripId: jest.fn().mockResolvedValue([]) } as unknown as TripCustomPropertyReadService,
        { findById: jest.fn() } as unknown as CustomPropertyService,
        trips as unknown as TripReadService,
        ruleResolver,
        { hasBeenChargedToday: jest.fn().mockResolvedValue(false) } as never,
        logger,
      );
    engine = new PricingEngineService(
      trips as unknown as TripReadService,
      ruleResolver,
      components,
      new RouteCostResolver(routeCosts as never, logger),
      snapshotWriter as unknown as PricingSnapshotWriter,
      { findForTrip: async () => costConfirmation } as unknown as CostConfirmationReadService,
      [
        new BasePriceCalculator(logger),
        new CombinationSurchargeCalculator(logger),
        new FuelSurchargeCalculator(logger),
        new WaitingTimeCalculator(logger),
        new TollCalculator(logger),
        new TunnelCalculator(logger),
        new CustomPropertyCalculator(logger),
        new CostConfirmationCalculator(logger),
      ],
      logger,
    );
  });

  /** Per component code, summed — what the columns and exports read. */
  function columns(lines: readonly PricingLine[]): Record<string, string> {
    const sums: Record<string, Prisma.Decimal> = {};

    for (const line of lines) {
      sums[line.component] = (sums[line.component] ?? new Prisma.Decimal(0)).plus(line.amount);
    }

    return Object.fromEntries(Object.entries(sums).map(([code, sum]) => [code, sum.toFixed(2)]));
  }

  async function priced(tripId: string) {
    const { lines, totalPrice } = await engine.calculate(tripId);

    return { lines, totalPrice, columns: columns(lines) };
  }

  const overStLines = (lines: readonly PricingLine[]) =>
    lines.filter((line) => line.description === "Over ST");

  const surchargeLines = (lines: readonly PricingLine[]) =>
    lines.filter((line) => line.description === "Over ST toeslag");

  it("A. adds nothing when both legs are planned on the same day", async () => {
    leg2 = { ...leg2, planningDate: "2026-10-06" };

    const { lines, columns: amounts } = await priced(LEG2_TRIP);

    expect(amounts).toMatchObject({ BASE_PRICE: "80.00", TOLL: "15.00", TUNNEL: "5.00" });
    expect(overStLines(lines)).toEqual([]);
  });

  it("B/C. adds all three to Leg 2 when the planning dates differ", async () => {
    const { columns: amounts } = await priced(LEG2_TRIP);

    expect(amounts).toMatchObject({ BASE_PRICE: "200.00", TOLL: "25.00", TUNNEL: "8.00" });
  });

  /** I — its own lines, under the existing components, amounts exact. */
  it("I. writes each addition as its own Over ST line of its own component", async () => {
    const { lines } = await priced(LEG2_TRIP);

    expect(
      overStLines(lines).map((line) => [line.component, line.amount.toFixed(2)]),
    ).toEqual([
      ["BASE_PRICE", "50.00"],
      ["TOLL", "10.00"],
      ["TUNNEL", "3.00"],
    ]);
  });

  it.each([
    ["D. only the Tarief", { tarief: "50.00", toll: null, tunnel: null }, { BASE_PRICE: "200.00", TOLL: "15.00", TUNNEL: "5.00" }],
    ["E. only the Toll", { tarief: null, toll: "10.00", tunnel: null }, { BASE_PRICE: "150.00", TOLL: "25.00", TUNNEL: "5.00" }],
    ["F. only the Tunnel", { tarief: null, toll: null, tunnel: "3.00" }, { BASE_PRICE: "150.00", TOLL: "15.00", TUNNEL: "8.00" }],
    ["G. zero and unstated amounts", { tarief: "50.00", toll: "0.00", tunnel: null }, { BASE_PRICE: "200.00", TOLL: "15.00", TUNNEL: "5.00" }],
  ])("%s", async (_, configured, expected) => {
    overSt = configured;

    const { lines, columns: amounts } = await priced(LEG2_TRIP);

    expect(amounts).toMatchObject(expected);
    // A zero or unstated component writes no line at all, and nothing is NaN.
    for (const line of lines) {
      expect(line.amount.isNaN()).toBe(false);
    }
  });

  it("H. never touches the leg on the earlier day", async () => {
    const { lines, columns: amounts } = await priced(LEG1_TRIP);

    expect(amounts).toMatchObject({ BASE_PRICE: "100.00", TOLL: "20.00", TUNNEL: "10.00" });
    expect(overStLines(lines)).toEqual([]);
  });

  /**
   * J/K — only planningDate decides. The Engine's Trip view carries no other
   * date at all, so an original planning date, a document date or a creation
   * date cannot reach the rule.
   */
  it("J. ignores every date but planningDate", async () => {
    leg2 = { ...leg2, planningDate: "2026-10-06" };

    const { lines } = await priced(LEG2_TRIP);

    expect(overStLines(lines)).toEqual([]);
    expect(Object.keys(leg2)).not.toContain("originalPlanningDate");
  });

  it("K. applies on a different planningDate alone", async () => {
    const { lines } = await priced(LEG2_TRIP);

    expect(overStLines(lines)).toHaveLength(3);
  });

  it("charges nothing when either leg has no planning date", async () => {
    leg1 = { ...leg1, planningDate: null };

    const { lines } = await priced(LEG2_TRIP);

    expect(overStLines(lines)).toEqual([]);
  });

  /** Fuel follows the effective Tarief, as the business decided: 15% of 200. */
  it("charges fuel on the effective Tarief, the €70 included", async () => {
    const { columns: amounts } = await priced(LEG2_TRIP);

    expect(amounts.FUEL_SURCHARGE).toBe("30.00");
  });

  it("L. keeps the €50 Backload on both legs, never as Over ST", async () => {
    const leg2Priced = await priced(LEG2_TRIP);
    const leg1Priced = await priced(LEG1_TRIP);

    expect(leg2Priced.columns.COMBINATION).toBe("50.00");
    expect(leg1Priced.columns.COMBINATION).toBe("50.00");
    expect(
      leg2Priced.lines.filter((line) => line.component === "COMBINATION").map((line) => line.description),
    ).not.toContain("Over ST");
  });

  /** M — the EK rule is untouched: no waiting time, so EK is the confirmation. */
  it("M. leaves EK to the Cost Confirmations", async () => {
    costConfirmation = { ccNumbers: ["4139505"], amount: "27.50" };

    const { lines } = await priced(LEG2_TRIP);
    const effective = resolveEffectivePricing(toEngineAmounts(lines), []);

    expect(effective.ek.toFixed(2)).toBe("27.50");
    expect(effective.tarief.toFixed(2)).toBe("200.00");
  });

  /** N — a charged waiting time still becomes EK and supersedes the CC. */
  it("N. leaves the waiting time as EK when it is charged", async () => {
    costConfirmation = { ccNumbers: ["4139505"], amount: "27.50" };
    leg2 = { ...leg2, waitingTimeMinutes: 270 };

    const { lines } = await priced(LEG2_TRIP);
    const effective = resolveEffectivePricing(toEngineAmounts(lines), []);

    expect(effective.ek.toFixed(2)).toBe("137.50");
    expect(effective.others.toFixed(2)).toBe("0.00");
  });

  /** O — the stored total and the effective total agree, each amount once. */
  it("O. counts every Over ST amount exactly once in the total", async () => {
    const { lines, totalPrice } = await priced(LEG2_TRIP);
    const effective = resolveEffectivePricing(toEngineAmounts(lines), []);

    // 200 Tarief + 50 Backload + 30 fuel + 25 + 8
    expect(totalPrice.toFixed(2)).toBe("313.00");
    expect(effective.totaal.toFixed(2)).toBe("313.00");
  });

  /**
   * ── THE €70 OVER ST SURCHARGE ─────────────────────────────────────────────
   * Once, on the later leg's Tarief, exactly when Over ST applies. Produced by every
   * calculation from scratch, so it can neither accumulate nor outlive the rule.
   */
  describe("the Over ST surcharge", () => {
    it("adds it once to the later leg's Tarief, as its own Tarief line", async () => {
      const { lines } = await priced(LEG2_TRIP);

      expect(
        surchargeLines(lines).map((line) => [line.component, line.amount.toFixed(2)]),
      ).toEqual([["BASE_PRICE", "70.00"]]);
    });

    it("never accumulates over repeated calculations", async () => {
      snapshotWriter.findExistingSnapshot.mockResolvedValue({
        tripPricingId: "snapshot-1",
        calculationStatus: "CALCULATED",
        itemCount: 9,
      });

      const first = await priced(LEG2_TRIP);
      const second = await priced(LEG2_TRIP);
      const third = await priced(LEG2_TRIP);

      expect(surchargeLines(third.lines)).toHaveLength(1);
      expect(second.totalPrice.toFixed(2)).toBe(first.totalPrice.toFixed(2));
      expect(third.columns.BASE_PRICE).toBe("200.00");
    });

    it("disappears when the planning dates become equal again", async () => {
      expect(surchargeLines((await priced(LEG2_TRIP)).lines)).toHaveLength(1);

      leg2 = { ...leg2, planningDate: "2026-10-06" };
      const { lines, columns: amounts } = await priced(LEG2_TRIP);

      expect(surchargeLines(lines)).toEqual([]);
      expect(amounts.BASE_PRICE).toBe("80.00");
    });

    it.each([
      ["the leg on the earlier day", () => undefined, LEG1_TRIP],
      ["the same day", () => (leg2 = { ...leg2, planningDate: "2026-10-06" }), LEG2_TRIP],
      ["the same day, either leg", () => (leg2 = { ...leg2, planningDate: "2026-10-06" }), LEG1_TRIP],
      ["a missing planningDate", () => (leg2 = { ...leg2, planningDate: null }), LEG2_TRIP],
      ["a missing partner planningDate", () => (leg1 = { ...leg1, planningDate: null }), LEG2_TRIP],
      ["a pair not configured as a Combination", () => (configuredPair = false), LEG2_TRIP],
    ])("is not charged for %s", async (_name, arrange, tripId) => {
      arrange();

      expect(surchargeLines((await priced(tripId)).lines)).toEqual([]);
    });

    /** 0.00 is a statement: Over ST is configured, at zero — the €70 still applies. */
    it("is charged when every Over ST amount is configured as zero", async () => {
      overSt = { tarief: "0.00", toll: "0.00", tunnel: "0.00" };

      const { lines, columns: amounts } = await priced(LEG2_TRIP);

      expect(overStLines(lines)).toEqual([]);
      expect(surchargeLines(lines)).toHaveLength(1);
      expect(amounts).toMatchObject({ BASE_PRICE: "150.00", TOLL: "15.00", TUNNEL: "5.00" });
    });

    /** The €70 does not depend on Over ST being configured (owner, 19 October 2026). */
    it("is charged on a Combination with no Over ST configured, alone", async () => {
      overSt = { tarief: null, toll: null, tunnel: null };

      const { lines, columns: amounts } = await priced(LEG2_TRIP);

      expect(overStLines(lines)).toEqual([]);
      expect(
        surchargeLines(lines).map((line) => [line.component, line.amount.toFixed(2)]),
      ).toEqual([["BASE_PRICE", "70.00"]]);
      expect(amounts).toMatchObject({ BASE_PRICE: "150.00", TOLL: "15.00", TUNNEL: "5.00" });
    });

    it("follows the OVER_ST_SURCHARGE Setting", async () => {
      surcharge = "65.00";

      expect((await priced(LEG2_TRIP)).columns.BASE_PRICE).toBe("195.00");
    });

    it("stores the surcharge when a CLOSED Leg 2 is recalculated", async () => {
      await engine.calculateAndStore(LEG2_TRIP);

      const [result] = snapshotWriter.writeSnapshot.mock.calls[0];

      expect(surchargeLines(result.lines)).toHaveLength(1);
      expect(result.context.routeMatch).toEqual({
        routePricingId: LEG2_ROW,
        method: "EXACT",
        combinationRouteGroupId: "combination-1",
        combinationMatch: "MATCHED",
        selection: "AUTOMATIC",
        legs: [
          expect.objectContaining({ legPosition: 1, isPricedLeg: false, routePricingId: LEG1_ROW }),
          expect.objectContaining({ legPosition: 2, isPricedLeg: true, routePricingId: LEG2_ROW }),
        ],
      });
    });
  });

  /*
   * ── THE LATER DAY DECIDES, NOT THE LEG POSITION ──────────────────────────
   * The configuration's Leg 1 / Leg 2 says which road is which; it does not
   * say which Trip is driven second. The calendar does.
   */
  describe("the later leg, whatever its configured position", () => {
    it("charges configured Leg 1 when it is planned after Leg 2", async () => {
      leg1 = { ...leg1, planningDate: "2026-10-08" };

      const later = await priced(LEG1_TRIP);
      const earlier = await priced(LEG2_TRIP);

      // 100 + 50 Over ST + 70; 20 + 10; 10 + 3
      expect(later.columns).toMatchObject({ BASE_PRICE: "220.00", TOLL: "30.00", TUNNEL: "13.00" });
      expect(surchargeLines(later.lines)).toHaveLength(1);
      expect(earlier.columns).toMatchObject({ BASE_PRICE: "80.00", TOLL: "15.00", TUNNEL: "5.00" });
      expect(surchargeLines(earlier.lines)).toEqual([]);
    });

    it("moves to the other leg when the days are swapped", async () => {
      expect(surchargeLines((await priced(LEG2_TRIP)).lines)).toHaveLength(1);

      leg1 = { ...leg1, planningDate: "2026-10-07" };
      leg2 = { ...leg2, planningDate: "2026-10-06" };

      expect(surchargeLines((await priced(LEG2_TRIP)).lines)).toEqual([]);
      expect(surchargeLines((await priced(LEG1_TRIP)).lines)).toHaveLength(1);
    });

    it("compares calendar dates across a month and a year", async () => {
      leg1 = { ...leg1, planningDate: "2026-12-31" };
      leg2 = { ...leg2, planningDate: "2027-01-01" };

      expect(surchargeLines((await priced(LEG2_TRIP)).lines)).toHaveLength(1);
      expect(surchargeLines((await priced(LEG1_TRIP)).lines)).toEqual([]);
    });

    it("is charged on the later leg while its partner is still OPEN", async () => {
      leg1 = { ...leg1, status: TripStatus.OPEN };

      expect(surchargeLines((await priced(LEG2_TRIP)).lines)).toHaveLength(1);
    });

    it("charges only the later of two Trips driving the same road", async () => {
      leg2 = trip({ id: LEG2_TRIP, planningDate: "2026-10-07" });
      configuredLegs = [
        legRow(LEG1_ROW, 1, "Quay 869", "GENT", "100.00"),
        legRow(LEG2_ROW, 2, "Quay 869", "GENT", "100.00"),
      ];

      expect(surchargeLines((await priced(LEG2_TRIP)).lines)).toHaveLength(1);
      expect(surchargeLines((await priced(LEG1_TRIP)).lines)).toEqual([]);
    });
  });

  /** A pair nobody configured: the road match applies, and owes no Over ST. */
  it("charges no Over ST when the pair is not configured as a Combination", async () => {
    configuredPair = false;

    const { lines } = await priced(LEG2_TRIP);

    expect(overStLines(lines)).toEqual([]);
  });

  /** P/Q — a recalculation writes a new snapshot with the rule applied. */
  it("Q. stores Over ST when a CLOSED leg is recalculated", async () => {
    await engine.calculateAndStore(LEG2_TRIP);

    const [result] = snapshotWriter.writeSnapshot.mock.calls[0];

    expect(overStLines(result.lines)).toHaveLength(3);
  });

  it("R. stores no Over ST when a same-day leg is recalculated", async () => {
    leg2 = { ...leg2, planningDate: "2026-10-06" };

    await engine.calculateAndStore(LEG2_TRIP);

    const [result] = snapshotWriter.writeSnapshot.mock.calls[0];

    expect(overStLines(result.lines)).toEqual([]);
  });

  /** P — calculating alone never writes: a snapshot changes only when stored. */
  it("P. writes no snapshot merely by calculating", async () => {
    await engine.calculate(LEG2_TRIP);

    expect(snapshotWriter.writeSnapshot).not.toHaveBeenCalled();
  });

  /*
   * Which Trips a planningDate change reprices — asked after the new date is
   * stored. Both legs of the configured pair, whichever leg moved, because
   * either date can switch Over ST on or off, or move it to the other leg.
   */
  describe("the Trips a planningDate change reprices", () => {
    it("1. names both legs when Leg 1's date changes", async () => {
      leg1 = { ...leg1, planningDate: "2026-10-07" };

      await expect(components.legsPricedByPlanningDate(leg1)).resolves.toEqual([
        LEG1_TRIP,
        LEG2_TRIP,
      ]);
    });

    it("2. names both legs when Leg 2's own date changes", async () => {
      leg2 = { ...leg2, planningDate: "2026-10-08" };

      await expect(components.legsPricedByPlanningDate(leg2)).resolves.toEqual([
        LEG2_TRIP,
        LEG1_TRIP,
      ]);
    });

    it("3. Leg 1 moved onto Leg 2's day: Leg 2 loses its Over ST", async () => {
      leg1 = { ...leg1, planningDate: "2026-10-07" };
      const { columns: leg2Columns } = await priced(LEG2_TRIP);

      expect(leg2Columns.BASE_PRICE).toBe("80.00");
      expect(leg2Columns.TOLL).toBe("15.00");
      expect(leg2Columns.TUNNEL).toBe("5.00");
    });

    it("4. Leg 2 moved onto, then off, Leg 1's day: Over ST goes and comes back", async () => {
      leg2 = { ...leg2, planningDate: "2026-10-06" };
      expect((await priced(LEG2_TRIP)).columns.BASE_PRICE).toBe("80.00");

      leg2 = { ...leg2, planningDate: "2026-10-08" };
      const { columns: leg2Columns } = await priced(LEG2_TRIP);

      expect(leg2Columns.BASE_PRICE).toBe("200.00");
      expect(leg2Columns.TOLL).toBe("25.00");
      expect(leg2Columns.TUNNEL).toBe("8.00");
    });

    it("5. names nothing for an ordinary Trip outside any group", async () => {
      const ordinary = trip({ id: "ordinary", tripGroupId: null, direction: null });

      await expect(components.legsPricedByPlanningDate(ordinary)).resolves.toEqual([]);
    });

    it("6. names nothing when the pair is not configured as a Combination", async () => {
      configuredPair = false;

      await expect(components.legsPricedByPlanningDate(leg1)).resolves.toEqual([]);
    });
  });
});

function toEngineAmounts(lines: readonly PricingLine[]) {
  return lines.map((line) => ({
    componentCode: line.component,
    amount: line.amount,
    customPropertyId: line.customPropertyId,
    description: line.description,
    unitPrice: line.unitPrice,
  }));
}
