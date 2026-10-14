import { TripDirection } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { BulkPricingReprocessService } from "../pricing-reprocess/bulk-pricing-reprocess.service";
import { buildPricingLifecycle, buildTrip, type PricingLifecycle } from "./pricing-lifecycle.harness";
import { routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * The owner's COMBINATION #213 (15 October 2026), with synthetic Trips shaped
 * like the real ones:
 *   Leg 1  Quay 869 → ROESELARE (RUMBEKE)
 *   Leg 2  IEPER → Quay 869
 *   Rit 1  Quay 869, Rumbeke, 14/10        Rit 2  PSA Quay 869, Ieper, 15/10
 *
 * Through the real Engine and snapshot store. The code fix and refreshing a
 * stored snapshot are TWO steps: a snapshot stored before stays what it was
 * until the Trip is priced again — here by an explicit reprocess.
 */
describe("COMBINATION #213: a place in brackets", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  const GROUP = "group-213";

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
    world.seed(
      buildTrip("rit-1", {
        tripGroupId: GROUP,
        pdfDocumentId: "pdf-213",
        direction: TripDirection.DELIVERY,
        terminal: "Quay 869",
        destinationCity: "Rumbeke",
        planningDate: new Date("2026-10-14T00:00:00Z"),
      }),
    );
    world.seed(
      buildTrip("rit-2", {
        tripGroupId: GROUP,
        pdfDocumentId: "pdf-213",
        direction: TripDirection.COLLECTION,
        terminal: "PSA Quay 869",
        destinationCity: "Ieper",
        planningDate: new Date("2026-10-15T00:00:00Z"),
      }),
    );
  });

  function configure213(): void {
    world.combinations.push({
      id: "combination-213",
      legs: [
        { id: "leg-213-1", departure: "Quay 869", destination: "ROESELARE (RUMBEKE)", basePrice: "160.00", combinationLegPosition: 1 },
        { id: "leg-213-2", departure: "IEPER", destination: "Quay 869", basePrice: "140.00", combinationLegPosition: 2 },
      ],
      overSt: { tarief: "40.00", toll: null, tunnel: null },
    });
  }

  it("prices both Trips on their own leg of #213, the €70 on Leg 2", async () => {
    configure213();

    await actions.close("rit-1");
    await actions.close("rit-2");

    expect(world.storedSnapshot("rit-1")).toMatchObject({
      routePricingId: "leg-213-1",
      routeMatch: "NORMALIZED",
      combinationMatch: "MATCHED",
      combinationRouteGroupId: "combination-213",
    });
    expect(world.storedSnapshot("rit-2")).toMatchObject({
      routePricingId: "leg-213-2",
      combinationMatch: "MATCHED",
    });
    expect(await actions.apiPricing("rit-1")).toMatchObject({ tarief: "160.00" });
    // Leg 2, another day: 140 + Over ST 40 + 70.
    expect(await actions.apiPricing("rit-2")).toMatchObject({ tarief: "250.00" });
    await actions.expectConsistent("rit-2");
  });

  it("leaves a snapshot stored before untouched until it is explicitly reprocessed", async () => {
    // Stored while #213 was not recognised: no Combination, no route.
    await actions.close("rit-1");
    await actions.close("rit-2");
    expect(world.storedSnapshot("rit-1")).toMatchObject({ routePricingId: null, routeMatch: "NOT_FOUND" });

    configure213();
    expect(world.storedSnapshot("rit-1")).toMatchObject({ routeMatch: "NOT_FOUND" });

    await new BulkPricingReprocessService(world.engine, world.tripPricing, {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService).reprocessMany(["rit-1", "rit-2"]);

    expect(world.storedSnapshot("rit-1")).toMatchObject({ routePricingId: "leg-213-1", combinationMatch: "MATCHED" });
    expect(world.storedSnapshot("rit-2")).toMatchObject({ routePricingId: "leg-213-2", combinationMatch: "MATCHED" });
  });

  it("is no Combination when Rumbeke's leg is configured for another bracket", async () => {
    configure213();
    world.combinations[0].legs[0].destination = "ROESELARE (OEKENE)";

    await actions.close("rit-1");

    expect(world.storedSnapshot("rit-1")).toMatchObject({
      routePricingId: null,
      combinationMatch: "LEG_NOT_IDENTIFIED",
    });
  });
});
