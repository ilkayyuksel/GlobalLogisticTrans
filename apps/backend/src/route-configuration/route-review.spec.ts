import { AppLoggerService } from "../logger/app-logger.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { RouteCostRepository } from "../route-costs/route-cost.repository";
import { RouteCostService } from "../route-costs/route-cost.service";
import { CombinationRouteConfigurationService } from "./combination-route-configuration.service";
import { RouteConfigurationService } from "./route-configuration.service";
import { RouteComponentCostService } from "./route-component-cost.service";

const ROUTE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GROUP_ID = "7d2b8c14-9f3a-4c5e-8b1d-2e3f4a5b6c7d";
const LEG_ID = "5a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";

/**
 * Whether somebody has been through a route's prices.
 *
 * ── BOOKKEEPING, NOT STATE ──────────────────────────────────────────────────
 * The mark records that a person has looked. It decides nothing: not whether the
 * route is used, not what a Trip is charged, and nothing the Pricing Engine
 * reads. These tests hold that line as much as they hold the feature — the mark
 * travels on its own path, and no amount moves with it.
 *
 * ── AND IT BELONGS TO THE RECORD A PERSON ACTS ON ───────────────────────────
 * An ordinary route carries its own. A Combination carries ONE, on the group,
 * because the group is what is configured, edited, removed — and therefore
 * reviewed. Marking legs separately would invent a half-reviewed Combination: a
 * state the screen cannot show and nothing can act on.
 * ────────────────────────────────────────────────────────────────────────────
 */

function storedRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTE_ID,
    routeName: "Quay 869 - Dourges",
    departure: "Quay 869",
    destination: "Dourges",
    basePrice: "520.00",
    kilometres: "310.00",
    combinationGroupId: null,
    combinationLegPosition: null,
    reviewed: false,
    notes: null,
    createdAt: new Date("2026-09-27T00:00:00Z"),
    updatedAt: new Date("2026-09-27T00:00:00Z"),
    ...overrides,
  };
}

function storedLeg(position: number, overrides: Record<string, unknown> = {}) {
  return storedRoute({
    id: `${LEG_ID}-${position}`,
    departure: position === 1 ? "Antwerp" : "Kallo",
    destination: position === 1 ? "Kallo" : "Antwerp",
    combinationGroupId: GROUP_ID,
    combinationLegPosition: position,
    ...overrides,
  });
}

