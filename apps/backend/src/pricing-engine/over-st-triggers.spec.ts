import { TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { BulkPricingReprocessService } from "../pricing-reprocess/bulk-pricing-reprocess.service";
import {
  CONFIGURED_ROUTE_ID,
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import {
  DAY_ONE,
  DAY_TWO,
  GROUP,
  LEG1,
  LEG1_ROW,
  LEG2,
  WITH_OVER_ST,
  routeMatchActions,
} from "./route-match-lifecycle.fixtures";

/**
 * Over ST and its €70 through EVERY trigger (owner's audit, 14 October 2026).
 *
 * The Combination of the fixtures: Leg 1 Quay → Ghlin, Leg 2 Mons → Quay, Over
 * ST configured; Leg 2 on another day owes Tarief 120 + 40 + 70 = 230. Each test
 * reaches that price — or loses it — through a different trigger, and asserts
 * the stored snapshot and the API agree. Real Engine, triggers and store.
 */
describe("Over ST and the €70 through every trigger", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  async function expectOverSt(tripId: string, owed: boolean): Promise<void> {
    expect(actions.surcharges(tripId)).toHaveLength(owed ? 1 : 0);
    if (owed) {
      expect(await actions.apiPricing(tripId)).toMatchObject(WITH_OVER_ST);
    }
    await actions.expectConsistent(tripId);
  }

  const bulk = () =>
    new BulkPricingReprocessService(world.pairs, world.tripPricing, {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService);

  it("10. a manual group of two from different documents owes it, by its pair", async () => {
    actions.configureCombination();
    world.seed(
      buildTrip(LEG1, {
        tripGroupId: GROUP,
        pdfDocumentId: "pdf-a",
        direction: TripDirection.DELIVERY,
        planningDate: new Date(`${DAY_ONE}T00:00:00Z`),
      }),
    );
    world.seed(
      buildTrip(LEG2, {
        tripGroupId: GROUP,
        pdfDocumentId: "pdf-b",
        direction: TripDirection.COLLECTION,
        destinationCity: "Mons",
        planningDate: new Date(`${DAY_TWO}T00:00:00Z`),
      }),
    );

    await actions.close(LEG2);

    await expectOverSt(LEG2, true);
  });

  it("is owed once the third member leaves a group of three, and gone again when Leg 1 leaves", async () => {
    actions.configureCombination();
    actions.seedLegs(DAY_TWO, null);
    world.seed(buildTrip("third", { direction: TripDirection.COLLECTION }));
    await actions.close(LEG2);
    await world.tripService.createGroup([LEG1, LEG2, "third"]);
    // Three documents, no same-document pair: no pricing partner.
    world.trips.set(LEG1, { ...world.trips.get(LEG1)!, pdfDocumentId: "pdf-a" });
    world.trips.set(LEG2, { ...world.trips.get(LEG2)!, pdfDocumentId: "pdf-b" });
    await bulk().reprocessMany([LEG2]);
    await expectOverSt(LEG2, false);

    await world.tripService.removeFromGroup("third");
    await expectOverSt(LEG2, true);

    await world.tripService.removeFromGroup(LEG1);
    await expectOverSt(LEG2, false);
  });

  it("8. survives reopening and closing again, once", async () => {
    await actions.closedCombination();

    await actions.reopen(LEG2);
    await actions.close(LEG2);

    await expectOverSt(LEG2, true);
  });

  it("8. survives a bulk reprice, repeated, without stacking", async () => {
    await actions.closedCombination();

    await bulk().reprocessMany([LEG1, LEG2]);
    await bulk().reprocessMany([LEG2]);

    await expectOverSt(LEG2, true);
    await expectOverSt(LEG1, false);
  });

  it("survives a Custom Value and a Cost Confirmation on Leg 2", async () => {
    await actions.closedCombination();

    await world.customValues.assign({ tripId: LEG2, customPropertyId: PROPERTIES.genset.id });
    await world.confirmCost(LEG2, "4132482", "25.00");

    expect(actions.surcharges(LEG2)).toHaveLength(1);
    expect(await actions.apiPricing(LEG2)).toMatchObject({ tarief: "230.00" });
    await actions.expectConsistent(LEG2);
  });

  it("2/3. follows a date change of either leg on the CLOSED Leg 2", async () => {
    await actions.closedCombination();

    await actions.moveTo(LEG1, DAY_TWO);
    await expectOverSt(LEG2, false);

    await actions.moveTo(LEG1, DAY_ONE);
    await expectOverSt(LEG2, true);

    await actions.moveTo(LEG2, DAY_ONE);
    await expectOverSt(LEG2, false);
  });

  it("is gone from Leg 2 when Leg 1 is cancelled: no partner left", async () => {
    await actions.closedCombination();

    await actions.reopen(LEG1);
    await world.tripService.changeStatus(LEG1, { status: TripStatus.CANCELLED });
    await expectOverSt(LEG2, false);
    expect(world.storedSnapshot(LEG2)?.combinationMatch).toBe("NO_PAIR");
  });
});

describe("normal routes and Combination legs stay apart", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  it("12. an ungrouped Trip never prices on a Combination leg, even the only one on its road", async () => {
    world.ordinaryRoutes.splice(0, world.ordinaryRoutes.length);
    actions.configureCombination();
    actions.seedLegs(DAY_TWO, null);

    await actions.close(LEG1);

    expect(world.storedSnapshot(LEG1)).toMatchObject({ routePricingId: null, routeMatch: "NOT_FOUND" });
    expect(await actions.apiPricing(LEG1)).toMatchObject({ tarief: "0.00" });
  });

  it("11/13/15. one road as an ordinary route and a leg: each context reads its own", async () => {
    actions.configureCombination();
    actions.seedLegs(DAY_TWO, null);
    await actions.close(LEG1);
    expect(world.storedSnapshot(LEG1)?.routePricingId).toBe(CONFIGURED_ROUTE_ID);

    await world.tripService.createGroup([LEG1, LEG2]);

    expect(world.storedSnapshot(LEG1)?.routePricingId).toBe(LEG1_ROW);
    expect(await actions.apiPricing(LEG1)).toMatchObject({ tarief: "150.00" });
  });
});
