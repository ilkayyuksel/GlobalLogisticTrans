import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { TripDirection, TripStatus } from "@prisma/client";

import { CostConfirmationReadService } from "../cost-confirmations/cost-confirmation-read.service";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { TripCustomPropertyReadService } from "../trip-custom-properties/trip-custom-property-read.service";
import { TripReadService, TripReadView } from "../trips/trip-read.service";
import { BasePriceCalculator } from "./base-price.calculator";
import { CombinationSurchargeCalculator } from "./combination-surcharge.calculator";
import { CostConfirmationCalculator } from "./cost-confirmation.calculator";
import { CustomPropertyCalculator } from "./custom-property.calculator";
import { FuelSurchargeCalculator } from "./fuel-surcharge.calculator";
import { PricingComponentResolver } from "./pricing-component.resolver";
import { PricingEngineService } from "./pricing-engine.service";
import { PricingRuleResolver } from "./pricing-rule.resolver";
import { PricingSnapshotWriter } from "./pricing-snapshot.writer";
import { PricingStrategy } from "./pricing-settings";
import { RouteCostResolver } from "./route-cost.resolver";
import { TollCalculator } from "./toll.calculator";
import { TunnelCalculator } from "./tunnel.calculator";
import { WaitingTimeCalculator } from "./waiting-time.calculator";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PARTNER_TRIP_ID = "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f";
const GROUP_ID = "7d2b8c14-9f3a-4c5e-8b1d-2e3f4a5b6c7d";
const DOCUMENT_ID = "pdf-combination-1";

const NORMAL_ROUTE_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const COMBINATION_LEG_ID = "5a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";


/**
 * ONE ROAD, TWO CONFIGURATIONS — and a Trip is priced against the right one.
 *
 * ── THE SITUATION ───────────────────────────────────────────────────────────
 * Antwerp to Kallo is configured twice. As an ordinary route it costs 380 with a
 * tunnel of 12.50. As the outbound leg of a Combination it costs 100 with a
 * tunnel of 3.75, because a Combination's outbound and return are their own
 * transports and priced as such.
 *
 * Both are legitimate and neither is a duplicate of the other. What decides
 * which applies is `combinationLegOf` — the same rule that decides which leg of
 * a genuine Combination owes the TAR — and then the PAIR of roads: a genuine
 * Combination leg takes the Combination configured for both its roads; every
 * other Trip, a group an operator made by hand included, and a pair no
 * Combination is configured for, takes the ordinary one.
 *
 * ── WHY THIS RUNS THE WHOLE CHAIN ───────────────────────────────────────────
 * The failure this guards against is not visible in any single unit: it is one
 * component reading one configured row and another component reading a
 * different one, so a Trip comes out with the Combination's Tarief and the
 * ordinary route's tunnel. So these tests run the REAL calculators over the real
 * resolvers, and assert every amount a screen would show.
 *
 * ── AND THE BACKLOAD IS NOT PART OF IT ──────────────────────────────────────
 * The €50 follows TripGroup membership and nothing else. It is asserted here
 * precisely because these tests configure Combination ROUTES: the two must stay
 * independent, and a grouped Trip keeps its €50 whether a Combination route is
 * configured for its road or not.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<TripReadView> = {}): TripReadView {
  return {
    id: TRIP_ID,
    pdfDocumentId: DOCUMENT_ID,
    // No TAR-nummer: the automatic property is not what these tests are about,
    // and a charge for it would only obscure the four amounts that are.
    tarNummer: null,
    tripGroupId: null,
    status: TripStatus.CLOSED,
    direction: null,
    bookingNumber: "ANRDUB2602247",
    terminal: "Antwerp",
    destinationCity: "Kallo",
    planningDate: "2026-09-26",
    waitingTimeMinutes: null,
    distanceKm: null,
    ...overrides,
  };
}

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

/** The ordinary configuration of Antwerp to Kallo. */
const NORMAL_ROUTE = {
  id: NORMAL_ROUTE_ID,
  routeName: "Antwerp - Kallo",
  departure: "Antwerp",
  destination: "Kallo",
  basePrice: "380.00",
  kilometres: "40.00",
  combinationGroupId: null,
  combinationLegPosition: null,
  notes: null,
  createdAt: new Date("2026-09-26T00:00:00Z"),
  updatedAt: new Date("2026-09-26T00:00:00Z"),
};

