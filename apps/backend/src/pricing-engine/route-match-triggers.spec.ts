import {
  CONFIGURED_TERMINAL,
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import {
  COMBINATION_ID,
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
 * Every trigger that prices a Trip matches its route again, and the route the
 * stored price came from is visible — in the stored snapshot, on the Ritten
 * row (GET /trips) and on the detail panel (GET /trip-pricing/snapshots) — as
 * ONE calculation: never a route from one beside the amounts of another.
 *
 * Real services, Engine and matcher over in-memory tables; the Combination and
 * its amounts are in `route-match-lifecycle.fixtures.ts`.
 */
describe("which route a stored price came from, through every trigger", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  const LEG1_TRACE = {
    legPosition: 1,
    routePricingId: LEG1_ROW,
    departure: CONFIGURED_TERMINAL,
    destination: "Ghlin",
    method: "EXACT",
  };
  const LEG2_TRACE = {
    legPosition: 2,
    routePricingId: LEG2_ROW,
    departure: "Mons",
    destination: CONFIGURED_TERMINAL,
    method: "EXACT",
  };

  /** The route as both APIs answer it, which must agree. */
  async function apiRoute(tripId: string) {
    const ritten = (await actions.apiPricing(tripId))?.routeMatch ?? null;
    const detail = (await world.snapshotResponse(tripId))?.routeMatch ?? null;

    expect(detail).toEqual(ritten);

    return ritten;
  }

  /** Leg 2 priced by the Combination, both legs named, with or without Over ST. */
  async function expectCombination(tripId: string, overStApplied: boolean) {
    const route = await apiRoute(tripId);

    expect(route).toMatchObject({
      method: "EXACT",
      combinationRouteGroupId: COMBINATION_ID,
      legs: [
        { ...LEG1_TRACE, isPricedLeg: tripId === LEG1 },
        { ...LEG2_TRACE, isPricedLeg: tripId === LEG2 },
      ],
    });
    if (tripId === LEG2) {
      expect(route?.overSt).toEqual(
        overStApplied
          ? { applied: true, tarief: "40.00", toll: "10.00", tunnel: "0.00", surcharge: "70.00" }
          : { applied: false, tarief: "0.00", toll: "0.00", tunnel: "0.00", surcharge: "0.00" },
      );
    }
    // The stored rows themselves, not only what an API made of them.
    expect(world.storedSnapshot(tripId)).toMatchObject({
      combinationRouteGroupId: COMBINATION_ID,
      routeLegs: [
        expect.objectContaining({ legPosition: 1, routePricingId: LEG1_ROW, matchMethod: "EXACT" }),
        expect.objectContaining({ legPosition: 2, routePricingId: LEG2_ROW, matchMethod: "EXACT" }),
      ],
    });
  }

  /** Leg 2 priced on its own: the ordinary road Mons → Quay 869, not configured. */
  async function expectUnmatched(tripId: string) {
    expect(await apiRoute(tripId)).toEqual({
      method: "NOT_FOUND",
      routePricingId: null,
      combinationRouteGroupId: null,
      legs: [],
      overSt: null,
    });
    expect(world.storedSnapshot(tripId)?.routeLegs).toEqual([]);
  }

  describe("an ordinary Trip", () => {
    it("shows the configured route that priced it, as configured, and how it matched", async () => {
      world.seed(buildTrip("shouting", { destinationCity: "GHLIN" }));
      await actions.close("shouting");

      expect(await apiRoute("shouting")).toEqual({
        method: "NORMALIZED",
        routePricingId: "route-1",
        combinationRouteGroupId: null,
        legs: [
          {
            legPosition: null,
            isPricedLeg: true,
            routePricingId: "route-1",
            // The configuration's spelling — the route actually used.
            departure: CONFIGURED_TERMINAL,
            destination: "Ghlin",
            method: "NORMALIZED",
          },
        ],
        overSt: null,
      });
    });

    /** A collection is never priced on the delivery road it reverses. */
    it("never shows a reversed route as matched", async () => {
      world.seed(buildTrip("collection", { direction: "COLLECTION" }));
      await actions.close("collection");

      expect(await actions.apiPricing("collection")).toMatchObject({ tarief: "0.00" });
      expect((await apiRoute("collection"))?.method).toBe("NOT_FOUND");
    });
  });

  describe("1–3. closing, reopening and closing again", () => {
    it("hides the route of an OPEN Trip and records the new match when it closes again", async () => {
      world.seed(buildTrip("trip"));
      await actions.close("trip");
      expect((await apiRoute("trip"))?.legs).toHaveLength(1);

      await actions.reopen("trip");
      // No current price, so no current route: neither API presents the old one.
      expect(await actions.apiPricing("trip")).toBeNull();
      expect(await world.snapshotResponse("trip")).toBeNull();
      // The history stays stored.
      expect(world.storedSnapshot("trip")?.routeLegs).toHaveLength(1);

      // The configuration changes while the Trip is OPEN…
      world.ordinaryRoutes[0].destination = "GHLIN";
      await actions.close("trip");

      // …and closing again matches anew: the new spelling, the new method.
      expect(await apiRoute("trip")).toMatchObject({
        method: "NORMALIZED",
        legs: [{ destination: "GHLIN", method: "NORMALIZED" }],
      });
    });
  });

  describe("4–5. grouping and ungrouping CLOSED Trips", () => {
    it("4. prices both legs on the Combination once grouped", async () => {
      actions.configureCombination();
      actions.seedLegs(DAY_TWO, null);
      await actions.close(LEG1);
      await actions.close(LEG2);
      // Apart, each is an ordinary Trip: Leg 2's road is no ordinary route.
      await expectUnmatched(LEG2);

      await world.tripService.createGroup([LEG1, LEG2]);

      await expectCombination(LEG1, false);
      await expectCombination(LEG2, true);
      expect(await actions.apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
    });

    it("5. reprices the leg left behind when its partner leaves the group", async () => {
      await actions.closedCombination();

      await world.tripService.removeFromGroup(LEG1);

      // Leg 2 is no longer half of a pair: no Combination, no Over ST, no €70.
      await expectUnmatched(LEG2);
      expect(actions.surcharges(LEG2)).toEqual([]);
      // Leg 1, out of the group, prices on its ordinary road.
      expect((await apiRoute(LEG1))?.legs).toEqual([
        expect.objectContaining({ legPosition: null, routePricingId: "route-1" }),
      ]);
    });
  });

  /**
   * 6. A Combination configuration changed: nothing reprices by itself; the
   * next pricing of a leg — any trigger — reads the configuration as it is.
   */
  describe("6. a changed Combination configuration", () => {
    it("is applied by the next trigger, not by the change itself", async () => {
      await actions.closedCombination();
      world.combinations[0].legs[1].destination = "QUAY 869";
      world.combinations[0].overSt = { tarief: null, toll: null, tunnel: null };

      // Still the stored calculation, its route and its Over ST.
      await expectCombination(LEG2, true);

      // A waiting time on Leg 2 reprices it: the new spelling, no Over ST.
      await world.tripService.update(LEG2, { waitingTimeStart: "10:00", waitingTimeEnd: "11:00" });

      expect(await apiRoute(LEG2)).toMatchObject({
        method: "NORMALIZED",
        legs: [{ legPosition: 1 }, { legPosition: 2, destination: "QUAY 869", method: "NORMALIZED" }],
        overSt: { applied: false },
      });
      expect(await actions.apiPricing(LEG2)).toMatchObject({ tarief: "120.00", tol: "0.00" });
      // Leg 1 was not repriced: its stored match is unchanged.
      expect(world.storedSnapshot(LEG1)?.routeLegs[1]).toMatchObject({ destination: CONFIGURED_TERMINAL });
    });

    it("keeps showing the route a price came from after that route is removed", async () => {
      world.seed(buildTrip("trip"));
      await actions.close("trip");

      world.ordinaryRoutes.splice(0, 1);

      expect(await apiRoute("trip")).toMatchObject({
        method: "EXACT",
        legs: [{ routePricingId: "route-1", destination: "Ghlin" }],
      });

      await world.engine.reprocess("trip");
      expect((await apiRoute("trip"))?.method).toBe("NOT_FOUND");
    });
  });

  describe("7–8. planning dates", () => {
    it("7. Leg 1's date moves Leg 2's Over ST, and its recorded route stays the pair", async () => {
      await actions.closedCombination();

      await actions.moveTo(LEG1, DAY_TWO);
      await expectCombination(LEG2, false);
      expect(await actions.apiPricing(LEG2)).toMatchObject(WITHOUT_OVER_ST);

      await actions.moveTo(LEG1, DAY_ONE);
      await expectCombination(LEG2, true);
      expect(await actions.apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
    });

    it("8. Leg 2's own date does the same, both ways", async () => {
      await actions.closedCombination();

      await actions.moveTo(LEG2, DAY_ONE);
      await expectCombination(LEG2, false);

      await actions.moveTo(LEG2, DAY_TWO);
      await expectCombination(LEG2, true);
      expect(actions.surcharges(LEG2)).toHaveLength(1);
    });
  });

  /** 9–11. Every other pricing input reprices with the same match, nothing added twice. */
  describe("9–11. waiting time, Custom Values and Cost Confirmations", () => {
    it("re-records the same Combination after each, the €70 still once", async () => {
      await actions.closedCombination();

      await world.tripService.update(LEG2, { waitingTimeStart: "10:00", waitingTimeEnd: "13:00" });
      await expectCombination(LEG2, true);

      await world.tripService.update(LEG2, { waitingTimeStart: null, waitingTimeEnd: null });
      const assigned = await world.customValues.assign({
        tripId: LEG2,
        customPropertyId: PROPERTIES.genset.id,
      });
      await expectCombination(LEG2, true);
      expect(await actions.apiPricing(LEG2)).toMatchObject({ others: "35.00" });

      await world.customValues.remove(assigned.id);
      await world.confirmCost(LEG2, "4132482", "25.00");
      await expectCombination(LEG2, true);
      expect(await actions.apiPricing(LEG2)).toMatchObject({ ...WITH_OVER_ST, ek: "25.00", totaal: "349.50" });

      expect(actions.surcharges(LEG2)).toHaveLength(1);
      await actions.expectConsistent(LEG2);
    });
  });

  /**
   * 13. A leg's own road edited while both legs are CLOSED: the pair both legs
   * are priced on changes, so the PARTNER is repriced too.
   */
  describe("13. a leg's road changed by an edit", () => {
    it("reprices the partner: the pair is no longer configured, then is again", async () => {
      await actions.closedCombination();

      await world.tripService.update(LEG1, { destinationCity: "Gosselies" });

      // Leg 2's pair is no configured Combination any more: its own ordinary
      // road (Mons → Quay 869) is not configured either — and no Over ST.
      await expectUnmatched(LEG2);
      expect(actions.surcharges(LEG2)).toEqual([]);

      await world.tripService.update(LEG1, { destinationCity: "Ghlin" });

      await expectCombination(LEG2, true);
      expect(await actions.apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
    });
  });

  describe("12. an explicit reprocess", () => {
    it("matches again and replaces the route with the amounts", async () => {
      world.seed(buildTrip("trip", { destinationCity: "Charelroi" }));
      await actions.close("trip");
      expect((await apiRoute("trip"))?.method).toBe("NOT_FOUND");

      world.ordinaryRoutes.push({
        id: "route-charleroi",
        departure: CONFIGURED_TERMINAL,
        destination: "Charleroi",
        basePrice: "180.00",
      });
      // Configured, but nothing repriced it yet.
      expect((await apiRoute("trip"))?.method).toBe("NOT_FOUND");

      await world.engine.reprocess("trip");

      expect(await apiRoute("trip")).toMatchObject({
        method: "FUZZY",
        legs: [{ routePricingId: "route-charleroi", destination: "Charleroi" }],
      });
      expect(await actions.apiPricing("trip")).toMatchObject({ tarief: "180.00" });
    });
  });

  /**
   * An older calculation storing last keeps the newer one — amounts AND route:
   * the route is part of the header that refuses the older write.
   */
  describe("concurrent calculations", () => {
    it("never puts an older calculation's route beside newer amounts", async () => {
      world.seed(buildTrip("trip"));
      await actions.close("trip");
      const older = await world.engine.calculate("trip");
      await new Promise((resolve) => setTimeout(resolve, 5));

      world.ordinaryRoutes[0].destination = "GHLIN";
      world.ordinaryRoutes[0].basePrice = "260.00";
      await world.engine.reprocess("trip");

      await world.tripPricing.replaceSnapshot({
        tripId: "trip",
        totalPrice: older.totalPrice,
        calculatedAt: older.calculatedAt,
        pricingEngineVersion: older.pricingEngineVersion,
        pricingRuleVersion: older.pricingRuleVersion,
        calculationStatus: older.calculationStatus,
        routePricingId: older.context.routeMatch.routePricingId,
        routeMatch: older.context.routeMatch.method,
        combinationRouteGroupId: null,
        routeLegs: older.context.routeMatch.legs.map((leg) => ({
          legPosition: leg.legPosition,
          isPricedLeg: leg.isPricedLeg,
          routePricingId: leg.routePricingId,
          departure: leg.departure,
          destination: leg.destination,
          matchMethod: leg.method,
        })),
        items: [],
      });

      expect(await actions.apiPricing("trip")).toMatchObject({ tarief: "260.00" });
      expect(await apiRoute("trip")).toMatchObject({
        method: "NORMALIZED",
        legs: [{ destination: "GHLIN" }],
      });
    });
  });
});
