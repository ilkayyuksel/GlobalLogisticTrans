import { TripDirection } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { BulkPricingReprocessService } from "../pricing-reprocess/bulk-pricing-reprocess.service";
import {
  CONFIGURED_TERMINAL,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import {
  COMBINATION_ID,
  DAY_ONE,
  DAY_TWO,
  WITH_OVER_ST,
  routeMatchActions,
} from "./route-match-lifecycle.fixtures";

/**
 * Confirmed terminal aliases through every trigger that prices — the real
 * services, Engine and matcher; the stored snapshot and both APIs checked.
 *
 * The configuration is spelled `PSA Quay 869` / `Quay 869` (fixtures); the
 * Trips use the other confirmed spellings: `Kaai`, `KAAI`, `Quay`, `PSA Quay`.
 */
describe("terminal aliases in pricing", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  async function route(tripId: string) {
    const ritten = (await actions.apiPricing(tripId))?.routeMatch ?? null;

    expect((await world.snapshotResponse(tripId))?.routeMatch ?? null).toEqual(ritten);

    return ritten;
  }

  it.each(["Kaai", "KAAI", "Quay", "PSA Quay"])(
    "14. a delivery from %s, NOT_FOUND before, now prices on the configured route",
    async (terminal) => {
      world.seed(buildTrip("trip", { terminal }));
      await actions.close("trip");

      expect(await route("trip")).toMatchObject({
        method: "NORMALIZED",
        routePricingId: "route-1",
        legs: [{ routePricingId: "route-1", departure: CONFIGURED_TERMINAL, destination: "Ghlin" }],
      });
      expect(world.storedSnapshot("trip")).toMatchObject({
        routePricingId: "route-1",
        routeMatch: "NORMALIZED",
      });
      expect(await actions.apiPricing("trip")).toMatchObject({ tarief: "200.00", brandstof: "30.00" });
    },
  );

  it("8. a collection to KAAI matches the configured city → terminal road", async () => {
    world.ordinaryRoutes.push({
      id: "route-mons",
      departure: "Mons",
      destination: CONFIGURED_TERMINAL,
      basePrice: "150.00",
    });
    world.seed(
      buildTrip("trip", { terminal: "KAAI", destinationCity: "Mons", direction: TripDirection.COLLECTION }),
    );
    await actions.close("trip");

    expect((await route("trip"))?.routePricingId).toBe("route-mons");
  });

  it("12. two configurations that are one road through an alias: AMBIGUOUS, priced at zero", async () => {
    world.ordinaryRoutes.push({
      id: "route-kaai",
      departure: "Kaai",
      destination: "Ghlin",
      basePrice: "210.00",
    });
    world.seed(buildTrip("trip", { terminal: "Quay" }));
    await actions.close("trip");

    expect(await route("trip")).toMatchObject({ method: "AMBIGUOUS", routePricingId: null, legs: [] });
    expect(await actions.apiPricing("trip")).toMatchObject({ tarief: "0.00" });
  });

  it("15. a route at € 0 matched through an alias stays distinct from NOT_FOUND", async () => {
    world.ordinaryRoutes[0].basePrice = "0.00";
    world.seed(buildTrip("trip", { terminal: "Kaai" }));
    await actions.close("trip");

    expect(await route("trip")).toMatchObject({ method: "NORMALIZED", routePricingId: "route-1" });
    expect(await actions.apiPricing("trip")).toMatchObject({ tarief: "0.00" });
  });

  describe("the triggers that price", () => {
    it("bulk Prijs herberekenen matches through the alias", async () => {
      world.seed(buildTrip("trip", { terminal: "Kaai" }));
      await actions.close("trip");
      const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const bulk = new BulkPricingReprocessService(
        world.engine,
        world.tripPricing,
        logger as unknown as AppLoggerService,
      );

      const [result] = (await bulk.reprocessMany(["trip"])).results;

      expect(result.snapshot?.routeMatch).toMatchObject({ method: "NORMALIZED", routePricingId: "route-1" });
    });

    it("a terminal edited to an alias reprices on the configured route", async () => {
      world.seed(buildTrip("trip", { terminal: "Quay 170" }));
      await actions.close("trip");
      expect((await route("trip"))?.method).toBe("NOT_FOUND");

      await world.tripService.update("trip", { terminal: "KAAI" });

      expect((await route("trip"))?.routePricingId).toBe("route-1");
    });

    it("13. grouping, dates and Over ST: both legs matched through aliases", async () => {
      actions.configureCombination();
      world.seed(
        buildTrip("out", {
          terminal: "Kaai",
          pdfDocumentId: "pdf-a",
          direction: TripDirection.DELIVERY,
          planningDate: new Date(`${DAY_ONE}T00:00:00Z`),
        }),
      );
      world.seed(
        buildTrip("back", {
          terminal: "PSA Quay",
          destinationCity: "Mons",
          pdfDocumentId: "pdf-b",
          direction: TripDirection.COLLECTION,
          planningDate: new Date(`${DAY_ONE}T00:00:00Z`),
        }),
      );
      await actions.close("out");
      await actions.close("back");

      await world.tripService.createGroup(["out", "back"]);
      expect(await route("back")).toMatchObject({
        combinationRouteGroupId: COMBINATION_ID,
        combinationMatch: "MATCHED",
        legs: [{ legPosition: 1, method: "NORMALIZED" }, { legPosition: 2, method: "NORMALIZED" }],
      });

      // A date change on Leg 2 reprices it on the same aliased pair.
      await actions.moveTo("back", DAY_TWO);
      expect(await actions.apiPricing("back")).toMatchObject(WITH_OVER_ST);
      expect(actions.surcharges("back")).toHaveLength(1);
    });
  });
});
