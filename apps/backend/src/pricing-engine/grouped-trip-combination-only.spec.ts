import { TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { BulkPricingReprocessService } from "../pricing-reprocess/bulk-pricing-reprocess.service";
import {
  CONFIGURED_ROUTE_ID,
  CONFIGURED_TERMINAL,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import {
  COMBINATION_ID,
  DAY_ONE,
  DAY_TWO,
  DOCUMENT,
  GROUP,
  LEG1,
  LEG1_ROW,
  LEG2,
  WITH_OVER_ST,
  routeMatchActions,
} from "./route-match-lifecycle.fixtures";

/**
 * ── A GROUPED TRIP USES ONLY A COMBINATION (owner's rule, October 2026) ─────
 * A Trip in no group may use the ordinary route configuration. A Trip in a
 * group may use ONLY a Combination its pair of roads names unambiguously —
 * otherwise it prices no route at all, says why, and keeps its Backload. The
 * ordinary route, which used to be the fallback, is never borrowed.
 *
 * Leg 1's road (PSA Quay 869 → Ghlin) is configured BOTH as the ordinary route
 * `route-1` (200.00) and as Leg 1 of the Combination (150.00), so every test
 * here would have priced 200.00 under the old fallback.
 *
 * Run through the REAL Engine, trigger services and snapshot store; asserted
 * on the stored snapshot and on the API's answer.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("a grouped Trip prices only on a Combination", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  /** The stored route record and the API's, which must agree. */
  async function routeOf(tripId: string) {
    const stored = world.storedSnapshot(tripId)!;
    const api = await actions.apiPricing(tripId);

    expect((await world.snapshotResponse(tripId))?.routeMatch).toEqual(api?.routeMatch);

    return { stored, api: api!, routeMatch: api!.routeMatch! };
  }

  function expectNoRoute(stored: NonNullable<ReturnType<PricingLifecycle["storedSnapshot"]>>) {
    expect(stored.routePricingId).toBeNull();
    expect(stored.routeLegs).toEqual([]);
    expect(stored.items.map((item) => item.description)).not.toContain("Over ST toeslag");
  }

  /** The ordinary road of Leg 2 too, so both legs exist as ordinary routes. */
  function configureLeg2AsOrdinaryRoute(): void {
    world.ordinaryRoutes.push({
      id: "route-mons",
      departure: "Mons",
      destination: CONFIGURED_TERMINAL,
      basePrice: "180.00",
    });
  }

  it("1. an ungrouped Trip is priced on its ordinary route", async () => {
    actions.configureCombination();
    actions.seedLegs(DAY_TWO, null);
    await actions.close(LEG1);

    const { stored, api, routeMatch } = await routeOf(LEG1);
    expect(stored.routePricingId).toBe(CONFIGURED_ROUTE_ID);
    expect(routeMatch).toMatchObject({ routePricingId: CONFIGURED_ROUTE_ID, combinationMatch: null });
    expect(api.tarief).toBe("200.00");
  });

  it("2/8. a group of two whose roads name the Combination is priced on it, consistently", async () => {
    await actions.closedCombination();

    const { stored, api, routeMatch } = await routeOf(LEG1);
    expect(stored).toMatchObject({ routePricingId: LEG1_ROW, combinationMatch: "MATCHED" });
    expect(routeMatch).toMatchObject({
      routePricingId: LEG1_ROW,
      combinationRouteGroupId: COMBINATION_ID,
      combinationMatch: "MATCHED",
    });
    expect(routeMatch.legs).toHaveLength(2);
    expect(api.tarief).toBe("150.00");
    expect(await actions.apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
    await actions.expectConsistent(LEG1);
  });

  it("3. a grouped Trip with no pricing partner prices no route", async () => {
    actions.configureCombination();
    // Three documents in one group: no same-document pair, no group of two.
    world.seed(buildTrip(LEG1, { tripGroupId: GROUP, direction: TripDirection.DELIVERY }));
    world.seed(buildTrip("other-1", { tripGroupId: GROUP, direction: TripDirection.COLLECTION }));
    world.seed(buildTrip("other-2", { tripGroupId: GROUP, direction: TripDirection.COLLECTION }));
    await actions.close(LEG1);

    const { stored, api, routeMatch } = await routeOf(LEG1);
    expectNoRoute(stored);
    expect(routeMatch).toMatchObject({ routePricingId: null, combinationMatch: "NO_PAIR", method: "NOT_FOUND" });
    expect(api).toMatchObject({ tarief: "0.00", backload: "50.00" });
  });

  it("4/9. both legs ordinary routes but no Combination: no fallback, a warning, and the Trip still closes", async () => {
    configureLeg2AsOrdinaryRoute();
    actions.seedLegs();
    await actions.close(LEG1);
    await actions.close(LEG2);

    for (const tripId of [LEG1, LEG2]) {
      expect(world.trips.get(tripId)?.status).toBe(TripStatus.CLOSED);
      const { stored, api, routeMatch } = await routeOf(tripId);
      expectNoRoute(stored);
      expect(routeMatch).toMatchObject({ combinationMatch: "LEG_NOT_IDENTIFIED", combinationRouteGroupId: null });
      expect(api).toMatchObject({ tarief: "0.00", tol: "0.00", backload: "50.00", totaal: "50.00" });
    }
    expect(world.logger.warn).toHaveBeenCalledWith(
      "Combination pair not identified; no route priced, route components zero",
      expect.objectContaining({ tripId: LEG1, combinationMatch: "LEG_NOT_IDENTIFIED" }),
    );
  });

  it("5. two Combinations of the pair: none is chosen, and no ordinary route either", async () => {
    actions.configureCombination();
    world.combinations.push({ ...world.combinations[0], id: "combination-2" });
    actions.seedLegs();
    await actions.close(LEG1);

    const { stored, routeMatch } = await routeOf(LEG1);
    expectNoRoute(stored);
    expect(routeMatch).toMatchObject({ combinationMatch: "AMBIGUOUS", method: "AMBIGUOUS" });
  });

  it("6. a pair in the wrong direction is no match, and no ordinary route either", async () => {
    actions.configureCombination();
    actions.seedLegs();
    // Leg 2 now runs terminal → Mons: the Combination's return reversed.
    world.trips.set(LEG2, { ...world.trips.get(LEG2)!, direction: TripDirection.DELIVERY });
    await actions.close(LEG1);

    const { stored, api } = await routeOf(LEG1);
    expectNoRoute(stored);
    expect(api.tarief).toBe("0.00");
  });

  it("7. a group of three keeps its same-document pair, priced on the Combination", async () => {
    actions.configureCombination();
    actions.seedLegs();
    world.seed(buildTrip("third", { tripGroupId: GROUP, direction: TripDirection.COLLECTION }));
    await actions.close(LEG1);

    expect(world.storedSnapshot(LEG1)).toMatchObject({ routePricingId: LEG1_ROW, combinationMatch: "MATCHED" });
  });

  it("a Combination leg configured at 0.00 stays distinguishable from no match", async () => {
    actions.configureCombination();
    world.combinations[0].legs[0].basePrice = "0.00";
    actions.seedLegs();
    await actions.close(LEG1);

    const { stored, api } = await routeOf(LEG1);
    expect(stored).toMatchObject({ routePricingId: LEG1_ROW, combinationMatch: "MATCHED" });
    expect(api.tarief).toBe("0.00");
  });

  it("10/12. a route change that breaks the pair removes Over ST and the 70, keeps the Backload", async () => {
    await actions.closedCombination();
    expect(actions.surcharges(LEG2)).toHaveLength(1);

    await world.tripService.update(LEG2, { destinationCity: "Charleroi" });

    const { stored, api, routeMatch } = await routeOf(LEG2);
    expectNoRoute(stored);
    expect(actions.surcharges(LEG2)).toEqual([]);
    expect(routeMatch.combinationMatch).toBe("LEG_NOT_IDENTIFIED");
    expect(api).toMatchObject({ tarief: "0.00", tol: "0.00", backload: "50.00", totaal: "50.00" });
  });

  it("11. ungrouping prices the Trip on its ordinary route again", async () => {
    configureLeg2AsOrdinaryRoute();
    actions.seedLegs();
    await actions.close(LEG1);
    expect(world.storedSnapshot(LEG1)?.routePricingId).toBeNull();

    await world.tripService.removeFromGroup(LEG1);

    const { stored, api } = await routeOf(LEG1);
    expect(stored).toMatchObject({ routePricingId: CONFIGURED_ROUTE_ID, combinationMatch: null });
    expect(api).toMatchObject({ tarief: "200.00", backload: "0.00" });
  });

  it("12/14. grouping a CLOSED Trip drops its ordinary price from the new snapshot", async () => {
    actions.seedLegs(DAY_TWO, null);
    await actions.close(LEG1);
    await actions.close(LEG2);
    expect((await actions.apiPricing(LEG1))?.tarief).toBe("200.00");

    await world.tripService.createGroup([LEG1, LEG2]);

    const { stored, api } = await routeOf(LEG1);
    expectNoRoute(stored);
    expect(stored.items.some((item) => item.amount.toFixed(2) === "200.00")).toBe(false);
    expect(api).toMatchObject({ tarief: "0.00", backload: "50.00", totaal: "50.00" });
  });

  it("12. an explicit reprocess applies the same rule", async () => {
    actions.seedLegs();
    await actions.close(LEG1);

    await new BulkPricingReprocessService(world.engine, world.tripPricing, {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService).reprocessMany([LEG1]);

    expectNoRoute(world.storedSnapshot(LEG1)!);
  });

  it("13. an OPEN grouped Trip has no current price", async () => {
    actions.configureCombination();
    actions.seedLegs();
    await world.tripService.update(LEG1, { planningDate: DAY_ONE });

    expect(world.storedSnapshot(LEG1)).toBeNull();
    expect(await actions.apiPricing(LEG1)).toBeNull();
    expect(world.trips.get(LEG1)?.pdfDocumentId).toBe(DOCUMENT);
  });
});
