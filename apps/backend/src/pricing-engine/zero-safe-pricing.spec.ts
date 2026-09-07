import { Prisma, TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CostConfirmationReadService } from "../cost-confirmations/cost-confirmation-read.service";
import { toEffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import {
  resolveEffectivePricing,
  type EngineAmount,
  type OverrideAmount,
} from "../trip-pricing/effective-pricing";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
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
const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";
const FLAT_ID = "30e65f2f-9b55-45a7-a53d-73df9930e8ee";
const TOLL_COMPONENT_ID = "d8bd583a-fcb9-48a2-8d8d-f056879ae6a5";

/**
 * A CLOSED Trip is ALWAYS priced, even on a route nobody has configured.
 *
 * ── WHY THIS IS THE RULE NOW ────────────────────────────────────────────────
 * An unconfigured route used to abort the calculation, so no snapshot was
 * written — and the consequence reached far past the base price. Such a Trip
 * showed nothing in any of the eight columns, offered no way to correct the
 * Tarief by hand, and could carry no waiting time, custom property or cost
 * confirmation, because every one of those reads a snapshot that never existed.
 *
 * On this business's data most real routes have no configured price, so that
 * was the ordinary case rather than an edge one. The absence of a configuration
 * is now what it always was in fact: a price of ZERO that an operator can
 * correct, on a Trip that receives a complete snapshot.
 *
 * These tests run the REAL calculator chain end to end and then read the result
 * through the REAL effective-pricing resolver, so what they assert is what a
 * screen would show.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<TripReadView> = {}): TripReadView {
  return {
    id: TRIP_ID,
    pdfDocumentId: "pdf-1",
    // A stated TAR-nummer, because eligibility now depends on it. These
    // fixtures are about ALLOCATION — which leg owes the charge — so they must
    // clear the new precondition to keep testing what they were written for.
    tarNummer: "TAR-2026-0042",
    tripGroupId: null,
    status: TripStatus.CLOSED,
    direction: null,
    bookingNumber: "ANRDUB2602247",
    terminal: "PSA Quay 869",
    // Deliberately a route with no configured price.
    destinationCity: "Ghlin",
    planningDate: "2026-08-31",
    waitingTimeMinutes: null,
    distanceKm: null,
    ...overrides,
  };
}

const RULES = {
  strategy: PricingStrategy.ROUTE_BASED,
  fuelPercentage: "15",
  combinationSurcharge: "50.00",
  automaticCustomPropertyId: TAR_ID,
  waitingTimeFreeMinutes: 120,
  waitingTimeThresholdMinutes: 150,
  waitingTimeBlockMinutes: 15,
  waitingTimeBlockPrice: "13.75",
  ruleVersion: "2026.1",
};

describe("a CLOSED Trip on an unconfigured route", () => {
  let trips: { findById: jest.Mock; findByGroupId: jest.Mock };
  let routePricing: { findActiveRoute: jest.Mock };
  let routeCosts: { findActiveForRoute: jest.Mock };
  let assignments: { findByTripId: jest.Mock };
  let customProperties: { findById: jest.Mock };
  let costConfirmations: { findForTrip: jest.Mock };
  let snapshotWriter: {
    findExistingSnapshot: jest.Mock;
    writeSnapshot: jest.Mock;
  };
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let engine: PricingEngineService;

  beforeEach(() => {
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    trips = {
      findById: jest.fn().mockResolvedValue(buildTrip()),
      findByGroupId: jest.fn().mockResolvedValue([]),
    };
    // The whole point: nothing is configured for this route.
    routePricing = { findActiveRoute: jest.fn().mockResolvedValue(null) };
    routeCosts = { findActiveForRoute: jest.fn().mockResolvedValue([]) };
    assignments = { findByTripId: jest.fn().mockResolvedValue([]) };
    customProperties = {
      findById: jest.fn().mockResolvedValue({
        id: TAR_ID,
        name: "TAR",
        pricingComponentId: null,
        defaultPrice: "20.00",
      }),
    };
    costConfirmations = { findForTrip: jest.fn().mockResolvedValue(null) };
    snapshotWriter = {
      findExistingSnapshot: jest.fn().mockResolvedValue(null),
      writeSnapshot: jest.fn().mockResolvedValue(undefined),
    };

    const appLogger = logger as unknown as AppLoggerService;
    const ruleResolver = {
      resolve: jest.fn().mockResolvedValue(RULES),
      resolveDistanceRatePerKm: jest.fn(),
    } as unknown as PricingRuleResolver;

    engine = new PricingEngineService(
      trips as unknown as TripReadService,
      ruleResolver,
      new PricingComponentResolver(
        routePricing as unknown as RoutePricingService,
        assignments as unknown as TripCustomPropertyReadService,
        customProperties as unknown as CustomPropertyService,
        trips as unknown as TripReadService,
        ruleResolver,
        // Nothing has been charged today unless a test says so.
        { hasBeenChargedToday: jest.fn().mockResolvedValue(false) } as never,
        appLogger,
      ),
      new RouteCostResolver(routeCosts as never, appLogger),
      snapshotWriter as unknown as PricingSnapshotWriter,
      costConfirmations as unknown as CostConfirmationReadService,
      [
        new BasePriceCalculator(appLogger),
        new CombinationSurchargeCalculator(appLogger),
        new FuelSurchargeCalculator(appLogger),
        new WaitingTimeCalculator(appLogger),
        new TollCalculator(appLogger),
        new TunnelCalculator(appLogger),
        new CustomPropertyCalculator(appLogger),
        new CostConfirmationCalculator(appLogger),
      ],
      appLogger,
    );
  });

  /** The eight amounts a screen shows, from the lines the Engine produced. */
  async function amounts(overrides: OverrideAmount[] = []) {
    const { lines } = await engine.calculate(TRIP_ID);

    const engineAmounts: EngineAmount[] = lines.map((line) => ({
      componentCode: line.component,
      amount: line.amount,
      customPropertyId: line.customPropertyId,
      description: line.description,
      unitPrice: line.unitPrice,
    }));

    return toEffectivePricingDto(
      resolveEffectivePricing(engineAmounts, overrides),
    );
  }

  describe("the calculation succeeds", () => {
    it("does not refuse", async () => {
      await expect(engine.calculate(TRIP_ID)).resolves.toBeDefined();
    });

    it("writes a snapshot", async () => {
      await engine.calculateAndStore(TRIP_ID);

      expect(snapshotWriter.writeSnapshot).toHaveBeenCalledTimes(1);
    });

    it("says in the log that the route priced at zero", async () => {
      await engine.calculate(TRIP_ID);

      expect(logger.warn).toHaveBeenCalledWith(
        "No active route pricing; the Trip prices at zero",
        { tripId: TRIP_ID },
      );
    });
  });

  describe("the eight amounts", () => {
    it("prices Tarief, Brandstof, Toll and Tunnel at zero", async () => {
      const pricing = await amounts();

      expect(pricing.tarief).toBe("0.00");
      expect(pricing.brandstof).toBe("0.00");
      expect(pricing.tol).toBe("0.00");
      expect(pricing.tunnel).toBe("0.00");
    });

    /** TAR is applied to every standalone Trip, and lands in Others. */
    it("still charges the automatic TAR in Others", async () => {
      const pricing = await amounts();

      expect(pricing.others).toBe("20.00");
      expect(pricing.totaal).toBe("20.00");
    });

    it("reports EK as zero when the Trip has no confirmation", async () => {
      expect((await amounts()).ek).toBe("0.00");
    });

    /** No fuel on a zero Tarief — a percentage of nothing is nothing. */
    it("produces a fuel line of zero rather than no line at all", async () => {
      const { lines } = await engine.calculate(TRIP_ID);
      const fuel = lines.find((line) => line.component === "FUEL_SURCHARGE");

      expect(fuel?.amount.toFixed(2)).toBe("0.00");
      // The rate is still recorded, which is what an override later needs.
      expect(fuel?.unitPrice?.toFixed(2)).toBe("15.00");
    });
  });

  /**
   * ── THE DYNAMIC COMPONENTS STILL WORK ─────────────────────────────────────
   * This is what the zero-safe snapshot is FOR. Every one of these was
   * impossible before, because there was no snapshot to move.
   */
  describe("the dynamic components", () => {
    it("prices a waiting time", async () => {
      trips.findById.mockResolvedValue(buildTrip({ waitingTimeMinutes: 180 }));

      // 180 - 120 = 60 billable minutes = 4 blocks at 13.75 = 55.00
      const pricing = await amounts();

      expect(pricing.others).toBe("75.00");
      expect(pricing.totaal).toBe("75.00");
    });

    it("prices an assigned Custom Property", async () => {
      assignments.findByTripId.mockResolvedValue([
        {
          customPropertyId: FLAT_ID,
          name: "Flat",
          pricingComponentId: null,
          defaultPrice: "80.00",
        },
      ]);

      const pricing = await amounts();

      // TAR 20 + Flat 80
      expect(pricing.others).toBe("100.00");
      expect(pricing.totaal).toBe("100.00");
    });

    it("prices a Cost Confirmation into EK", async () => {
      costConfirmations.findForTrip.mockResolvedValue({
        ccNumbers: ["4139505"],
        amount: "165.00",
      });

      const pricing = await amounts();

      expect(pricing.ek).toBe("165.00");
      expect(pricing.totaal).toBe("185.00");
    });

    /** Waiting time, a property and a confirmation, all at once. */
    it("adds them all up on a Trip priced at zero", async () => {
      trips.findById.mockResolvedValue(buildTrip({ waitingTimeMinutes: 180 }));
      assignments.findByTripId.mockResolvedValue([
        {
          customPropertyId: FLAT_ID,
          name: "Flat",
          pricingComponentId: null,
          defaultPrice: "80.00",
        },
      ]);
      costConfirmations.findForTrip.mockResolvedValue({
        ccNumbers: ["4139505"],
        amount: "165.00",
      });

      const pricing = await amounts();

      // TAR 20 + Flat 80 + waiting 55
      expect(pricing.others).toBe("155.00");
      expect(pricing.ek).toBe("165.00");
      expect(pricing.totaal).toBe("320.00");
    });
  });

  /**
   * ── AN OVERRIDE ON A ZERO TARIEF ──────────────────────────────────────────
   * The reason the fuel rate is stored on its own line. The ratio
   * `fuel / base` would be 0/0 here and could name no percentage, so a
   * corrected Tarief would have carried no fuel with it.
   */
  describe("correcting the Tarief by hand", () => {
    const tarief = (amount: string): OverrideAmount => ({
      componentCode: "BASE_PRICE",
      amount: new Prisma.Decimal(amount),
    });

    it("applies the correction and derives Brandstof from it", async () => {
      const pricing = await amounts([tarief("50.00")]);

      expect(pricing.tarief).toBe("50.00");
      // 15% of 50.
      expect(pricing.brandstof).toBe("7.50");
      expect(pricing.totaal).toBe("77.50");
    });

    it("marks the amount as corrected rather than calculated", async () => {
      const pricing = await amounts([tarief("50.00")]);

      expect(pricing.components).toContainEqual({
        componentCode: "BASE_PRICE",
        engineAmount: "0.00",
        effectiveAmount: "50.00",
        source: "OVERRIDE",
      });
    });

    /** Withdrawing it returns both to zero. */
    it("goes back to zero when the correction is withdrawn", async () => {
      const pricing = await amounts();

      expect(pricing.tarief).toBe("0.00");
      expect(pricing.brandstof).toBe("0.00");
    });

    /** Zero is a real amount an operator may type, not a withdrawal. */
    it("accepts an explicit zero as a correction", async () => {
      const pricing = await amounts([tarief("0.00")]);

      expect(pricing.tarief).toBe("0.00");
      expect(pricing.brandstof).toBe("0.00");
      expect(pricing.components).toContainEqual(
        expect.objectContaining({
          componentCode: "BASE_PRICE",
          source: "OVERRIDE",
        }),
      );
    });

    it("corrects Toll and Tunnel on an unconfigured route too", async () => {
      const pricing = await amounts([
        { componentCode: "TOLL", amount: new Prisma.Decimal("18.00") },
        { componentCode: "TUNNEL", amount: new Prisma.Decimal("12.00") },
      ]);

      expect(pricing.tol).toBe("18.00");
      expect(pricing.tunnel).toBe("12.00");
      expect(pricing.totaal).toBe("50.00");
    });
  });

  /**
   * A route-priced property whose cost the route does not state. It used to
   * abort the whole calculation; it now contributes nothing and is reported.
   */
  describe("a Toll property with no configured cost", () => {
    beforeEach(() => {
      assignments.findByTripId.mockResolvedValue([
        {
          customPropertyId: "property-toll",
          name: "Toll",
          pricingComponentId: TOLL_COMPONENT_ID,
          defaultPrice: null,
        },
      ]);
    });

    it("still prices the Trip", async () => {
      await expect(engine.calculate(TRIP_ID)).resolves.toBeDefined();
    });

    it("charges no Toll", async () => {
      expect((await amounts()).tol).toBe("0.00");
    });

    it("reports the gap so it can be configured", async () => {
      await engine.calculate(TRIP_ID);

      expect(logger.warn).toHaveBeenCalledWith(
        "Route-priced custom property has no route cost",
        expect.objectContaining({
          tripId: TRIP_ID,
          pricingComponentId: TOLL_COMPONENT_ID,
          destination: "Ghlin",
        }),
      );
    });
  });

  /** Half a route matches no configuration, so it takes the same answer. */
  describe("a Trip with no destination at all", () => {
    beforeEach(() => {
      trips.findById.mockResolvedValue(buildTrip({ destinationCity: null }));
    });

    it("is still priced rather than refused", async () => {
      await expect(engine.calculate(TRIP_ID)).resolves.toBeDefined();
    });

    it("prices at zero and still charges TAR", async () => {
      const pricing = await amounts();

      expect(pricing.tarief).toBe("0.00");
      expect(pricing.others).toBe("20.00");
    });
  });
});

