import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { MissingPricingSettingException } from "../pricing-engine/exceptions/pricing-engine.exceptions";
import {
  CONFIGURED_TERMINAL,
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "../pricing-engine/pricing-lifecycle.harness";
import { PricingEngineService } from "../pricing-engine/pricing-engine.service";
import {
  COMBINATION_ID,
  LEG1,
  LEG2,
  WITH_OVER_ST,
  WITHOUT_OVER_ST,
  routeMatchActions,
} from "../pricing-engine/route-match-lifecycle.fixtures";
import { BulkPricingReprocessService } from "./bulk-pricing-reprocess.service";

/**
 * "Prijs herberekenen" for a selection — through the real Engine, matcher and
 * snapshot store (tables in memory).
 *
 * Every CLOSED Trip selected is matched again and priced in full; every other
 * one is skipped and reported; one that cannot be priced fails on its own.
 * Nothing but the price is written: the Trip, its group, its Custom Values and
 * its Cost Confirmations are compared before and after.
 */

const UNKNOWN = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const silentLogger = () =>
  ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as AppLoggerService;

describe("reprocessing a selection of Trips", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  /** The bulk reprocess over the given Engine — the real one unless a test wraps it. */
  function bulk(engine: PricingEngineService = world.engine) {
    return new BulkPricingReprocessService(engine, world.tripPricing, silentLogger());
  }

  async function closed(id: string, destinationCity = "Ghlin"): Promise<string> {
    world.seed(buildTrip(id, { destinationCity }));
    await actions.close(id);

    return id;
  }

  /** Everything an operator entered or the import wrote: none of it may move. */
  async function tripData(id: string) {
    return {
      trip: { ...world.trips.get(id)! },
      customValues: (await world.customValues.findByTripId(id)).items.map(
        (assignment) => assignment.customPropertyId,
      ),
      costConfirmations: world.costConfirmations
        .filter((row) => row.tripId === id)
        .map((row) => ({ ...row })),
    };
  }

  describe("status and selection", () => {
    it("1/7. reprocesses one CLOSED Trip: NOT_FOUND becomes the new reliable match", async () => {
      const id = await closed("trip", "Charleroi");
      expect((await actions.apiPricing(id))?.routeMatch?.method).toBe("NOT_FOUND");
      world.ordinaryRoutes.push({
        id: "route-charleroi",
        departure: CONFIGURED_TERMINAL,
        destination: "Charleroi",
        basePrice: "180.00",
      });

      const result = await bulk().reprocessMany([id]);

      expect(result).toMatchObject({ reprocessedCount: 1, skippedCount: 0, failedCount: 0 });
      expect(result.results[0]).toMatchObject({
        tripId: id,
        outcome: "REPROCESSED",
        reasonCode: null,
        snapshot: { routeMatch: { method: "EXACT", routePricingId: "route-charleroi" } },
      });
      // Every component from the new match, not just the route id.
      expect(await actions.apiPricing(id)).toMatchObject({ tarief: "180.00", brandstof: "27.00" });
    });

    it("2. reprocesses every CLOSED Trip selected", async () => {
      await closed("a");
      await closed("b");
      world.ordinaryRoutes[0].basePrice = "300.00";

      const result = await bulk().reprocessMany(["a", "b"]);

      expect(result.reprocessedCount).toBe(2);
      expect(await actions.apiPricing("a")).toMatchObject({ tarief: "300.00" });
      expect(await actions.apiPricing("b")).toMatchObject({ tarief: "300.00" });
    });

    it("3/4/5. a mixed selection: only CLOSED Trips, every other one skipped and named", async () => {
      await closed("closed");
      world.seed(buildTrip("open"));
      world.seed(buildTrip("cancelled", { status: TripStatus.CANCELLED }));
      await closed("deleted");
      await world.tripService.softDelete("deleted");
      const deletedSnapshot = world.storedSnapshot("deleted");

      const result = await bulk().reprocessMany(["closed", "open", "cancelled", "deleted", UNKNOWN]);

      expect(result).toMatchObject({ reprocessedCount: 1, skippedCount: 4, failedCount: 0 });
      expect(result.results.map((each) => [each.tripId, each.outcome, each.reasonCode])).toEqual([
        ["closed", "REPROCESSED", null],
        ["open", "SKIPPED", "NOT_CLOSED"],
        ["cancelled", "SKIPPED", "NOT_CLOSED"],
        ["deleted", "SKIPPED", "NOT_CLOSED"],
        [UNKNOWN, "SKIPPED", "NOT_FOUND"],
      ]);
      // Skipped means untouched: no price for the OPEN Trip, the history unchanged.
      expect(world.storedSnapshot("open")).toBeNull();
      expect(world.storedSnapshot("deleted")).toEqual(deletedSnapshot);
      expect(result.results.slice(1).every((each) => each.snapshot === null)).toBe(true);
    });

    it("6. a Trip reopened between the write and the read-back is skipped, never shown as priced", async () => {
      await closed("trip");
      const reopenedMidway = {
        reprocess: async (id: string) => {
          const answer = await world.engine.reprocess(id);
          await actions.reopen(id);
          return answer;
        },
      } as unknown as PricingEngineService;

      const result = await bulk(reopenedMidway).reprocessMany(["trip"]);

      expect(result.results[0]).toMatchObject({
        outcome: "SKIPPED",
        reasonCode: "NOT_CLOSED",
        snapshot: null,
      });
      expect(await actions.apiPricing("trip")).toBeNull();
    });
  });

  describe("route matching and prices", () => {
    it("8. a match that is no longer valid is not kept", async () => {
      await closed("trip");
      world.ordinaryRoutes.splice(0, 1);

      await bulk().reprocessMany(["trip"]);

      expect((await actions.apiPricing("trip"))?.routeMatch).toMatchObject({
        method: "NOT_FOUND",
        routePricingId: null,
        legs: [],
      });
    });

    it("9. a normalised and a trusted-typo match follow the central matcher", async () => {
      await closed("shouting", "GHLIN");
      world.ordinaryRoutes.push({
        id: "route-charleroi",
        departure: CONFIGURED_TERMINAL,
        destination: "Charleroi",
        basePrice: "180.00",
      });
      await closed("typo", "Charelroi");

      await bulk().reprocessMany(["shouting", "typo"]);

      expect((await actions.apiPricing("shouting"))?.routeMatch?.method).toBe("NORMALIZED");
      expect((await actions.apiPricing("typo"))?.routeMatch).toMatchObject({
        method: "FUZZY",
        routePricingId: "route-charleroi",
      });
    });

    it("10. an ambiguous match is never chosen", async () => {
      await closed("trip", "GHLIN");
      world.ordinaryRoutes.splice(0, 1, {
        id: "route-a",
        departure: CONFIGURED_TERMINAL,
        destination: "ghlin",
        basePrice: "200.00",
      }, {
        id: "route-b",
        departure: CONFIGURED_TERMINAL,
        destination: "Ghlin.",
        basePrice: "210.00",
      });

      await bulk().reprocessMany(["trip"]);

      expect(await actions.apiPricing("trip")).toMatchObject({
        tarief: "0.00",
        routeMatch: { method: "AMBIGUOUS", routePricingId: null },
      });
    });

    it("11/12. a route at € 0 stays matched, distinct from NOT_FOUND, and all of it agrees", async () => {
      await closed("trip", "Gosselies");
      world.ordinaryRoutes.push({
        id: "route-zero",
        departure: CONFIGURED_TERMINAL,
        destination: "Gosselies",
        basePrice: "0.00",
      });

      const [result] = (await bulk().reprocessMany(["trip"])).results;

      expect(result.snapshot?.routeMatch).toMatchObject({ method: "EXACT", routePricingId: "route-zero" });
      // The response, both APIs and the stored rows are one calculation.
      expect(result.snapshot).toEqual(await world.snapshotResponse("trip"));
      expect(world.storedSnapshot("trip")?.routePricingId).toBe("route-zero");
      await actions.expectConsistent("trip");
    });
  });

  describe("groups and price components", () => {
    it("13/14/15/16. re-evaluates the pair, stores both legs, applies or removes Over ST and the €70", async () => {
      await actions.closedCombination();
      world.combinations[0].overSt = { tarief: null, toll: null, tunnel: null };

      await bulk().reprocessMany([LEG1, LEG2]);

      expect(await actions.apiPricing(LEG2)).toMatchObject(WITHOUT_OVER_ST);
      expect(actions.surcharges(LEG2)).toEqual([]);

      world.combinations[0].overSt = { tarief: "40.00", toll: "10.00", tunnel: null };
      await bulk().reprocessMany([LEG2]);
      await bulk().reprocessMany([LEG2]);

      expect(await actions.apiPricing(LEG2)).toMatchObject(WITH_OVER_ST);
      expect(actions.surcharges(LEG2)).toHaveLength(1);
      expect(world.storedSnapshot(LEG2)).toMatchObject({
        combinationRouteGroupId: COMBINATION_ID,
        combinationMatch: "MATCHED",
        routeLegs: [{ legPosition: 1 }, { legPosition: 2, isPricedLeg: true }],
      });
      // Backload on both legs, per the group rule.
      expect((await actions.apiPricing(LEG1))?.backload).toBe("50.00");
    });

    it("17/18. waiting time, Cost Confirmations and Custom Values price as before", async () => {
      await closed("trip");
      await world.tripService.update("trip", { waitingTimeStart: "10:00", waitingTimeEnd: "13:00" });
      await world.confirmCost("trip", "4132482", "25.00");
      await world.customValues.assign({ tripId: "trip", customPropertyId: PROPERTIES.genset.id });
      const before = await actions.apiPricing("trip");

      await bulk().reprocessMany(["trip"]);

      const after = await actions.apiPricing("trip");
      expect(after).toMatchObject({ ek: "55.00", others: "35.00" });
      expect(after?.totaal).toBe(before?.totaal);
    });
  });

  describe("protecting every Trip's own data", () => {
    it("19-23. changes no Trip field, Custom Value, Cost Confirmation or group link", async () => {
      await actions.closedCombination();
      await world.tripService.update(LEG2, {
        waitingTimeStart: "22:00",
        waitingTimeEnd: "01:30",
        waitingTimeEndsNextDay: true,
      });
      await world.confirmCost(LEG2, "4132482", "25.00");
      await world.customValues.assign({ tripId: LEG2, customPropertyId: PROPERTIES.genset.id });
      const before = await tripData(LEG2);
      const partnerBefore = await tripData(LEG1);

      await bulk().reprocessMany([LEG2]);

      expect(await tripData(LEG2)).toEqual(before);
      // The partner is read for the pair, never written.
      expect(await tripData(LEG1)).toEqual(partnerBefore);
      expect(before.trip).toMatchObject({ waitingTimeEndsNextDay: true, tripGroupId: expect.any(String) });
      // Not a comparison of nothing: the data is there, before and after.
      expect(before.customValues).toContain(PROPERTIES.genset.id);
      expect(before.costConfirmations).toHaveLength(1);
    });

    it("24. a failing Trip changes nothing and every other Trip's result stands", async () => {
      await closed("good");
      await closed("bad");
      await closed("broken");
      const badBefore = world.storedSnapshot("bad");
      const dataBefore = await tripData("bad");
      const failing = {
        reprocess: (id: string) => {
          if (id === "bad") {
            return Promise.reject(new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"));
          }
          if (id === "broken") {
            return Promise.reject(new Error("database unavailable"));
          }
          return world.engine.reprocess(id);
        },
      } as unknown as PricingEngineService;

      const result = await bulk(failing).reprocessMany(["good", "bad", "broken"]);

      expect(result).toMatchObject({ reprocessedCount: 1, skippedCount: 0, failedCount: 2 });
      expect(result.results[1]).toMatchObject({
        outcome: "FAILED",
        reasonCode: "PRICING_MISSING_SETTING",
        snapshot: null,
      });
      // An unexpected error is reported without leaking its raw message.
      expect(result.results[2]).toMatchObject({
        outcome: "FAILED",
        reasonCode: "UNEXPECTED_ERROR",
        message: null,
      });
      expect(world.storedSnapshot("bad")).toEqual(badBefore);
      expect(await tripData("bad")).toEqual(dataBefore);
    });
  });
});
