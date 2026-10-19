import { AppLoggerService } from "../logger/app-logger.service";
import { BulkPricingReprocessService } from "../pricing-reprocess/bulk-pricing-reprocess.service";
import { PricingReprocessController } from "../pricing-reprocess/pricing-reprocess.controller";
import {
  MissingPricingSettingException,
  PartnerLegNotPriceableException,
  PricingEngineErrorCode,
} from "./exceptions/pricing-engine.exceptions";
import {
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import { PricingEngineService } from "./pricing-engine.service";
import { LEG1, LEG2, WITH_OVER_ST, routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * Every pricing trigger on one leg of a pair prices the other leg too (owner,
 * October 2026) — through the real Engine, matcher, snapshot store and Trip
 * services (tables in memory).
 *
 * Which Trips the Engine CALCULATES is read from a spy on it, so a test can
 * say exactly which legs a trigger reached and how often: a pair once, never a
 * loop. Which Trips were STORED is read from the snapshots themselves.
 */

const silentLogger = () =>
  ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as AppLoggerService;

describe("a pricing trigger on one leg reaches the other", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;
  let calculated: jest.SpyInstance;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  /** The ids the Engine calculated since the spy was set, in order. */
  const calculatedIds = () => calculated.mock.calls.map(([tripId]) => tripId as string);
  const storedAt = (tripId: string) => world.storedSnapshot(tripId)?.calculatedAt.getTime();
  const reprocessEndpoint = () => new PricingReprocessController(world.pairs, world.tripPricing, {} as never);
  const bulk = () => new BulkPricingReprocessService(world.pairs, world.tripPricing, silentLogger());

  /** A closed, configured Combination; the spy watches only what follows. */
  async function closedPair(): Promise<{ leg1: number; leg2: number }> {
    await actions.closedCombination();
    // Two snapshots stored in the same millisecond would look unchanged.
    await new Promise((resolve) => setTimeout(resolve, 5));
    calculated = jest.spyOn(world.engine, "calculate");

    return { leg1: storedAt(LEG1)!, leg2: storedAt(LEG2)! };
  }

  function expectBothRepricedOnce(before: { leg1: number; leg2: number }, firstId: string) {
    expect(calculatedIds()).toEqual(firstId === LEG1 ? [LEG1, LEG2] : [LEG2, LEG1]);
    expect(storedAt(LEG1)).toBeGreaterThan(before.leg1);
    expect(storedAt(LEG2)).toBeGreaterThan(before.leg2);
  }

  describe("the reprocess the Ritten row button and the detail page call", () => {
    it.each([LEG1, LEG2])("reprices both legs when it is fired on %s", async (tripId) => {
      const before = await closedPair();

      await reprocessEndpoint().reprocess({ tripId });

      expectBothRepricedOnce(before, tripId);
    });

    /**
     * The pair is priced by the existing rules, unchanged: nothing moved, so
     * each leg comes out exactly as it was — Over ST still with Leg 2.
     */
    it("leaves each leg priced by the existing pair rules", async () => {
      await closedPair();
      const leg1Before = await actions.apiPricing(LEG1);

      await reprocessEndpoint().reprocess({ tripId: LEG1 });

      expect(await actions.apiPricing(LEG1)).toEqual(leg1Before);
      expect(await actions.apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
      await actions.expectConsistent(LEG1);
      await actions.expectConsistent(LEG2);
    });
  });

  describe("the selection's Prijs herberekenen", () => {
    it.each([LEG1, LEG2])("reprices both legs when only %s is selected", async (tripId) => {
      const before = await closedPair();

      const result = await bulk().reprocessMany([tripId]);

      expectBothRepricedOnce(before, tripId);
      expect(result.results).toEqual([expect.objectContaining({ tripId, outcome: "REPROCESSED" })]);
    });

    it("prices the pair once when both legs are selected", async () => {
      const before = await closedPair();

      const result = await bulk().reprocessMany([LEG1, LEG2]);

      expectBothRepricedOnce(before, LEG1);
      expect(result.reprocessedCount).toBe(2);
    });
  });

  describe("a changed pricing input", () => {
    it("reprices the partner after a waiting time on Leg 1", async () => {
      const before = await closedPair();

      await world.tripService.update(LEG1, { waitingTimeStart: "10:00", waitingTimeEnd: "11:00" });

      expectBothRepricedOnce(before, LEG1);
    });

    it("reprices the partner after a Custom Value on Leg 2", async () => {
      const before = await closedPair();

      await world.customValues.assign({ tripId: LEG2, customPropertyId: PROPERTIES.genset.id });

      expectBothRepricedOnce(before, LEG2);
    });

    it("reprices the partner after a Cost Confirmation on Leg 1", async () => {
      const before = await closedPair();

      await world.confirmCost(LEG1, "CC-1", "45.00");

      expectBothRepricedOnce(before, LEG1);
    });

    /** A date change already named Leg 2; the pair is still priced once. */
    it("prices the pair once after a planning date change", async () => {
      const before = await closedPair();

      await actions.moveTo(LEG1, "2026-09-01");

      expect([...calculatedIds()].sort()).toEqual([LEG1, LEG2]);
      expect(storedAt(LEG1)).toBeGreaterThan(before.leg1);
      expect(storedAt(LEG2)).toBeGreaterThan(before.leg2);
    });
  });

  describe("closing a leg", () => {
    it("prices only itself while its partner is still OPEN, then both when the partner closes", async () => {
      actions.configureCombination();
      actions.seedLegs();
      calculated = jest.spyOn(world.engine, "calculate");

      await actions.close(LEG1);
      expect(calculatedIds()).toEqual([LEG1]);

      await actions.close(LEG2);
      expect(calculatedIds()).toEqual([LEG1, LEG2, LEG1]);
      expect(await actions.apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
    });

    /** Both legs closed in one action: two events, one pricing of the pair. */
    it("prices the pair once when both legs are completed together", async () => {
      actions.configureCombination();
      actions.seedLegs();
      calculated = jest.spyOn(world.engine, "calculate");

      await world.tripService.completeMany([LEG1, LEG2]);

      expect(calculatedIds()).toEqual([LEG1, LEG2]);
      expect(world.storedSnapshot(LEG1)).not.toBeNull();
      expect(world.storedSnapshot(LEG2)).not.toBeNull();
    });
  });

  /**
   * Both or neither: when one leg cannot be priced, neither snapshot is
   * replaced, and no answer presents a price as current.
   */
  describe("when the partner leg cannot be priced", () => {
    async function partnerFails(): Promise<{ leg1: number; leg2: number }> {
      const before = await closedPair();
      const realCalculate = PricingEngineService.prototype.calculate;

      // Leg 2's configuration is incomplete; Leg 1 alone could be priced.
      calculated.mockImplementation((tripId: string) =>
        tripId === LEG2
          ? Promise.reject(new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"))
          : realCalculate.call(world.engine, tripId),
      );

      return before;
    }

    it("refuses the reprocess, naming the other leg, and replaces neither snapshot", async () => {
      const before = await partnerFails();

      await expect(reprocessEndpoint().reprocess({ tripId: LEG1 })).rejects.toThrow(
        PartnerLegNotPriceableException,
      );
      expect(storedAt(LEG1)).toBe(before.leg1);
      expect(storedAt(LEG2)).toBe(before.leg2);
    });

    it("answers an input change with no price and the reason, never the old figures", async () => {
      const before = await partnerFails();

      const response = await world.tripService.update(LEG1, {
        waitingTimeStart: "10:00",
        waitingTimeEnd: "11:00",
      });

      expect(response.pricing).toBeNull();
      expect(response.reasonCode).toBe(PricingEngineErrorCode.PARTNER_LEG_NOT_PRICEABLE);
      // The write itself stands; neither snapshot was replaced.
      expect(world.trips.get(LEG1)?.waitingTimeMinutes).toBe(60);
      expect(storedAt(LEG1)).toBe(before.leg1);
      expect(storedAt(LEG2)).toBe(before.leg2);
    });

    it("reports each leg of a selected pair with its own reason", async () => {
      await partnerFails();

      const result = await bulk().reprocessMany([LEG1, LEG2]);

      expect(result.results).toEqual([
        expect.objectContaining({ tripId: LEG1, outcome: "FAILED", reasonCode: PricingEngineErrorCode.PARTNER_LEG_NOT_PRICEABLE }),
        expect.objectContaining({ tripId: LEG2, outcome: "FAILED", reasonCode: PricingEngineErrorCode.MISSING_SETTING }),
      ]);
    });
  });

  describe("a Trip in no group", () => {
    it("is priced exactly as before: itself, once", async () => {
      world.seed(buildTrip("alone"));
      await actions.close("alone");
      calculated = jest.spyOn(world.engine, "calculate");

      await reprocessEndpoint().reprocess({ tripId: "alone" });
      await world.tripService.update("alone", { waitingTimeStart: "10:00", waitingTimeEnd: "11:00" });
      await bulk().reprocessMany(["alone"]);

      expect(calculatedIds()).toEqual(["alone", "alone", "alone"]);
    });
  });
});
