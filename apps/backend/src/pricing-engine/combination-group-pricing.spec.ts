import { TripDirection } from "@prisma/client";

import {
  CONFIGURED_TERMINAL,
  buildPricingLifecycle,
  buildTrip,
  type ConfiguredCombination,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import { DAY_ONE, DAY_TWO, routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * Operational groups priced as Combinations — through the real services.
 *
 * ── THE RULE (OCTOBER 2026) ─────────────────────────────────────────────────
 * A `trip_group` is operational: imported from one document, or made by hand.
 * A `combination_route_group` is route-price configuration: two legs and Over
 * ST. They meet only through the pair match: a grouped Trip's pricing partner
 * — the other leg of its document, or the other member of a group of exactly
 * two — and its own road, each in its driving direction, must name exactly ONE
 * configured Combination. Otherwise both legs price on ordinary routes and the
 * snapshot says why (`combinationMatch`).
 *
 * ── THE CONFIGURATION ───────────────────────────────────────────────────────
 *   ghlin-mons      Leg 1 Quay 869 → Ghlin 150 · Leg 2 Mons → Quay 869 120
 *                   Over ST 40 / 10 / — (Leg 2 Tarief 120 + 40 + 70 = 230)
 *   ghlin-charleroi Leg 1 Quay 869 → Ghlin 160 · Leg 2 Charleroi → Quay 869 130
 *                   no Over ST (the later leg still owes the €70: 130 + 70 = 200)
 * Both share the outbound Quay 869 → Ghlin: one leg, two Combinations.
 * ────────────────────────────────────────────────────────────────────────────
 */

const OUT = "outbound";
const BACK = "return";
const OTHER = "other-return";

function combination(
  id: string,
  returnFrom: string,
  outboundPrice: string,
  returnPrice: string,
  overSt: ConfiguredCombination["overSt"],
): ConfiguredCombination {
  return {
    id,
    legs: [
      {
        id: `${id}-leg-1`,
        departure: CONFIGURED_TERMINAL,
        destination: "Ghlin",
        basePrice: outboundPrice,
        combinationLegPosition: 1,
      },
      {
        id: `${id}-leg-2`,
        departure: returnFrom,
        destination: CONFIGURED_TERMINAL,
        basePrice: returnPrice,
        combinationLegPosition: 2,
      },
    ],
    overSt,
  };
}

const GHLIN_MONS = () =>
  combination("ghlin-mons", "Mons", "150.00", "120.00", { tarief: "40.00", toll: "10.00", tunnel: null });
const GHLIN_CHARLEROI = () =>
  combination("ghlin-charleroi", "Charleroi", "160.00", "130.00", {
    tarief: null,
    toll: null,
    tunnel: null,
  });

describe("operational groups priced as Combinations", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
    world.combinations.push(GHLIN_MONS(), GHLIN_CHARLEROI());
  });

  /** Three CLOSED Trips from three DIFFERENT documents, in no group yet. */
  async function closedTrips(returnDay = DAY_TWO): Promise<void> {
    world.seed(
      buildTrip(OUT, {
        pdfDocumentId: "pdf-out",
        direction: TripDirection.DELIVERY,
        planningDate: new Date(`${DAY_ONE}T00:00:00Z`),
      }),
    );
    world.seed(
      buildTrip(BACK, {
        pdfDocumentId: "pdf-back",
        direction: TripDirection.COLLECTION,
        destinationCity: "Mons",
        planningDate: new Date(`${returnDay}T00:00:00Z`),
      }),
    );
    world.seed(
      buildTrip(OTHER, {
        pdfDocumentId: "pdf-other",
        direction: TripDirection.COLLECTION,
        destinationCity: "Charleroi",
        planningDate: new Date(`${returnDay}T00:00:00Z`),
      }),
    );
    for (const id of [OUT, BACK, OTHER]) {
      await actions.close(id);
    }
  }

  /** The stored record and both APIs, which must all say the same. */
  async function stored(tripId: string) {
    const snapshot = world.storedSnapshot(tripId)!;
    const ritten = (await actions.apiPricing(tripId))?.routeMatch;
    const detail = (await world.snapshotResponse(tripId))?.routeMatch;

    expect(detail).toEqual(ritten);

    return { snapshot, route: ritten!, pricing: (await actions.apiPricing(tripId))! };
  }

  const surcharges = (tripId: string) => actions.surcharges(tripId);

  describe("selecting the Combination by the full pair", () => {
    it("1/6. prices a manual group of two on the one Combination its roads name", async () => {
      await closedTrips();

      await world.tripService.createGroup([OUT, BACK]);

      const back = await stored(BACK);
      expect(back.route).toMatchObject({
        method: "EXACT",
        combinationRouteGroupId: "ghlin-mons",
        combinationMatch: "MATCHED",
        legs: [
          { legPosition: 1, routePricingId: "ghlin-mons-leg-1", isPricedLeg: false },
          { legPosition: 2, routePricingId: "ghlin-mons-leg-2", isPricedLeg: true },
        ],
      });
      // The stored selection is the one that priced: the same Combination,
      // the same leg, the leg's own Tarief.
      expect(back.snapshot).toMatchObject({
        combinationRouteGroupId: "ghlin-mons",
        routePricingId: "ghlin-mons-leg-2",
        combinationMatch: "MATCHED",
      });
      expect(back.pricing.tarief).toBe("230.00");

      const out = await stored(OUT);
      expect(out.route).toMatchObject({
        combinationRouteGroupId: "ghlin-mons",
        legs: [{ isPricedLeg: true }, { isPricedLeg: false }],
      });
      expect(out.pricing.tarief).toBe("150.00");
    });

    it("2. a leg shared by two Combinations: the pair picks the right one", async () => {
      await closedTrips();

      await world.tripService.createGroup([OUT, OTHER]);

      expect((await stored(OUT)).route.combinationRouteGroupId).toBe("ghlin-charleroi");
      // A day after OUT, with no Over ST configured: its Tarief and the €70 alone.
      expect((await stored(OTHER)).pricing.tarief).toBe("200.00");
    });

    it("3. both roads are legs, but of different Combinations: no route at all, and why", async () => {
      await closedTrips();
      world.combinations.splice(0, 2, {
        ...GHLIN_MONS(),
        legs: [{ ...GHLIN_MONS().legs[0], destination: "Kallo" }, GHLIN_MONS().legs[1]],
      }, GHLIN_CHARLEROI());

      await world.tripService.createGroup([OUT, BACK]);

      // OUT's road IS an ordinary route (route-1): it is never used for a grouped Trip.
      const out = await stored(OUT);
      expect(out.route).toMatchObject({
        routePricingId: null,
        combinationRouteGroupId: null,
        combinationMatch: "PAIR_NOT_CONFIGURED",
        legs: [],
      });
      expect(out.pricing.tarief).toBe("0.00");
      expect((await stored(BACK)).route).toMatchObject({
        method: "NOT_FOUND",
        combinationMatch: "PAIR_NOT_CONFIGURED",
      });
    });

    it("4. a group of three with no genuine pair has no pricing pair", async () => {
      await closedTrips();

      await world.tripService.createGroup([OUT, BACK, OTHER]);

      for (const id of [OUT, BACK, OTHER]) {
        const { route, pricing } = await stored(id);
        expect(route.combinationMatch).toBe("NO_PAIR");
        expect(route.combinationRouteGroupId).toBeNull();
        expect(pricing.backload).toBe("50.00");
      }
    });

    it("5. matches each road in its own driving direction, never reversed", async () => {
      await closedTrips();
      // The return now DELIVERS to Mons: Quay 869 → Mons is no configured leg.
      world.trips.set(BACK, { ...world.trips.get(BACK)!, direction: TripDirection.DELIVERY });

      await world.tripService.createGroup([OUT, BACK]);

      expect((await stored(OUT)).route.combinationMatch).toBe("LEG_NOT_IDENTIFIED");
      expect((await stored(BACK)).route).toMatchObject({
        method: "NOT_FOUND",
        combinationMatch: "LEG_NOT_IDENTIFIED",
      });
    });
  });

  describe("groups and Over ST", () => {
    it("7. both legs on the same day: no Over ST", async () => {
      await closedTrips(DAY_ONE);

      await world.tripService.createGroup([OUT, BACK]);

      const back = await stored(BACK);
      expect(back.route.overSt?.applied).toBe(false);
      expect(back.pricing.tarief).toBe("120.00");
      expect(surcharges(BACK)).toEqual([]);
    });

    it("8. Leg 2 on another day: Over ST and the €70 on Leg 2 only", async () => {
      await closedTrips();

      await world.tripService.createGroup([OUT, BACK]);

      expect((await stored(BACK)).route.overSt).toEqual({
        applied: true,
        tarief: "40.00",
        toll: "10.00",
        tunnel: "0.00",
        surcharge: "70.00",
      });
      expect(surcharges(OUT)).toEqual([]);
      expect((await stored(OUT)).route.overSt?.applied).toBe(false);
    });

    it("9/10/11. regrouping: the old Combination and its Over ST go, the new one is selected", async () => {
      await closedTrips();
      await world.tripService.createGroup([OUT, BACK]);

      // 10. Ungroup: both legs lose the pair — and BOTH are repriced.
      await world.tripService.removeFromGroup(OUT);
      const back = await stored(BACK);
      expect(back.route).toMatchObject({ combinationMatch: "NO_PAIR", combinationRouteGroupId: null });
      expect(back.snapshot.items.some((item) => item.description.startsWith("Over ST"))).toBe(false);
      expect((await stored(OUT)).route).toMatchObject({ combinationMatch: null, legs: [{ routePricingId: "route-1" }] });

      // 11. Regroup with the other return: the other Combination.
      await world.tripService.removeFromGroup(BACK);
      await world.tripService.createGroup([OUT, OTHER]);

      expect((await stored(OUT)).route.combinationRouteGroupId).toBe("ghlin-charleroi");
      expect((await stored(OUT)).pricing.tarief).toBe("160.00");
      expect((await stored(OTHER)).pricing.tarief).toBe("200.00");
    });

    it("12. a leg's road changes: the pair names another Combination, both legs repriced", async () => {
      await closedTrips();
      await world.tripService.createGroup([OUT, BACK]);

      await world.tripService.update(BACK, { destinationCity: "Charleroi" });

      expect((await stored(BACK)).route.combinationRouteGroupId).toBe("ghlin-charleroi");
      // The partner was repriced too, though its own data did not change.
      expect((await stored(OUT)).route.combinationRouteGroupId).toBe("ghlin-charleroi");
      // Ghlin–Charleroi has no Over ST: the later leg keeps only the €70.
      expect(surcharges(BACK)).toHaveLength(1);
      expect((await stored(BACK)).pricing.tarief).toBe("200.00");
    });

    it("13. the €70 once, however often the pair is regrouped and repriced", async () => {
      await closedTrips();
      await world.tripService.createGroup([OUT, BACK]);
      await world.tripService.removeFromGroup(OUT);
      await world.tripService.removeFromGroup(BACK);
      await world.tripService.createGroup([OUT, BACK]);
      await world.engine.reprocess(BACK);
      await world.engine.reprocess(BACK);

      expect(surcharges(BACK)).toHaveLength(1);
      expect((await stored(BACK)).pricing.tarief).toBe("230.00");
      await actions.expectConsistent(BACK);
    });

    it("14. Over ST goes when the dates become equal", async () => {
      await closedTrips();
      await world.tripService.createGroup([OUT, BACK]);

      await actions.moveTo(OUT, DAY_TWO);

      expect((await stored(BACK)).route.overSt?.applied).toBe(false);
      expect(surcharges(BACK)).toEqual([]);
    });

    it("15/16. OPEN legs are not priced; closing again prices on the current group", async () => {
      await closedTrips();
      await actions.reopen(BACK);

      await world.tripService.createGroup([OUT, BACK]);
      expect(await actions.apiPricing(BACK)).toBeNull();
      // The CLOSED partner is priced on the pair already.
      expect((await stored(OUT)).route.combinationRouteGroupId).toBe("ghlin-mons");

      await actions.close(BACK);

      expect((await stored(BACK)).route).toMatchObject({
        combinationRouteGroupId: "ghlin-mons",
        overSt: { applied: true },
      });
    });

    it("17. a removed Combination is never selected again by a later calculation", async () => {
      await closedTrips();
      await world.tripService.createGroup([OUT, BACK]);

      world.combinations.splice(0, 1);
      // The stored selection stands until something prices the leg again.
      expect((await stored(BACK)).route.combinationRouteGroupId).toBe("ghlin-mons");

      await world.engine.reprocess(BACK);

      expect((await stored(BACK)).route).toMatchObject({
        combinationRouteGroupId: null,
        combinationMatch: "LEG_NOT_IDENTIFIED",
      });
    });
  });

  /** 23. An older calculation from another group situation never lands last. */
  it("never stores an older group situation's match beside newer amounts", async () => {
    await closedTrips();
    await world.tripService.createGroup([OUT, BACK]);
    const older = await world.engine.calculate(BACK);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await world.tripService.removeFromGroup(OUT);

    await world.tripPricing.replaceSnapshot({
      tripId: BACK,
      totalPrice: older.totalPrice,
      calculatedAt: older.calculatedAt,
      pricingEngineVersion: older.pricingEngineVersion,
      pricingRuleVersion: older.pricingRuleVersion,
      calculationStatus: older.calculationStatus,
      routePricingId: older.context.routeMatch.routePricingId,
      routeMatch: older.context.routeMatch.method,
      combinationRouteGroupId: older.context.routeMatch.combinationRouteGroupId,
      combinationMatch: older.context.routeMatch.combinationMatch,
      routeSelection: "AUTOMATIC" as const,
      routeLegs: [],
      items: [],
    });

    const back = await stored(BACK);
    expect(back.route).toMatchObject({ combinationMatch: "NO_PAIR", combinationRouteGroupId: null });
    expect(back.snapshot.items.some((item) => item.description.startsWith("Over ST"))).toBe(false);
  });
});