/**
 * ── A GENUINE COMBINATION, ON AN UNCONFIGURED ROUTE ───────────────────────
 * The pairing rules are unchanged by the zero-safe base: one TAR for the pair,
 * on the DELIVERY, and the Backload on BOTH legs.
 */
describe("the two legs of a Combination", () => {
  const GROUP_ID = "97777777-7777-4777-8777-777777777777";
  const DOCUMENT_ID = "pdf-combination";

  const DELIVERY = buildTrip({
    id: "trip-delivery",
    tripGroupId: GROUP_ID,
    pdfDocumentId: DOCUMENT_ID,
    direction: TripDirection.DELIVERY,
  });

  const COLLECTION = buildTrip({
    id: "trip-collection",
    tripGroupId: GROUP_ID,
    pdfDocumentId: DOCUMENT_ID,
    direction: TripDirection.COLLECTION,
  });

  /** The eight amounts of one leg, through the real chain. */
  async function legAmounts(leg: TripReadView) {
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    const trips = {
      findById: jest.fn().mockResolvedValue(leg),
      findByGroupId: jest.fn().mockResolvedValue([DELIVERY, COLLECTION]),
    } as unknown as TripReadService;

    const ruleResolver = {
      resolve: jest.fn().mockResolvedValue(RULES),
      resolveDistanceRatePerKm: jest.fn(),
    } as unknown as PricingRuleResolver;

    const engine = new PricingEngineService(
      trips,
      ruleResolver,
      new PricingComponentResolver(
        { findActiveRoute: jest.fn().mockResolvedValue(null) } as never,
        { findByTripId: jest.fn().mockResolvedValue([]) } as never,
        {
          findById: jest.fn().mockResolvedValue({
            id: TAR_ID,
            name: "TAR",
            pricingComponentId: null,
            defaultPrice: "20.00",
          }),
        } as never,
        trips,
        ruleResolver,
        { hasBeenChargedToday: jest.fn().mockResolvedValue(false) } as never,
        logger,
      ),
      new RouteCostResolver(
        { findActiveForRoute: jest.fn().mockResolvedValue([]) } as never,
        logger,
      ),
      {
        findExistingSnapshot: jest.fn().mockResolvedValue(null),
        writeSnapshot: jest.fn(),
      } as unknown as PricingSnapshotWriter,
      { findForTrip: jest.fn().mockResolvedValue(null) } as never,
      [
        new BasePriceCalculator(logger),
        new CombinationSurchargeCalculator(logger),
        new FuelSurchargeCalculator(logger),
        new WaitingTimeCalculator(logger),
        new TollCalculator(logger),
        new TunnelCalculator(logger),
        new CustomPropertyCalculator(logger),
      ],
      logger,
    );

    const { lines } = await engine.calculate(leg.id);

    return toEffectivePricingDto(
      resolveEffectivePricing(
        lines.map((line) => ({
          componentCode: line.component,
          amount: line.amount,
          customPropertyId: line.customPropertyId,
          description: line.description,
          unitPrice: line.unitPrice,
        })),
        [],
      ),
    );
  }

  it("gives the DELIVERY leg the single TAR and a Backload", async () => {
    const pricing = await legAmounts(DELIVERY);

    expect(pricing.others).toBe("20.00");
    expect(pricing.backload).toBe("50.00");
  });

  it("gives the COLLECTION leg a Backload and no TAR", async () => {
    const pricing = await legAmounts(COLLECTION);

    expect(pricing.others).toBe("0.00");
    expect(pricing.backload).toBe("50.00");
  });

  it("charges the pair one TAR and two Backloads", async () => {
    const delivery = await legAmounts(DELIVERY);
    const collection = await legAmounts(COLLECTION);

    const tarTotal =
      Number(delivery.others) + Number(collection.others);
    const backloadTotal =
      Number(delivery.backload) + Number(collection.backload);

    expect(tarTotal).toBe(20);
    expect(backloadTotal).toBe(100);
  });
});
