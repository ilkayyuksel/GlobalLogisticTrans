import { PricingCalculationStatus } from "@prisma/client";

import { MissingPricingSettingException } from "./exceptions/pricing-engine.exceptions";
import {
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import { routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * Priced Custom Properties — TAR, Flat and every other — through the real
 * services, from closing a Trip to what the Ritten list shows.
 *
 * ── THE RULES THESE TESTS HOLD ──────────────────────────────────────────────
 * A property with its own price is one CUSTOM_PROPERTY line of that price, and
 * the lines together are Others — never in the Tarief, never in the Fuel. A
 * property without a price adds nothing; one priced at 0,00 adds a line of
 * 0,00. TAR is charged automatically for a stated TAR-nummer, once per number
 * and day, and a manual TAR is an extra beside it. The stored total is the sum
 * of the stored lines, and the list shows exactly that.
 *
 * The route is the configured ordinary one: Tarief 200, Fuel 15% = 30.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TRIP = "trip";
const DAY = "2026-08-31";

describe("priced Custom Properties through the pricing lifecycle", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  const assign = (tripId: string, property: { id: string }) =>
    world.customValues.assign({ tripId, customPropertyId: property.id });
  const propertyLines = (tripId: string) =>
    (world.storedSnapshot(tripId)?.items ?? []).filter((item) => item.pricingComponent.code === "CUSTOM_PROPERTY");
  const amountsOf = (tripId: string) =>
    propertyLines(tripId).map((item) => [item.description, item.amount.toFixed(2)]);

  async function closedTrip(id = TRIP, fields: Parameters<typeof buildTrip>[1] = {}) {
    world.seed(buildTrip(id, fields));
    await actions.close(id);
  }

  describe("each kind of property, priced the moment the Trip closes", () => {
    it("1. charges TAR for a stated TAR-nummer, in Others", async () => {
      await closedTrip(TRIP, { tarNummer: "TAR-1" });

      expect(amountsOf(TRIP)).toEqual([["TAR", "20.00"]]);
      expect(await actions.apiPricing(TRIP)).toMatchObject({
        tarief: "200.00",
        brandstof: "30.00",
        others: "20.00",
        totaal: "250.00",
      });
    });

    it("2. charges Flat, in Others", async () => {
      world.seed(buildTrip(TRIP));
      world.seedAutomaticFlat(TRIP);
      await actions.close(TRIP);

      expect(amountsOf(TRIP)).toEqual([["Flat", "45.00"]]);
      expect(await actions.apiPricing(TRIP)).toMatchObject({ others: "45.00", totaal: "275.00" });
    });

    /** 3, 6, 7: several at once, each once, Tarief and Fuel untouched, total = lines. */
    it("3/6/7. charges several at once, each exactly once, and the total is the stored lines", async () => {
      world.seed(buildTrip(TRIP, { tarNummer: "TAR-1" }));
      world.seedAutomaticFlat(TRIP);
      await assign(TRIP, PROPERTIES.genset);
      await assign(TRIP, PROPERTIES.douane);
      await actions.close(TRIP);

      expect(amountsOf(TRIP)).toHaveLength(4);
      expect(amountsOf(TRIP)).toEqual(
        expect.arrayContaining([
          ["Flat", "45.00"],
          ["Genset", "35.00"],
          ["Douane", "12.50"],
          ["TAR", "20.00"],
        ]),
      );
      // 45 + 35 + 12.50 + 20 in Others; Fuel stays 15% of the Tarief alone.
      expect(await actions.apiPricing(TRIP)).toMatchObject({
        tarief: "200.00",
        brandstof: "30.00",
        others: "112.50",
        totaal: "342.50",
      });
      await actions.expectConsistent(TRIP);
    });

    it("4. adds nothing for a property without a price", async () => {
      world.seed(buildTrip(TRIP));
      await assign(TRIP, PROPERTIES.unpriced);
      await actions.close(TRIP);

      expect(propertyLines(TRIP)).toEqual([]);
      expect(await actions.apiPricing(TRIP)).toMatchObject({ others: "0.00", totaal: "230.00" });
    });

    it("5. charges a property priced at zero as a line of 0,00, which changes no amount", async () => {
      world.seed(buildTrip(TRIP));
      await assign(TRIP, PROPERTIES.free);
      await actions.close(TRIP);

      expect(amountsOf(TRIP)).toEqual([["Gratis", "0.00"]]);
      expect(await actions.apiPricing(TRIP)).toMatchObject({ others: "0.00", totaal: "230.00" });
      await actions.expectConsistent(TRIP);
    });

    it("charges a manual TAR as an extra beside the automatic one", async () => {
      world.seed(buildTrip(TRIP, { tarNummer: "TAR-1" }));
      await assign(TRIP, PROPERTIES.tar);
      await actions.close(TRIP);

      expect(amountsOf(TRIP)).toEqual([
        ["TAR", "20.00"],
        ["TAR", "20.00"],
      ]);
      expect(await actions.apiPricing(TRIP)).toMatchObject({ others: "40.00" });
    });
  });

  describe("every trigger prices the same", () => {
    it("2. a property assigned to a CLOSED Trip reprices it at once", async () => {
      await closedTrip();

      await assign(TRIP, PROPERTIES.genset);

      expect(await actions.apiPricing(TRIP)).toMatchObject({ others: "35.00", totaal: "265.00" });
    });

    it("3. an explicit reprocess gives exactly what closing gave", async () => {
      world.seed(buildTrip(TRIP, { tarNummer: "TAR-1" }));
      world.seedAutomaticFlat(TRIP);
      await actions.close(TRIP);
      const closing = await actions.apiPricing(TRIP);
      const closingLines = amountsOf(TRIP);

      await world.pairs.reprocessWithPartner(TRIP);
      await world.pairs.reprocessWithPartner(TRIP);

      expect(await actions.apiPricing(TRIP)).toEqual(closing);
      expect(amountsOf(TRIP)).toEqual(closingLines);
    });

    it("reprices after reopening and closing again from the Trip's current properties", async () => {
      world.seed(buildTrip(TRIP));
      await assign(TRIP, PROPERTIES.genset);
      await actions.close(TRIP);
      await actions.reopen(TRIP);
      await assign(TRIP, PROPERTIES.douane);

      await actions.close(TRIP);

      expect(await actions.apiPricing(TRIP)).toMatchObject({ others: "47.50" });
    });
  });

  /*
   * ── A FAILED CALCULATION LEAVES NO OLD PRICE ON SCREEN ────────────────────
   * The Trip is priced from its data as it is now; when that fails, the old
   * snapshot describes the Trip as it was. It is kept as history, marked
   * FAILED, and shown nowhere as the price — until a calculation succeeds.
   */
  describe("4. a calculation that fails", () => {
    const failOnce = () =>
      world.ruleResolver.resolve.mockRejectedValueOnce(
        new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"),
      );

    it("does not show the price from before the Trip was reopened", async () => {
      await closedTrip();
      await actions.reopen(TRIP);
      await assign(TRIP, PROPERTIES.genset);
      failOnce();

      await actions.close(TRIP);

      expect(await actions.apiPricing(TRIP)).toBeNull();
      expect(world.storedSnapshot(TRIP)?.calculationStatus).toBe(PricingCalculationStatus.FAILED);
      expect(await world.effectivePricing.findForTrips([TRIP])).toEqual(new Map());
    });

    it("does not show the old price of a CLOSED Trip whose edit could not be priced", async () => {
      await closedTrip();
      failOnce();

      await assign(TRIP, PROPERTIES.genset);

      expect(await actions.apiPricing(TRIP)).toBeNull();
    });

    it("shows the new price as soon as a calculation succeeds again", async () => {
      await closedTrip();
      failOnce();
      await assign(TRIP, PROPERTIES.genset);

      await world.pairs.reprocessWithPartner(TRIP);

      expect(world.storedSnapshot(TRIP)?.calculationStatus).toBe(PricingCalculationStatus.CALCULATED);
      expect(await actions.apiPricing(TRIP)).toMatchObject({ others: "35.00", totaal: "265.00" });
    });
  });

  /*
   * ── ONE TAR-NUMMER, ONCE A DAY — AND IT MOVES WHEN IT IS LET GO ───────────
   * Two Trips state the same number on the same day: the first priced holds
   * the charge. When it lets it go, the other takes it at once (owner,
   * 20 October 2026).
   */
  describe("a TAR charge shared by one number on one day", () => {
    async function twoTripsStatingTar1() {
      await closedTrip("first", { tarNummer: "TAR-1" });
      await closedTrip("second", { tarNummer: "TAR-1" });
      expect(amountsOf("first")).toEqual([["TAR", "20.00"]]);
      expect(amountsOf("second")).toEqual([]);
    }

    it("moves to the other Trip when the holder's number changes", async () => {
      await twoTripsStatingTar1();

      await world.tripService.update("first", { tarNummer: "TAR-2" });

      expect(amountsOf("second")).toEqual([["TAR", "20.00"]]);
      // TAR-2 is free that day: the first Trip owes its own.
      expect(amountsOf("first")).toEqual([["TAR", "20.00"]]);
    });

    it("moves to the other Trip when the holder's number is removed", async () => {
      await twoTripsStatingTar1();

      await world.tripService.update("first", { tarNummer: null });

      expect(amountsOf("first")).toEqual([]);
      expect(amountsOf("second")).toEqual([["TAR", "20.00"]]);
    });

    it("moves to the other Trip when the holder moves to another day", async () => {
      await twoTripsStatingTar1();

      await actions.moveTo("first", "2026-09-01");

      expect(amountsOf("second")).toEqual([["TAR", "20.00"]]);
      expect(amountsOf("first")).toEqual([["TAR", "20.00"]]);
    });

    it("moves to the other Trip when the holder is cancelled", async () => {
      await twoTripsStatingTar1();
      await actions.reopen("first");

      await world.tripService.changeStatus("first", { status: "CANCELLED" });

      expect(amountsOf("second")).toEqual([["TAR", "20.00"]]);
    });

    it("stays with the holder while it is only reopened", async () => {
      await twoTripsStatingTar1();

      await actions.reopen("first");

      expect(amountsOf("second")).toEqual([]);
    });

    /** A manual TAR is an extra: it never takes the automatic charge from the holder. */
    it("is not taken from the holder by a manual TAR on the other Trip", async () => {
      await twoTripsStatingTar1();

      await assign("second", PROPERTIES.tar);
      await world.pairs.reprocessWithPartner("first");

      expect(amountsOf("first")).toEqual([["TAR", "20.00"]]);
      expect(amountsOf("second")).toEqual([["TAR", "20.00"]]);
      expect(await actions.apiPricing("first")).toMatchObject({ others: "20.00" });
    });

    it("is charged once however often the day is repriced", async () => {
      await twoTripsStatingTar1();

      await world.pairs.reprocessWithPartner("second");
      await world.pairs.reprocessWithPartner("first");
      await world.pairs.reprocessWithPartner("second");

      expect(amountsOf("first")).toEqual([["TAR", "20.00"]]);
      expect(amountsOf("second")).toEqual([]);
    });
  });

  /** Over ST 7: the €70 is a Combination's; an ungrouped Trip never carries it. */
  it("charges an ungrouped Trip no Over ST and no €70, whatever its day", async () => {
    await closedTrip(TRIP, { planningDate: new Date("2026-09-03T00:00:00Z") });

    expect(actions.surcharges(TRIP)).toEqual([]);
    expect(await actions.apiPricing(TRIP)).toMatchObject({ tarief: "200.00", totaal: "230.00" });
  });

  it("charges no TAR without a stated number, whatever else the Trip carries", async () => {
    world.seed(buildTrip(TRIP, { planningDate: new Date(`${DAY}T00:00:00Z`) }));
    await assign(TRIP, PROPERTIES.genset);
    await actions.close(TRIP);

    expect(amountsOf(TRIP)).toEqual([["Genset", "35.00"]]);
  });
});