/** The Combination configuration of the same road, priced for itself. */
const COMBINATION_LEG = {
  ...NORMAL_ROUTE,
  id: COMBINATION_LEG_ID,
  basePrice: "100.00",
  kilometres: "25.00",
  combinationGroupId: GROUP_ID,
  combinationLegPosition: 1,
};

/** Its return: a collection, configured city → terminal as it is driven. */
function combinationOf(returnFrom: string) {
  return {
    id: GROUP_ID,
    reviewed: false,
    legs: [
      COMBINATION_LEG,
      {
        ...NORMAL_ROUTE,
        id: "return-leg",
        routeName: `${returnFrom} - Antwerp`,
        departure: returnFrom,
        destination: "Antwerp",
        basePrice: "90.00",
        combinationGroupId: GROUP_ID,
        combinationLegPosition: 2,
      },
    ],
    overSt: { tarief: null, toll: null, tunnel: null },
    createdAt: new Date("2026-09-26T00:00:00Z"),
    updatedAt: new Date("2026-09-26T00:00:00Z"),
  };
}

function tunnelCost(id: string, amount: string, routePricingId: string | null) {
  return routeCost(id, "TUNNEL", amount, routePricingId);
}

/** The toll is a route cost again, owned by the road or by the leg. */
function tollCost(id: string, amount: string, routePricingId: string | null) {
  return routeCost(id, "TOLL", amount, routePricingId);
}

function routeCost(
  id: string,
  code: "TOLL" | "TUNNEL",
  amount: string,
  routePricingId: string | null,
) {
  return {
    id,
    departure: "Antwerp",
    destination: "Kallo",
    pricingComponentId: `component-${code}`,
    pricingComponent: {
      id: `component-${code}`,
      code,
      name: code,
    },
    amount,
    routePricingId,
    notes: null,
    isActive: true,
    createdAt: new Date("2026-09-26T00:00:00Z"),
    updatedAt: new Date("2026-09-26T00:00:00Z"),
  };
}

/**
 * The outbound and the return of one document — a genuine Combination. The
 * outbound delivers Antwerp → Kallo; the return collects Zwijndrecht → Antwerp.
 */
function genuinePair(): TripReadView[] {
  return [
    buildTrip({ tripGroupId: GROUP_ID, direction: TripDirection.DELIVERY }),
    buildTrip({
      id: PARTNER_TRIP_ID,
      tripGroupId: GROUP_ID,
      direction: TripDirection.COLLECTION,
      destinationCity: "Zwijndrecht",
    }),
  ];
}

/** Two Trips an operator put together, from different documents. */
function manualGroup(): TripReadView[] {
  const [outbound, partner] = genuinePair();

  return [outbound, { ...partner, pdfDocumentId: "pdf-unrelated" }];
}

