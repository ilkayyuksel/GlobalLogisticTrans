import {
  CONFIGURED_TERMINAL,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "../pricing-engine/pricing-lifecycle.harness";
import { TripNotPriceableException } from "../pricing-engine/exceptions/pricing-engine.exceptions";
import {
  COMBINATION_ID,
  LEG1_ROW,
  LEG2,
  LEG2_ROW,
  routeMatchActions,
} from "../pricing-engine/route-match-lifecycle.fixtures";
import type { PricingSnapshotDto } from "../trip-pricing/dto/pricing-snapshot.dto";
import { PricingReprocessController } from "./pricing-reprocess.controller";

/**
 * What "Opnieuw verwerken" answers: the price AND the route it was matched to,
 * from the snapshot that was actually stored.
 *
 * The real controller over the real Engine, matcher and snapshot store (tables
 * in memory). Every response is compared with the stored snapshot itself and
 * with GET /trip-pricing/snapshots — one calculation, never two halves, and
 * never a route matched again just for the response.
 */
describe("the reprocess response", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;
  let controller: PricingReprocessController;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
    controller = new PricingReprocessController(world.engine, world.tripPricing);
  });

  const reprocess = (tripId: string) => controller.reprocess({ tripId });

  /** The response IS the stored calculation: header, lines and route. */
  async function expectStored(tripId: string, response: PricingSnapshotDto) {
    const stored = world.storedSnapshot(tripId)!;

    expect(response).toEqual(await world.snapshotResponse(tripId));
    expect(response.pricing.totalPrice).toBe(stored.totalPrice.toFixed(2));
    expect(response.items.map((item) => [item.description, item.amount])).toEqual(
      stored.items.map((item) => [item.description, item.amount.toFixed(2)]),
    );
    expect(response.routeMatch.method).toBe(stored.routeMatch);
    expect(response.routeMatch.routePricingId).toBe(stored.routePricingId);
    expect(response.routeMatch.legs.map((leg) => leg.routePricingId)).toEqual(
      stored.routeLegs.map((leg) => leg.routePricingId),
    );
  }

  async function closedOrdinary(destinationCity: string): Promise<string> {
    world.seed(buildTrip("trip", { destinationCity }));
    await actions.close("trip");

    return "trip";
  }

  it("1. an ordinary route: the stored price, its route id and method", async () => {
    const tripId = await closedOrdinary("Ghlin");

    const response = await reprocess(tripId);

    expect(response.pricing).toMatchObject({
      totalPrice: "230.00",
      routePricingId: "route-1",
      routeMatchMethod: "EXACT",
      combinationRouteGroupId: null,
    });
    expect(response.routeMatch).toEqual({
      method: "EXACT",
      routePricingId: "route-1",
      combinationRouteGroupId: null,
      legs: [
        {
          legPosition: null,
          isPricedLeg: true,
          routePricingId: "route-1",
          departure: CONFIGURED_TERMINAL,
          destination: "Ghlin",
          method: "EXACT",
        },
      ],
      overSt: null,
    });
    await expectStored(tripId, response);
  });

  it("2. a NORMALIZED match is answered as such, with the configured spelling", async () => {
    const tripId = await closedOrdinary("GHLIN");

    const response = await reprocess(tripId);

    expect(response.routeMatch).toMatchObject({
      method: "NORMALIZED",
      legs: [{ destination: "Ghlin", method: "NORMALIZED" }],
    });
    await expectStored(tripId, response);
  });

  it("3. a FUZZY match names the route actually matched", async () => {
    world.ordinaryRoutes.push({
      id: "route-charleroi",
      departure: CONFIGURED_TERMINAL,
      destination: "Charleroi",
      basePrice: "180.00",
    });
    const tripId = await closedOrdinary("Charelroi");

    const response = await reprocess(tripId);

    expect(response.routeMatch).toMatchObject({
      method: "FUZZY",
      routePricingId: "route-charleroi",
      legs: [{ routePricingId: "route-charleroi", destination: "Charleroi" }],
    });
    expect(response.pricing.totalPrice).toBe("207.00");
    await expectStored(tripId, response);
  });

  it("4. NOT_FOUND: no route id is invented", async () => {
    const tripId = await closedOrdinary("Gosselies");

    const response = await reprocess(tripId);

    expect(response.pricing).toMatchObject({ routePricingId: null, routeMatchMethod: "NOT_FOUND" });
    expect(response.routeMatch).toEqual({
      method: "NOT_FOUND",
      routePricingId: null,
      combinationRouteGroupId: null,
      legs: [],
      overSt: null,
    });
    await expectStored(tripId, response);
  });

  it("5. a matched route priced at zero stays distinguishable from NOT_FOUND", async () => {
    world.ordinaryRoutes.push({
      id: "route-zero",
      departure: CONFIGURED_TERMINAL,
      destination: "Gosselies",
      basePrice: "0.00",
    });
    const tripId = await closedOrdinary("Gosselies");

    const response = await reprocess(tripId);

    expect(response.pricing.totalPrice).toBe("0.00");
    expect(response.routeMatch).toMatchObject({
      method: "EXACT",
      routePricingId: "route-zero",
      legs: [{ routePricingId: "route-zero" }],
    });
  });

  describe("a Combination", () => {
    it("6. both stored legs, the selected Combination and this Trip's leg", async () => {
      await actions.closedCombination();

      const response = await reprocess(LEG2);

      expect(response.pricing).toMatchObject({
        routePricingId: LEG2_ROW,
        combinationRouteGroupId: COMBINATION_ID,
      });
      expect(response.routeMatch).toMatchObject({
        method: "EXACT",
        combinationRouteGroupId: COMBINATION_ID,
        legs: [
          { legPosition: 1, routePricingId: LEG1_ROW, isPricedLeg: false, method: "EXACT" },
          { legPosition: 2, routePricingId: LEG2_ROW, isPricedLeg: true, method: "EXACT" },
        ],
      });
      await expectStored(LEG2, response);
    });

    it("7. Over ST applied: its amounts and the €70 once, as stored", async () => {
      await actions.closedCombination();

      await reprocess(LEG2);
      const response = await reprocess(LEG2);

      expect(response.routeMatch.overSt).toEqual({
        applied: true,
        tarief: "40.00",
        toll: "10.00",
        tunnel: "0.00",
        surcharge: "70.00",
      });
      expect(response.items.filter((item) => item.description === "Over ST toeslag")).toHaveLength(1);
      // 230 Tarief + 34.50 fuel + 50 Backload + 10 Toll.
      expect(response.pricing.totalPrice).toBe("324.50");
      await expectStored(LEG2, response);
    });

    it("8. Over ST no longer applying: nothing of the previous snapshot's Over ST", async () => {
      await actions.closedCombination();
      expect((await reprocess(LEG2)).routeMatch.overSt?.applied).toBe(true);

      world.combinations[0].overSt = { tarief: null, toll: null, tunnel: null };
      const response = await reprocess(LEG2);

      expect(response.routeMatch.overSt).toEqual({
        applied: false,
        tarief: "0.00",
        toll: "0.00",
        tunnel: "0.00",
        surcharge: "0.00",
      });
      expect(response.items.some((item) => item.description.startsWith("Over ST"))).toBe(false);
      expect(response.pricing.totalPrice).toBe("188.00");
      await expectStored(LEG2, response);
    });
  });

  it("9. an OPEN Trip: refused, and no old pricing or route is answered", async () => {
    const tripId = await closedOrdinary("Ghlin");
    await actions.reopen(tripId);

    await expect(reprocess(tripId)).rejects.toBeInstanceOf(TripNotPriceableException);
    // The history stays, unchanged; it is simply not a current price.
    expect(world.storedSnapshot(tripId)?.routeMatch).toBe("EXACT");
    expect(await world.snapshotResponse(tripId)).toBeNull();
  });

  it("10. reopened and closed again: the new calculation and the new match", async () => {
    const tripId = await closedOrdinary("Ghlin");
    await actions.reopen(tripId);
    world.ordinaryRoutes[0].destination = "GHLIN";
    world.ordinaryRoutes[0].basePrice = "260.00";
    await actions.close(tripId);

    const response = await reprocess(tripId);

    expect(response.routeMatch).toMatchObject({
      method: "NORMALIZED",
      legs: [{ destination: "GHLIN" }],
    });
    // 260 Tarief + 39 fuel.
    expect(response.pricing.totalPrice).toBe("299.00");
    await expectStored(tripId, response);
  });
});
