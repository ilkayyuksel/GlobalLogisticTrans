import { TripDirection } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { BulkPricingReprocessService } from "../pricing-reprocess/bulk-pricing-reprocess.service";
import {
  CONFIGURED_TERMINAL,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import { COMBINATION_ID, DAY_ONE, routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * City-name matching through the real Engine and snapshot store: the stored
 * method, route id and price agree, and both APIs say the same.
 */
describe("city names in pricing", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  function configure(id: string, city: string, basePrice: string): void {
    world.ordinaryRoutes.push({ id, departure: CONFIGURED_TERMINAL, destination: city, basePrice });
  }

  async function priced(tripId: string) {
    const pricing = await actions.apiPricing(tripId);

    expect((await world.snapshotResponse(tripId))?.routeMatch).toEqual(pricing?.routeMatch);

    return { pricing, stored: world.storedSnapshot(tripId) };
  }

  it("21/22. NOT_FOUND becomes a reliable match after an explicit reprocess, all of it in agreement", async () => {
    world.seed(buildTrip("trip", { destinationCity: "Melsele" }));
    await actions.close("trip");
    expect((await priced("trip")).pricing?.routeMatch?.method).toBe("NOT_FOUND");

    configure("route-melsele", "Melsele (Beveren)", "175.00");
    const bulk = new BulkPricingReprocessService(world.engine, world.tripPricing, {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService);
    await bulk.reprocessMany(["trip"]);

    const { pricing, stored } = await priced("trip");
    expect(stored).toMatchObject({ routePricingId: "route-melsele", routeMatch: "NORMALIZED" });
    expect(pricing).toMatchObject({
      tarief: "175.00",
      routeMatch: { method: "NORMALIZED", legs: [{ destination: "Melsele (Beveren)" }] },
    });
  });

  it("prices Antwerp on the Antwerpen route, and a typo by the calibrated score", async () => {
    configure("route-antwerpen", "ANTWERPEN", "90.00");
    configure("route-lokeren", "LOKEREN", "160.00");
    world.seed(buildTrip("alias", { destinationCity: "Antwerp" }));
    world.seed(buildTrip("typo", { destinationCity: "Lokren" }));
    await actions.close("alias");
    await actions.close("typo");

    expect((await priced("alias")).pricing).toMatchObject({
      tarief: "90.00",
      routeMatch: { method: "NORMALIZED", routePricingId: "route-antwerpen" },
    });
    expect((await priced("typo")).pricing).toMatchObject({
      tarief: "160.00",
      routeMatch: { method: "FUZZY", routePricingId: "route-lokeren" },
    });
  });

  it("prices nothing on an ambiguous qualifier, and says so", async () => {
    configure("route-mb", "Melsele (Beveren)", "175.00");
    configure("route-mx", "Melsele (X)", "185.00");
    world.seed(buildTrip("trip", { destinationCity: "Melsele" }));
    await actions.close("trip");

    expect((await priced("trip")).pricing).toMatchObject({
      tarief: "0.00",
      routeMatch: { method: "AMBIGUOUS", routePricingId: null },
    });
  });

  it("matches both legs of a Combination through city equivalents", async () => {
    world.combinations.push({
      id: COMBINATION_ID,
      legs: [
        { id: "leg-1", departure: CONFIGURED_TERMINAL, destination: "ANTWERPEN", basePrice: "100.00", combinationLegPosition: 1 },
        { id: "leg-2", departure: "Kallo (Beveren)", destination: CONFIGURED_TERMINAL, basePrice: "90.00", combinationLegPosition: 2 },
      ],
      overSt: { tarief: null, toll: null, tunnel: null },
    });
    const dated = { planningDate: new Date(`${DAY_ONE}T00:00:00Z`) };
    world.seed(buildTrip("out", { ...dated, destinationCity: "Antwerp", direction: TripDirection.DELIVERY, pdfDocumentId: "pdf-a" }));
    world.seed(buildTrip("back", { ...dated, destinationCity: "Kallo", direction: TripDirection.COLLECTION, pdfDocumentId: "pdf-b" }));
    await actions.close("out");
    await actions.close("back");

    await world.tripService.createGroup(["out", "back"]);

    expect((await priced("back")).pricing).toMatchObject({
      tarief: "90.00",
      routeMatch: { combinationRouteGroupId: COMBINATION_ID, combinationMatch: "MATCHED" },
    });
  });
});