describe("one road configured as an ordinary route and as a Combination leg", () => {
  let trips: { findById: jest.Mock; findByGroupId: jest.Mock };
  let routePricing: { findAllOrdinary: jest.Mock };
  let combinationPricing: { findAll: jest.Mock };
  let routeCosts: {
    findActiveForRoute: jest.Mock;
    findActiveForRoutePricing: jest.Mock;
  };
  let snapshotWriter: {
    findExistingSnapshot: jest.Mock;
    writeSnapshot: jest.Mock;
  };
  let engine: PricingEngineService;

  beforeEach(() => {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    trips = {
      findById: jest.fn().mockResolvedValue(buildTrip()),
      findByGroupId: jest.fn().mockResolvedValue([]),
    };

    // Both configurations exist, each in its own scope — exactly how the two
    // partial unique indexes let them coexist.
    routePricing = { findAllOrdinary: jest.fn().mockResolvedValue([NORMAL_ROUTE]) };
    combinationPricing = {
      findAll: jest.fn().mockResolvedValue([combinationOf("Zwijndrecht")]),
    };

    routeCosts = {
      // The road's tunnel: what every ordinary Trip on it pays.
      findActiveForRoute: jest
        .fn()
        .mockResolvedValue([
          tollCost("cost-road-toll", "15.60", null),
          tunnelCost("cost-road", "12.50", null),
        ]),
      // The leg's own tunnel, owned by the leg and reached only through it.
      findActiveForRoutePricing: jest
        .fn()
        .mockResolvedValue([
          tollCost("cost-leg-toll", "9.75", COMBINATION_LEG_ID),
          tunnelCost("cost-leg", "3.75", COMBINATION_LEG_ID),
        ]),
    };

    snapshotWriter = {
      findExistingSnapshot: jest.fn().mockResolvedValue(null),
      writeSnapshot: jest.fn().mockResolvedValue(undefined),
    };

    const ruleResolver = {
      resolve: jest.fn().mockResolvedValue(RULES),
      resolveDistanceRatePerKm: jest.fn(),
    } as unknown as PricingRuleResolver;

    engine = new PricingEngineService(
      trips as unknown as TripReadService,
      ruleResolver,
      new PricingComponentResolver(
        routePricing as unknown as RoutePricingService,
        combinationPricing as unknown as CombinationRoutePricingService,
        { findByTripId: jest.fn().mockResolvedValue([]) } as unknown as
          TripCustomPropertyReadService,
        {
          findById: jest.fn(),
        } as unknown as CustomPropertyService,
        trips as unknown as TripReadService,
        ruleResolver,
        { hasBeenChargedToday: jest.fn().mockResolvedValue(false) } as never,
        logger,
      ),
      new RouteCostResolver(routeCosts as never, logger),
      snapshotWriter as unknown as PricingSnapshotWriter,
      { findForTrip: async () => null } as unknown as CostConfirmationReadService,
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

  /** Every amount the chain produced, by component code. */
  async function amountsOf(): Promise<Record<string, string>> {
    const { lines } = await engine.calculate(TRIP_ID);

    return Object.fromEntries(
      lines.map((line) => [line.component, line.amount.toFixed(2)]),
    );
  }

  describe("an ordinary Trip", () => {
    it("is priced against the ordinary configuration, not the Combination", async () => {
      expect(await amountsOf()).toMatchObject({
        BASE_PRICE: "380.00",
        // The ordinary route's own toll, not the leg's.
        TOLL: "15.60",
        TUNNEL: "12.50",
      });
    });

    it("carries no Backload, because it is in no group", async () => {
      expect(await amountsOf()).not.toHaveProperty("COMBINATION");
    });

    it("never reads a Combination leg's tunnel", async () => {
      await engine.calculate(TRIP_ID);

      expect(routeCosts.findActiveForRoutePricing).not.toHaveBeenCalled();
    });
  });

  describe("a genuine Combination leg", () => {
    beforeEach(() => {
      trips.findById.mockResolvedValue(
        buildTrip({
          tripGroupId: GROUP_ID,
          direction: TripDirection.DELIVERY,
        }),
      );
      trips.findByGroupId.mockResolvedValue(genuinePair());
    });

    it("is priced against the Combination configuration of its road", async () => {
      expect(await amountsOf()).toMatchObject({
        BASE_PRICE: "100.00",
        // The LEG's own toll, not the road's 15.60.
        TOLL: "9.75",
        // The leg's own tunnel, not the road's 12.50.
        TUNNEL: "3.75",
      });
    });

    it("carries its own Backload, as every grouped Trip does", async () => {
      expect((await amountsOf()).COMBINATION).toBe("50.00");
    });

    /** Fuel follows the Tarief, so the leg's own price carries through. */
    it("charges fuel on the leg's own Tarief", async () => {
      expect((await amountsOf()).FUEL_SURCHARGE).toBe("15.00");
    });

    it("never reads the road's tunnel", async () => {
      await engine.calculate(TRIP_ID);

      expect(routeCosts.findActiveForRoute).not.toHaveBeenCalled();
    });

    /**
     * ── THE ORDINARY ROUTE IS UNTOUCHED ────────────────────────────────────
     * The decisive collision test: pricing one context must leave the other
     * exactly as it was. The same road, priced again as an ordinary Trip, still
     * costs what it always did.
     */
    it("leaves the ordinary route priced exactly as before", async () => {
      await engine.calculate(TRIP_ID);

      trips.findById.mockResolvedValue(buildTrip());
      trips.findByGroupId.mockResolvedValue([]);

      expect(await amountsOf()).toMatchObject({
        BASE_PRICE: "380.00",
        TOLL: "15.60",
        TUNNEL: "12.50",
      });
    });
  });

  /**
   * ── A PAIR WITH NO COMBINATION FALLS BACK ──────────────────────────────────
   * Every Combination Trip priced before Combination routes existed was priced
   * against the ordinary configuration. Refusing to match would silently reprice
   * all of them to zero, so the fallback is what keeps existing pricing
   * unchanged — and configuring the Combination of the pair is what changes it.
   */
  describe("a genuine Combination leg whose pair has no Combination route", () => {
    beforeEach(() => {
      combinationPricing.findAll.mockResolvedValue([]);
      trips.findById.mockResolvedValue(
        buildTrip({
          tripGroupId: GROUP_ID,
          direction: TripDirection.DELIVERY,
        }),
      );
      trips.findByGroupId.mockResolvedValue(genuinePair());
    });

    it("is priced against the ordinary route, as it always was", async () => {
      expect(await amountsOf()).toMatchObject({
        BASE_PRICE: "380.00",
        TOLL: "15.60",
        TUNNEL: "12.50",
      });
    });

    it("still carries its Backload", async () => {
      expect((await amountsOf()).COMBINATION).toBe("50.00");
    });

    /**
     * The outbound alone IS a configured leg — but of a Combination whose
     * return is another road. One road never picks a Combination.
     */
    it("is never priced on a Combination that shares only its outbound", async () => {
      combinationPricing.findAll.mockResolvedValue([combinationOf("Beveren")]);

      expect(await amountsOf()).toMatchObject({
        BASE_PRICE: "380.00",
        TOLL: "15.60",
        TUNNEL: "12.50",
      });
    });
  });

  /**
   * A group an operator made by hand claims nothing about pairing, so it is not a
   * genuine Combination and takes the ordinary configuration. It keeps its €50
   * all the same: the Backload follows membership, not pairing.
   */
  describe("a Trip in a manual group", () => {
    beforeEach(() => {
      trips.findById.mockResolvedValue(
        buildTrip({
          tripGroupId: GROUP_ID,
          direction: TripDirection.DELIVERY,
        }),
      );
      trips.findByGroupId.mockResolvedValue(manualGroup());
    });

    it("is priced against the ordinary configuration", async () => {
      expect(await amountsOf()).toMatchObject({
        BASE_PRICE: "380.00",
        TUNNEL: "12.50",
      });
    });

    it("carries its Backload regardless of the route configuration", async () => {
      expect((await amountsOf()).COMBINATION).toBe("50.00");
    });

    it("keeps its Backload when no Combination route is configured at all", async () => {
      combinationPricing.findAll.mockResolvedValue([]);

      expect((await amountsOf()).COMBINATION).toBe("50.00");
    });
  });

  /**
   * ── ONE MATCH, NOT THREE LOOKUPS ──────────────────────────────────────────
   * The Tarief, the road's length and the road's tunnel all come from one
   * configured row. Three independent lookups could each match a different row
   * once a road is configured twice, and the Trip would be priced with a mixture.
   */
  describe("how often the configuration is read", () => {
    it("reads the ordinary configurations once for an ordinary Trip", async () => {
      await engine.calculate(TRIP_ID);

      expect(routePricing.findAllOrdinary).toHaveBeenCalledTimes(1);
      expect(combinationPricing.findAll).not.toHaveBeenCalled();
    });

    it("asks the Combination scope first for a genuine leg, then stops", async () => {
      trips.findById.mockResolvedValue(
        buildTrip({
          tripGroupId: GROUP_ID,
          direction: TripDirection.DELIVERY,
        }),
      );
      trips.findByGroupId.mockResolvedValue(genuinePair());

      await engine.calculate(TRIP_ID);

      expect(combinationPricing.findAll).toHaveBeenCalledTimes(1);
      expect(routePricing.findAllOrdinary).not.toHaveBeenCalled();
    });
  });
});
