import { BadRequestException, ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { TripDirection, TripStatus } from "@prisma/client";

import { PricingReprocessController } from "../pricing-reprocess/pricing-reprocess.controller";
import { MissingPricingSettingException } from "./exceptions/pricing-engine.exceptions";
import {
  CONFIGURED_TERMINAL,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import { PricingEngineService } from "./pricing-engine.service";
import { DAY_ONE, DAY_TWO, GROUP, LEG1, LEG2, routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * "Route kiezen": a route chosen by hand when automatic matching found none
 * usable (owner, October 2026) — through the real Engine, matcher, snapshot
 * store and Trip services (tables in memory).
 *
 * The automatic matcher and every price rule are the existing ones; these
 * tests are about WHICH route prices a Trip, what is recorded, and when the
 * choice goes away again.
 */

const OTHER_ROUTE = "route-lille";
/** A Combination whose roads are not the legs' roads: nothing can match it automatically. */
const UNMATCHED_COMBINATION = "combination-lille";
/** A Combination whose outbound IS Leg 1's road, so the roads decide the legs. */
const HALF_MATCHING_COMBINATION = "combination-half";

describe("choosing a route by hand", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
    world.ordinaryRoutes.push({
      id: OTHER_ROUTE,
      departure: CONFIGURED_TERMINAL,
      destination: "Lille",
      basePrice: "333.00",
    });
    world.combinations.push(
      {
        id: UNMATCHED_COMBINATION,
        legs: [
          { id: "lille-out", departure: CONFIGURED_TERMINAL, destination: "Lille", basePrice: "150.00", combinationLegPosition: 1 },
          { id: "lille-back", departure: "Lille", destination: CONFIGURED_TERMINAL, basePrice: "120.00", combinationLegPosition: 2 },
        ],
        overSt: { tarief: "40.00", toll: "10.00", tunnel: null },
      },
      {
        id: HALF_MATCHING_COMBINATION,
        legs: [
          { id: "half-out", departure: CONFIGURED_TERMINAL, destination: "Ghlin", basePrice: "111.00", combinationLegPosition: 1 },
          { id: "half-back", departure: "Lille", destination: CONFIGURED_TERMINAL, basePrice: "99.00", combinationLegPosition: 2 },
        ],
        overSt: { tarief: "40.00", toll: "10.00", tunnel: null },
      },
    );
  });

  const route = async (tripId: string) => (await world.readTrip(tripId)).pricing?.routeMatch;
  const choose = (tripId: string, request: Parameters<PricingLifecycle["routeChoice"]["choose"]>[1]) =>
    world.routeChoice.choose(tripId, request);

  /** A CLOSED Trip in no group whose road is configured nowhere. */
  async function unmatchedTrip(id = "trip"): Promise<string> {
    world.seed(buildTrip(id, { destinationCity: "Charleroi" }));
    await actions.close(id);

    return id;
  }

  /** Both legs of one document, grouped and CLOSED, on a pair nobody configured. */
  async function unmatchedPair(leg2Status: TripStatus = TripStatus.CLOSED): Promise<void> {
    actions.seedLegs(DAY_TWO);
    await actions.close(LEG1);
    if (leg2Status === TripStatus.CLOSED) {
      await actions.close(LEG2);
    }
  }

  describe("a Trip in no group", () => {
    it("1. prices a NOT_FOUND Trip on the ordinary route chosen for it", async () => {
      const tripId = await unmatchedTrip();
      expect(await route(tripId)).toMatchObject({ method: "NOT_FOUND", manualChoice: "NORMAL" });

      expect(await choose(tripId, { kind: "NORMAL", routePricingId: OTHER_ROUTE })).toEqual([tripId]);

      // 3. The chosen route really prices it, through the existing Engine.
      expect(await actions.apiPricing(tripId)).toMatchObject({ tarief: "333.00" });
      expect(world.storedSnapshot(tripId)).toMatchObject({
        routePricingId: OTHER_ROUTE,
        routeSelection: "MANUAL",
        // The automatic outcome stays: it is why the choice was needed.
        routeMatch: "NOT_FOUND",
      });
      expect(await route(tripId)).toMatchObject({ selection: "MANUAL", routePricingId: OTHER_ROUTE });
      expect(world.routeChoices.get(tripId)).toBe(OTHER_ROUTE);
      await actions.expectConsistent(tripId);
    });

    it("2. allows a choice when the automatic match is ambiguous", async () => {
      world.ordinaryRoutes.push({ id: "route-ghlin-shout", departure: CONFIGURED_TERMINAL, destination: "GHLIN", basePrice: "250.00" });
      // Neither spelling is the Trip's own, so both match it equally well.
      world.seed(buildTrip("trip", { destinationCity: "ghlin" }));
      await actions.close("trip");
      expect(await route("trip")).toMatchObject({ method: "AMBIGUOUS", manualChoice: "NORMAL" });

      await choose("trip", { kind: "NORMAL", routePricingId: "route-ghlin-shout" });

      expect(await actions.apiPricing("trip")).toMatchObject({ tarief: "250.00" });
      expect(world.storedSnapshot("trip")).toMatchObject({ routeSelection: "MANUAL", routeMatch: "AMBIGUOUS" });
    });

    it("5. refuses a Combination for a Trip in no group", async () => {
      const tripId = await unmatchedTrip();

      await expect(
        choose(tripId, { kind: "COMBINATION", combinationRouteGroupId: UNMATCHED_COMBINATION }),
      ).rejects.toThrow(BadRequestException);
      expect(world.routeChoices.size).toBe(0);
    });

    it("refuses a choice while the automatic match is usable, and never overrides it", async () => {
      world.seed(buildTrip("matched"));
      await actions.close("matched");

      await expect(choose("matched", { kind: "NORMAL", routePricingId: OTHER_ROUTE })).rejects.toThrow(
        ConflictException,
      );
      expect(world.storedSnapshot("matched")).toMatchObject({ routeSelection: "AUTOMATIC", routePricingId: "route-1" });
      expect(await route("matched")).toMatchObject({ manualChoice: null });
    });

    it("refuses a Trip that is not finished", async () => {
      world.seed(buildTrip("open", { destinationCity: "Charleroi" }));

      await expect(choose("open", { kind: "NORMAL", routePricingId: OTHER_ROUTE })).rejects.toThrow(ConflictException);
    });
  });

  describe("a grouped Trip and its partner leg", () => {
    it("5. refuses an ordinary route for a grouped Trip", async () => {
      await unmatchedPair();

      await expect(choose(LEG1, { kind: "NORMAL", routePricingId: OTHER_ROUTE })).rejects.toThrow(BadRequestException);
    });

    it("6. gives the partner the other leg, derived from the roads", async () => {
      await unmatchedPair();
      expect(await route(LEG2)).toMatchObject({ manualChoice: "COMBINATION" });

      // Chosen on Leg 2; Leg 1's road IS the outbound of this Combination.
      expect(await choose(LEG2, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION })).toEqual([
        LEG2,
        LEG1,
      ]);

      expect(world.routeChoices.get(LEG1)).toBe("half-out");
      expect(world.routeChoices.get(LEG2)).toBe("half-back");
      expect(world.storedSnapshot(LEG1)).toMatchObject({
        routeSelection: "MANUAL",
        combinationRouteGroupId: HALF_MATCHING_COMBINATION,
        routePricingId: "half-out",
      });
      expect(world.storedSnapshot(LEG2)).toMatchObject({
        routeSelection: "MANUAL",
        combinationRouteGroupId: HALF_MATCHING_COMBINATION,
        routePricingId: "half-back",
      });
      // The existing pair rules: Tarief per leg, Over ST on Leg 2 on another day.
      expect(await actions.apiPricing(LEG1)).toMatchObject({ tarief: "111.00", backload: "50.00" });
      // 99.00 + Over ST 40.00 + the €70 Over ST surcharge, as on an automatic match.
      expect(await actions.apiPricing(LEG2)).toMatchObject({ tarief: "209.00", backload: "50.00" });
      expect(actions.surcharges(LEG2)).toHaveLength(1);
      await actions.expectConsistent(LEG1);
      await actions.expectConsistent(LEG2);
    });

    it("6. asks which leg when the roads do not say, and then pairs them", async () => {
      await unmatchedPair();

      await expect(
        choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: UNMATCHED_COMBINATION }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(world.routeChoices.size).toBe(0);

      await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: UNMATCHED_COMBINATION, legPosition: 2 });

      expect(world.routeChoices.get(LEG1)).toBe("lille-back");
      expect(world.routeChoices.get(LEG2)).toBe("lille-out");
    });

    /** The order of the clicks never decides: the same choice from either leg is the same pair. */
    it("6. assigns the same legs whichever leg the choice is made on", async () => {
      await unmatchedPair();

      await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION });

      expect(world.routeChoices.get(LEG1)).toBe("half-out");
      expect(world.routeChoices.get(LEG2)).toBe("half-back");
    });

    it("refuses a named leg the roads contradict", async () => {
      await unmatchedPair();

      await expect(
        choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION, legPosition: 2 }),
      ).rejects.toThrow(ConflictException);
      expect(world.routeChoices.size).toBe(0);
    });

    it("refuses while the partner leg is not finished", async () => {
      await unmatchedPair(TripStatus.OPEN);

      await expect(
        choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION }),
      ).rejects.toThrow(ConflictException);
    });

    it("refuses a group with no unambiguous partner", async () => {
      await unmatchedPair();
      world.seed(buildTrip("third", { tripGroupId: GROUP, pdfDocumentId: "pdf-third", direction: TripDirection.DELIVERY }));
      await actions.close("third");
      await actions.close(LEG1);

      expect(await route("third")).toMatchObject({ combinationMatch: "NO_PAIR", manualChoice: null });
      await expect(
        choose("third", { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION }),
      ).rejects.toThrow(ConflictException);
    });

    /** 7. Both or neither: a leg the Engine cannot price leaves everything as it was. */
    it("7. stores nothing when either leg cannot be priced on the choice", async () => {
      await unmatchedPair();
      const before = { leg1: world.storedSnapshot(LEG1), leg2: world.storedSnapshot(LEG2) };
      const realCalculate = PricingEngineService.prototype.calculate;
      jest.spyOn(world.engine, "calculate").mockImplementation((tripId, choices) =>
        tripId === LEG1
          ? Promise.reject(new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"))
          : realCalculate.call(world.engine, tripId, choices),
      );

      await expect(
        choose(LEG2, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION }),
      ).rejects.toThrow();

      expect(world.routeChoices.size).toBe(0);
      expect(world.storedSnapshot(LEG1)).toEqual(before.leg1);
      expect(world.storedSnapshot(LEG2)).toEqual(before.leg2);
      expect(await route(LEG2)).toMatchObject({ selection: "AUTOMATIC" });
    });

    /** With the paired triggers: an input change on one leg keeps both on the choice. */
    it("keeps both legs on the choice through an ordinary edit of one", async () => {
      await unmatchedPair();
      await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION });

      await world.tripService.update(LEG1, { waitingTimeStart: "10:00", waitingTimeEnd: "11:00" });

      expect(world.storedSnapshot(LEG1)).toMatchObject({ routeSelection: "MANUAL", routePricingId: "half-out" });
      expect(world.storedSnapshot(LEG2)).toMatchObject({ routeSelection: "MANUAL", routePricingId: "half-back" });
    });
  });

  describe("when the choice goes away", () => {
    it("8. an explicit reprocess removes it and lets the automatic matcher decide", async () => {
      const tripId = await unmatchedTrip();
      await choose(tripId, { kind: "NORMAL", routePricingId: OTHER_ROUTE });

      await new PricingReprocessController(world.pairs, world.tripPricing, {} as never).reprocess({ tripId });

      expect(world.routeChoices.has(tripId)).toBe(false);
      // Still nothing usable — and the old choice does not come back.
      expect(world.storedSnapshot(tripId)).toMatchObject({ routeSelection: "AUTOMATIC", routeMatch: "NOT_FOUND", routePricingId: null });
    });

    it("8. an explicit reprocess of one leg removes the pair's choice", async () => {
      await unmatchedPair();
      await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION });

      await new PricingReprocessController(world.pairs, world.tripPricing, {} as never).reprocess({ tripId: LEG2 });

      expect(world.routeChoices.size).toBe(0);
      expect(world.storedSnapshot(LEG1)).toMatchObject({ routeSelection: "AUTOMATIC" });
      expect(world.storedSnapshot(LEG2)).toMatchObject({ routeSelection: "AUTOMATIC" });
    });

    it("keeps it through an ordinary edit", async () => {
      const tripId = await unmatchedTrip();
      await choose(tripId, { kind: "NORMAL", routePricingId: OTHER_ROUTE });

      await world.tripService.update(tripId, { waitingTimeStart: "10:00", waitingTimeEnd: "11:00" });

      expect(world.routeChoices.get(tripId)).toBe(OTHER_ROUTE);
      expect(world.storedSnapshot(tripId)).toMatchObject({ routeSelection: "MANUAL", routePricingId: OTHER_ROUTE });
    });

    it("removes it when the road changes", async () => {
      const tripId = await unmatchedTrip();
      await choose(tripId, { kind: "NORMAL", routePricingId: OTHER_ROUTE });

      await world.tripService.update(tripId, { destinationCity: "Namur" });

      expect(world.routeChoices.has(tripId)).toBe(false);
      expect(world.storedSnapshot(tripId)).toMatchObject({ routeSelection: "AUTOMATIC", routeMatch: "NOT_FOUND" });
    });

    it("removes the pair's choice when one leg is reopened", async () => {
      await unmatchedPair();
      await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION });

      await actions.reopen(LEG1);

      expect(world.routeChoices.size).toBe(0);
    });

    it("removes it when the Trip leaves its group", async () => {
      await unmatchedPair();
      await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION });

      await world.tripService.removeFromGroup(LEG2);

      expect(world.routeChoices.size).toBe(0);
    });
  });

  /** 11. Repeated choices: the latest replaces the pair as a whole, never half of it. */
  it("11. replaces a choice as a whole when another is made", async () => {
    await unmatchedPair();
    await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION });

    await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: UNMATCHED_COMBINATION, legPosition: 1 });

    expect(world.routeChoices.get(LEG1)).toBe("lille-out");
    expect(world.routeChoices.get(LEG2)).toBe("lille-back");
    expect(world.storedSnapshot(LEG1)).toMatchObject({ combinationRouteGroupId: UNMATCHED_COMBINATION });
    expect(world.storedSnapshot(LEG2)).toMatchObject({ combinationRouteGroupId: UNMATCHED_COMBINATION });
  });

  it("uses the same day for both legs without Over ST, by the existing rule", async () => {
    actions.seedLegs(DAY_ONE);
    await actions.close(LEG1);
    await actions.close(LEG2);

    await choose(LEG1, { kind: "COMBINATION", combinationRouteGroupId: HALF_MATCHING_COMBINATION });

    expect(actions.surcharges(LEG2)).toEqual([]);
    expect(await actions.apiPricing(LEG2)).toMatchObject({ tarief: "99.00" });
  });
});
