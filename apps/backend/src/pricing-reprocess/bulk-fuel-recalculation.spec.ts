import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { MissingPricingSettingException } from "../pricing-engine/exceptions/pricing-engine.exceptions";
import {
  CONFIGURED_TERMINAL,
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "../pricing-engine/pricing-lifecycle.harness";
import { LEG1, LEG2, WITH_OVER_ST, routeMatchActions } from "../pricing-engine/route-match-lifecycle.fixtures";
import { BulkFuelRecalculationService } from "./bulk-fuel-recalculation.service";
import { BulkPricingReprocessService } from "./bulk-pricing-reprocess.service";

/**
 * "Brandstof herberekenen" for a selection — through the real Engine, matcher,
 * snapshot store, effective read and Trip services (tables in memory).
 *
 * Every Trip is first priced in full at 15% (the harness's FUEL_PERCENTAGE)
 * unless a test says otherwise. The configured route prices Tarief 200.00.
 */

const silentLogger = () =>
  ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as AppLoggerService;

const TRIP = "trip-a";
const OTHER = "trip-b";
const UNSELECTED = "trip-c";

describe("Brandstof herberekenen for a selection", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
    world.ordinaryRoutes.push({ id: "route-2", departure: CONFIGURED_TERMINAL, destination: "Mons", basePrice: "300.00" });
  });

  const fuelAction = () => new BulkFuelRecalculationService(world.fuel, world.tripPricing, silentLogger());
  const repriceAction = () => new BulkPricingReprocessService(world.pairs, world.tripPricing, silentLogger());
  const pricing = async (tripId: string) => (await actions.apiPricing(tripId))!;
  const fuelLine = (tripId: string) =>
    world.storedSnapshot(tripId)!.items.find((item) => item.pricingComponent.code === "FUEL_SURCHARGE")!;
  /** Everything stored for the Trip except its fuel line and the total that sums it. */
  const allButFuel = (tripId: string) => {
    const { totalPrice: _total, items, ...header } = world.storedSnapshot(tripId)!;

    return {
      header,
      items: items
        .filter((item) => item.pricingComponent.code !== "FUEL_SURCHARGE")
        .map((item) => ({ ...item, amount: item.amount.toFixed(2) })),
    };
  };

  async function closedTrip(tripId: string, overrides: Parameters<typeof buildTrip>[1] = {}) {
    world.seed(buildTrip(tripId, overrides));
    await actions.close(tripId);
  }

  describe("the bulk action", () => {
    it("1. one selected Trip: its Brandstof at the current percentage", async () => {
      await closedTrip(TRIP);
      world.setFuelPercentage("13");

      const result = await fuelAction().recalculateMany([TRIP]);

      expect(result).toMatchObject({ reprocessedCount: 1, skippedCount: 0, failedCount: 0 });
      expect(result.results[0]).toMatchObject({ tripId: TRIP, outcome: "REPROCESSED", reasonCode: null });
      expect(await pricing(TRIP)).toMatchObject({ tarief: "200.00", brandstof: "26.00", fuelPercentage: "13", totaal: "226.00" });
      await actions.expectConsistent(TRIP);
    });

    it("2. several selected Trips: each on its own Tarief", async () => {
      await closedTrip(TRIP);
      await closedTrip(OTHER, { destinationCity: "Mons" });
      world.setFuelPercentage("13");

      await fuelAction().recalculateMany([TRIP, OTHER]);

      expect(await pricing(TRIP)).toMatchObject({ brandstof: "26.00", fuelPercentage: "13" });
      expect(await pricing(OTHER)).toMatchObject({ tarief: "300.00", brandstof: "39.00", fuelPercentage: "13" });
      await actions.expectConsistent(OTHER);
    });

    it("3. a Trip not selected keeps its fuel and percentage", async () => {
      await closedTrip(TRIP);
      await closedTrip(UNSELECTED);
      const before = world.storedSnapshot(UNSELECTED);
      world.setFuelPercentage("13");

      await fuelAction().recalculateMany([TRIP]);

      expect(world.storedSnapshot(UNSELECTED)).toEqual(before);
      expect(await pricing(UNSELECTED)).toMatchObject({ brandstof: "30.00", fuelPercentage: "15" });
    });

    /*
     * 4, 5, 15: Leg 2 of a Combination on a later day carries every component
     * there is — Over ST and its €70 in the Tarief, Backload, Toll — plus a
     * Custom Value (Others) and a Cost Confirmation (EK).
     */
    it("4/5/15. only Brandstof and its percentage change; every other component and record stays", async () => {
      await actions.closedCombination();
      await world.customValues.assign({ tripId: LEG2, customPropertyId: PROPERTIES.genset.id });
      await world.confirmCost(LEG2, "4132482", "25.00");
      const before = await pricing(LEG2);
      const stored = allButFuel(LEG2);
      const partner = world.storedSnapshot(LEG1);
      world.setFuelPercentage("13");

      await fuelAction().recalculateMany([LEG2]);

      const after = await pricing(LEG2);
      // 13% of the whole Tarief the fuel step sees: 120 + 40 Over ST + 70.
      const { totaal: _withoutOthersAndEk, ...overStComponents } = WITH_OVER_ST;
      expect(before).toMatchObject({ others: "35.00", ek: "25.00", fuelPercentage: "15" });
      expect(after).toMatchObject({ ...overStComponents, brandstof: "29.90", fuelPercentage: "13", totaal: "379.90" });
      expect(after).toEqual({
        ...before,
        brandstof: "29.90",
        fuelPercentage: "13",
        totaal: new Prisma.Decimal(before.totaal).minus("34.50").plus("29.90").toFixed(2),
        components: after.components,
      });
      expect(after.components.filter((component) => component.componentCode !== "FUEL_SURCHARGE")).toEqual(
        before.components.filter((component) => component.componentCode !== "FUEL_SURCHARGE"),
      );
      // The route, the calculation metadata and every other line exactly as stored.
      expect(allButFuel(LEG2)).toEqual(stored);
      // Nothing is matched or priced again, and the partner leg is untouched.
      expect(world.storedSnapshot(LEG1)).toEqual(partner);
      await actions.expectConsistent(LEG2);
    });

    it("6. Tarief 0,00 (a route nobody configured): Brandstof 0,00", async () => {
      await closedTrip(TRIP, { destinationCity: "Nergens" });
      world.setFuelPercentage("13");

      await fuelAction().recalculateMany([TRIP]);

      expect(await pricing(TRIP)).toMatchObject({ tarief: "0.00", brandstof: "0.00", fuelPercentage: "13" });
    });

    it("skips what has no current price, and reports every Trip", async () => {
      await closedTrip(TRIP);
      world.seed(buildTrip(OTHER));

      const result = await fuelAction().recalculateMany([TRIP, OTHER, "unknown-trip"]);

      expect(result.results.map((each) => [each.tripId, each.outcome, each.reasonCode])).toEqual([
        [TRIP, "REPROCESSED", null],
        [OTHER, "SKIPPED", "NOT_CLOSED"],
        ["unknown-trip", "SKIPPED", "NOT_FOUND"],
      ]);
      expect(world.storedSnapshot(OTHER)).toBeNull();
    });

    it("an unusable FUEL_PERCENTAGE fails every Trip and writes nothing", async () => {
      await closedTrip(TRIP);
      const before = world.storedSnapshot(TRIP);
      world.ruleResolver.resolve.mockRejectedValue(new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"));

      const result = await fuelAction().recalculateMany([TRIP]);

      expect(result.results[0]).toMatchObject({ outcome: "FAILED", reasonCode: "PRICING_MISSING_SETTING" });
      expect(world.storedSnapshot(TRIP)).toEqual(before);
    });

    it("a full recalculation that replaced the snapshot meanwhile stands: FAILED, nothing written", async () => {
      await closedTrip(TRIP);
      world.setFuelPercentage("13");
      const store = (world.fuel as unknown as { store: { replaceFuelLine: (command: unknown) => Promise<boolean> } }).store;
      const replace = store.replaceFuelLine.bind(store);
      jest.spyOn(store, "replaceFuelLine").mockImplementationOnce(async (command) => {
        const snapshot = world.snapshots.find((row) => row.tripId === TRIP)!;
        snapshot.calculatedAt = new Date(snapshot.calculatedAt.getTime() + 1000);

        return replace(command);
      });

      const result = await fuelAction().recalculateMany([TRIP]);

      expect(result.results[0]).toMatchObject({ outcome: "FAILED", reasonCode: "SNAPSHOT_CHANGED" });
      expect(await pricing(TRIP)).toMatchObject({ brandstof: "30.00", fuelPercentage: "15" });
    });
  });

  describe("the percentage each Trip keeps", () => {
    it("7. priced at 13%: 13% is stored with its fuel", async () => {
      world.setFuelPercentage("13");
      await closedTrip(TRIP);

      expect(fuelLine(TRIP).unitPrice?.toString()).toBe("13");
      expect(await pricing(TRIP)).toMatchObject({ brandstof: "26.00", fuelPercentage: "13" });
    });

    it("8/9. the setting moving to 15% changes nothing until the fuel is recalculated", async () => {
      world.setFuelPercentage("13");
      await closedTrip(TRIP);

      world.setFuelPercentage("15");
      expect(await pricing(TRIP)).toMatchObject({ brandstof: "26.00", fuelPercentage: "13" });

      await fuelAction().recalculateMany([TRIP]);
      expect(await pricing(TRIP)).toMatchObject({ brandstof: "30.00", fuelPercentage: "15" });
    });

    it("10. a snapshot written before the rate was recorded shows no percentage", async () => {
      await closedTrip(TRIP);
      fuelLine(TRIP).unitPrice = null;

      expect(await pricing(TRIP)).toMatchObject({ brandstof: "30.00", fuelPercentage: null });
    });

    it("10. … and the recalculation records one", async () => {
      await closedTrip(TRIP);
      fuelLine(TRIP).unitPrice = null;

      await fuelAction().recalculateMany([TRIP]);

      expect(await pricing(TRIP)).toMatchObject({ brandstof: "30.00", fuelPercentage: "15" });
    });

    it("11. a full Prijs herberekenen stores the percentage it used", async () => {
      world.setFuelPercentage("13");
      await closedTrip(TRIP);
      world.setFuelPercentage("15");

      const result = await repriceAction().reprocessMany([TRIP]);

      expect(result.results[0]).toMatchObject({ outcome: "REPROCESSED" });
      expect(await pricing(TRIP)).toMatchObject({ brandstof: "30.00", fuelPercentage: "15" });
    });
  });

  describe("the existing pricing, unchanged", () => {
    it("12. Prijs herberekenen still prices the whole Trip again", async () => {
      await closedTrip(TRIP);
      world.ordinaryRoutes[0].basePrice = "250.00";

      const result = await repriceAction().reprocessMany([TRIP]);

      expect(result).toMatchObject({ reprocessedCount: 1, failedCount: 0 });
      expect(await pricing(TRIP)).toMatchObject({ tarief: "250.00", brandstof: "37.50", fuelPercentage: "15" });
    });

    it("13. an automatic trigger still prices in full, at the percentage then current", async () => {
      await closedTrip(TRIP);
      world.setFuelPercentage("20");

      await world.customValues.assign({ tripId: TRIP, customPropertyId: PROPERTIES.genset.id });

      expect(await pricing(TRIP)).toMatchObject({ others: "35.00", brandstof: "40.00", fuelPercentage: "20" });
    });

    it("14. a corrected Tarief keeps its override; fuel follows it at the stored percentage", async () => {
      await closedTrip(TRIP);
      world.overrides.push({ tripId: TRIP, componentCode: "BASE_PRICE", amount: new Prisma.Decimal(300) });
      expect(await pricing(TRIP)).toMatchObject({ tarief: "300.00", brandstof: "45.00", fuelPercentage: "15" });
      world.setFuelPercentage("13");

      await fuelAction().recalculateMany([TRIP]);

      expect(world.overrides).toHaveLength(1);
      expect(await pricing(TRIP)).toMatchObject({ tarief: "300.00", brandstof: "39.00", fuelPercentage: "13" });
      // Stored on the Engine's own Tarief; the effective read applies the correction.
      expect(fuelLine(TRIP).amount.toFixed(2)).toBe("26.00");
    });

    it("16. running it again adds nothing", async () => {
      await closedTrip(TRIP);
      world.setFuelPercentage("13");

      await fuelAction().recalculateMany([TRIP]);
      const once = world.storedSnapshot(TRIP);
      await fuelAction().recalculateMany([TRIP]);
      await fuelAction().recalculateMany([TRIP]);

      expect(world.storedSnapshot(TRIP)).toEqual(once);
      expect(await pricing(TRIP)).toMatchObject({ brandstof: "26.00", totaal: "226.00" });
    });

    it("a CLOSED Trip reopened is not touched", async () => {
      await closedTrip(TRIP);
      await world.tripService.changeStatus(TRIP, { status: TripStatus.OPEN });
      const before = world.storedSnapshot(TRIP);

      const result = await fuelAction().recalculateMany([TRIP]);

      expect(result.results[0]).toMatchObject({ outcome: "SKIPPED", reasonCode: "NOT_CLOSED" });
      expect(world.storedSnapshot(TRIP)).toEqual(before);
    });
  });
});
