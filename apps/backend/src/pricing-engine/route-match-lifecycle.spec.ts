import {
  CONFIGURED_TERMINAL,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import {
  DAY_ONE,
  DAY_TWO,
  LEG1,
  LEG1_ROW,
  LEG2,
  LEG2_ROW,
  WITHOUT_OVER_ST,
  WITH_OVER_ST,
  routeMatchActions,
} from "./route-match-lifecycle.fixtures";

/**
 * Route matching and Over ST through every action that prices a Trip.
 *
 * The real services, the real Engine and the real matcher; only the tables are
 * in memory. Each test reads the stored snapshot AND the API's answer, because
 * a figure right in one and wrong in the other is the failure guarded against.
 * The Combination and its amounts: `route-match-lifecycle.fixtures.ts`.
 */
describe("route matching and Over ST through the pricing lifecycle", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  const close = (tripId: string) => actions.close(tripId);
  const reopen = (tripId: string) => actions.reopen(tripId);
  const apiPricing = (tripId: string) => actions.apiPricing(tripId);
  const moveTo = (tripId: string, day: string) => actions.moveTo(tripId, day);
  const trace = (tripId: string) => actions.trace(tripId);
  const surcharges = (tripId: string) => actions.surcharges(tripId);
  const expectConsistent = (tripId: string) => actions.expectConsistent(tripId);
  const closedCombination = (leg2Day?: string) => actions.closedCombination(leg2Day);

  describe("a Combination identified by its pair", () => {
    it("prices Leg 2 with Over ST and the €70 when the legs are on different days", async () => {
      await closedCombination();

      expect(await apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
      expect(surcharges(LEG2).map((item) => item.amount.toFixed(2))).toEqual(["70.00"]);
      expect(trace(LEG2)).toEqual({ routePricingId: LEG2_ROW, routeMatch: "EXACT" });
      await expectConsistent(LEG2);
    });

    it("never gives Leg 1 any of it", async () => {
      await closedCombination();

      expect(await apiPricing(LEG1)).toMatchObject({ tarief: "150.00", tol: "0.00" });
      expect(surcharges(LEG1)).toEqual([]);
      expect(trace(LEG1)).toEqual({ routePricingId: LEG1_ROW, routeMatch: "EXACT" });
    });

    it("prices Leg 2 without any of it on the same day", async () => {
      await closedCombination(DAY_ONE);

      expect(await apiPricing(LEG2)).toMatchObject(WITHOUT_OVER_ST);
      expect(surcharges(LEG2)).toEqual([]);
    });

    it("never adds the €70 twice, however often Leg 2 is recalculated", async () => {
      await closedCombination();

      await world.tripService.update(LEG2, { waitingTimeStart: "10:00", waitingTimeEnd: "11:00" });
      await world.tripService.update(LEG2, { waitingTimeStart: null, waitingTimeEnd: null });
      await world.engine.reprocess(LEG2);

      expect(surcharges(LEG2)).toHaveLength(1);
      expect(await apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
      await expectConsistent(LEG2);
    });
  });

  /** A date change reprices Leg 2, whichever leg moved. */
  describe("planning date changes while both legs are CLOSED", () => {
    it("removes it when Leg 1 moves onto Leg 2's day, and restores it when Leg 1 moves back", async () => {
      await closedCombination();

      await moveTo(LEG1, DAY_TWO);
      expect(await apiPricing(LEG2)).toMatchObject(WITHOUT_OVER_ST);
      expect(surcharges(LEG2)).toEqual([]);

      await moveTo(LEG1, DAY_ONE);
      expect(await apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
      expect(surcharges(LEG2)).toHaveLength(1);
      await expectConsistent(LEG2);
    });

    it("follows Leg 2's own date, both ways", async () => {
      await closedCombination();

      const sameDay = await moveTo(LEG2, DAY_ONE);
      expect(sameDay.pricing).toMatchObject(WITHOUT_OVER_ST);

      const otherDay = await moveTo(LEG2, DAY_TWO);
      expect(otherDay.pricing).toMatchObject(WITH_OVER_ST);
      expect(surcharges(LEG2)).toHaveLength(1);
    });
  });

  describe("reopening and closing again", () => {
    it("hides Leg 2's price while OPEN and prices the current dates on closing", async () => {
      await closedCombination();

      await reopen(LEG2);
      expect(await apiPricing(LEG2)).toBeNull();

      // Leg 1 moves onto Leg 2's day while Leg 2 is OPEN: nothing is priced.
      await moveTo(LEG1, DAY_TWO);
      expect(await apiPricing(LEG2)).toBeNull();

      await close(LEG2);
      expect(await apiPricing(LEG2)).toMatchObject(WITHOUT_OVER_ST);
      expect(surcharges(LEG2)).toEqual([]);
      await expectConsistent(LEG2);
    });
  });

  describe("group changes", () => {
    it("takes Over ST away from a CLOSED Leg 2 that leaves the group", async () => {
      await closedCombination();

      const response = await world.tripService.removeFromGroup(LEG2);

      // No longer a Combination leg: the ordinary road Mons → Quay 869, which
      // nobody configured — zero, recorded as NOT_FOUND, and no Backload.
      expect(response.pricing).toMatchObject({ tarief: "0.00", tol: "0.00", backload: "0.00" });
      expect(surcharges(LEG2)).toEqual([]);
      expect(trace(LEG2)).toEqual({ routePricingId: null, routeMatch: "NOT_FOUND" });
    });

    it("prices a group left while OPEN on closing, without Over ST", async () => {
      await closedCombination();
      await reopen(LEG2);

      await world.tripService.removeFromGroup(LEG2);
      expect(await apiPricing(LEG2)).toBeNull();

      await close(LEG2);
      expect(await apiPricing(LEG2)).toMatchObject({ tarief: "0.00", backload: "0.00" });
      expect(surcharges(LEG2)).toEqual([]);
    });
  });

  /**
   * ── CONFIGURATION NEVER REPRICES BY ITSELF ───────────────────────────────
   * A stored price stays what it was priced at until the Trip is priced again
   * — by an edit while CLOSED, closing again, or an explicit reprocess.
   */
  describe("a change to the route configuration", () => {
    it("reprices nothing until an explicit reprocess", async () => {
      world.seed(buildTrip("ordinary"));
      await close("ordinary");

      world.ordinaryRoutes[0].basePrice = "300.00";
      expect(await apiPricing("ordinary")).toMatchObject({ tarief: "200.00" });

      await world.engine.reprocess("ordinary");
      expect(await apiPricing("ordinary")).toMatchObject({ tarief: "300.00" });
    });

    it("leaves a CLOSED Over ST leg as it was until it is priced again", async () => {
      await closedCombination();

      world.combinations[0].overSt = { tarief: null, toll: null, tunnel: null };
      expect(await apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);

      await world.engine.reprocess(LEG2);
      // Over ST no longer configured: no Over ST and no €70.
      expect(await apiPricing(LEG2)).toMatchObject(WITHOUT_OVER_ST);
      expect(surcharges(LEG2)).toEqual([]);
    });
  });

  /**
   * ── NO MATCH IS NOT A ZERO PRICE ─────────────────────────────────────────
   * Both price the Tarief at zero; only the snapshot's trace tells them apart.
   */
  describe("what the snapshot records", () => {
    it("records an unmatched road as NOT_FOUND, with no configuration", async () => {
      world.seed(buildTrip("unmatched", { destinationCity: "Gosselies" }));
      await close("unmatched");

      expect(await apiPricing("unmatched")).toMatchObject({ tarief: "0.00" });
      expect(trace("unmatched")).toEqual({ routePricingId: null, routeMatch: "NOT_FOUND" });
    });

    it("records a road configured at zero as matched, with its configuration", async () => {
      world.ordinaryRoutes.push({
        id: "route-zero",
        departure: CONFIGURED_TERMINAL,
        destination: "Gosselies",
        basePrice: "0.00",
      });
      world.seed(buildTrip("zero", { destinationCity: "Gosselies" }));
      await close("zero");

      expect(await apiPricing("zero")).toMatchObject({ tarief: "0.00" });
      expect(trace("zero")).toEqual({ routePricingId: "route-zero", routeMatch: "EXACT" });
    });

    it("records a difference in letter case as NORMALIZED, and prices it", async () => {
      world.seed(buildTrip("shouting", { destinationCity: "GHLIN" }));
      await close("shouting");

      expect(await apiPricing("shouting")).toMatchObject({ tarief: "200.00" });
      expect(trace("shouting")).toEqual({ routePricingId: "route-1", routeMatch: "NORMALIZED" });
    });

    it("records a trusted typo as FUZZY, and prices it", async () => {
      world.ordinaryRoutes.push({
        id: "route-charleroi",
        departure: CONFIGURED_TERMINAL,
        destination: "Charleroi",
        basePrice: "180.00",
      });
      world.seed(buildTrip("typo", { destinationCity: "Charelroi" }));
      await close("typo");

      expect(await apiPricing("typo")).toMatchObject({ tarief: "180.00" });
      expect(trace("typo")).toEqual({ routePricingId: "route-charleroi", routeMatch: "FUZZY" });
    });
  });
});