describe("the review mark", () => {
  let routePricing: {
    findById: jest.Mock;
    findAll: jest.Mock;
    setReviewed: jest.Mock;
  };
  let combinationPricing: {
    findById: jest.Mock;
    findAll: jest.Mock;
    setReviewed: jest.Mock;
  };
  let routeCosts: {
    findActiveForRoute: jest.Mock;
    findActiveForRoutePricing: jest.Mock;
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    activate: jest.Mock;
    deactivate: jest.Mock;
  };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let routes: RouteConfigurationService;
  let combinations: CombinationRouteConfigurationService;

  beforeEach(() => {
    routePricing = {
      findById: jest.fn().mockResolvedValue(storedRoute()),
      findAll: jest.fn().mockResolvedValue({ items: [] }),
      setReviewed: jest.fn().mockResolvedValue(storedRoute({ reviewed: true })),
    };

    combinationPricing = {
      findById: jest.fn().mockResolvedValue({
        id: GROUP_ID,
        reviewed: false,
        legs: [storedLeg(1), storedLeg(2)],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findAll: jest.fn().mockResolvedValue([]),
      setReviewed: jest.fn().mockResolvedValue({
        id: GROUP_ID,
        reviewed: true,
        legs: [storedLeg(1), storedLeg(2)],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    routeCosts = {
      findActiveForRoute: jest.fn().mockResolvedValue([]),
      findActiveForRoutePricing: jest.fn().mockResolvedValue([]),
      findAll: jest.fn().mockResolvedValue({ items: [] }),
      create: jest.fn(),
      update: jest.fn(),
      activate: jest.fn(),
      deactivate: jest.fn(),
    };

    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    const tunnelCosts = new RouteComponentCostService(
      routeCosts as unknown as RouteCostService,
      { findPricingComponentByCode: jest.fn() } as unknown as RouteCostRepository,
      logger as unknown as AppLoggerService,
    );

    routes = new RouteConfigurationService(
      routePricing as unknown as RoutePricingService,
      tunnelCosts,
      logger as unknown as AppLoggerService,
    );
    combinations = new CombinationRouteConfigurationService(
      combinationPricing as unknown as CombinationRoutePricingService,
      tunnelCosts,
      logger as unknown as AppLoggerService,
    );
  });

  describe("an ordinary route", () => {
    it("is unreviewed until somebody says otherwise", async () => {
      expect((await routes.findById(ROUTE_ID)).reviewed).toBe(false);
    });

    it("reports the mark it carries", async () => {
      routePricing.findById.mockResolvedValue(storedRoute({ reviewed: true }));

      expect((await routes.findById(ROUTE_ID)).reviewed).toBe(true);
    });

    it("can be marked as checked", async () => {
      await routes.setReviewed(ROUTE_ID, true);

      expect(routePricing.setReviewed).toHaveBeenCalledWith(ROUTE_ID, true);
    });

    it("can be unmarked again", async () => {
      routePricing.findById.mockResolvedValue(storedRoute({ reviewed: true }));

      await routes.setReviewed(ROUTE_ID, false);

      expect(routePricing.setReviewed).toHaveBeenCalledWith(ROUTE_ID, false);
    });

    /*
     * ── IT MOVES NO PRICE ───────────────────────────────────────────────────
     * The decisive property. Marking a route must not travel through the
     * ordinary save, which rewrites the amounts and the tunnel cost — a route
     * nobody meant to edit would be edited by a tick.
     */
    it("changes no amount and no tunnel cost", async () => {
      await routes.setReviewed(ROUTE_ID, true);

      expect(routeCosts.create).not.toHaveBeenCalled();
      expect(routeCosts.update).not.toHaveBeenCalled();
      expect(routeCosts.deactivate).not.toHaveBeenCalled();
    });

    it("refuses to mark a Combination leg on its own", async () => {
      routePricing.findById.mockResolvedValue(storedLeg(1));

      await expect(routes.setReviewed(LEG_ID, true)).rejects.toThrow(
        /cannot be changed on its own/,
      );
      expect(routePricing.setReviewed).not.toHaveBeenCalled();
    });

    /** Reported without the price, which is commercial configuration. */
    it("logs the mark and not the amount", async () => {
      await routes.setReviewed(ROUTE_ID, true);

      expect(logger.log).toHaveBeenCalledWith(
        "Route configuration review mark changed",
        { routePricingId: ROUTE_ID, reviewed: true },
      );
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("520.00");
    });
  });

  describe("a Combination", () => {
    it("is unreviewed until somebody says otherwise", async () => {
      expect((await combinations.findById(GROUP_ID)).reviewed).toBe(false);
    });

    it("carries ONE mark, on the group", async () => {
      combinationPricing.findById.mockResolvedValue({
        id: GROUP_ID,
        reviewed: true,
        legs: [storedLeg(1), storedLeg(2)],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect((await combinations.findById(GROUP_ID)).reviewed).toBe(true);
    });

    /**
     * Each leg reports the GROUP's mark, so a row can be read on its own — and
     * so a leg can never disagree with its partner about it.
     */
    it("gives both legs the group's mark", async () => {
      combinationPricing.findById.mockResolvedValue({
        id: GROUP_ID,
        reviewed: true,
        // Deliberately false on the rows: the group is what answers.
        legs: [storedLeg(1, { reviewed: false }), storedLeg(2, { reviewed: false })],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const combination = await combinations.findById(GROUP_ID);

      expect(combination.legs.map((leg) => leg.reviewed)).toEqual([true, true]);
    });

    it("is marked by the group's id", async () => {
      await combinations.setReviewed(GROUP_ID, true);

      expect(combinationPricing.setReviewed).toHaveBeenCalledWith(
        GROUP_ID,
        true,
      );
    });

    it("can be unmarked again", async () => {
      await combinations.setReviewed(GROUP_ID, false);

      expect(combinationPricing.setReviewed).toHaveBeenCalledWith(
        GROUP_ID,
        false,
      );
    });

    it("changes no leg and no tunnel cost", async () => {
      await combinations.setReviewed(GROUP_ID, true);

      expect(routeCosts.create).not.toHaveBeenCalled();
      expect(routeCosts.update).not.toHaveBeenCalled();
    });
  });
});
