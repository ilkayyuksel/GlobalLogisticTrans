import { Prisma, TripStatus } from "@prisma/client";

import {
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";

/**
 * A Trip's price from closing onwards, through every action that can move it.
 *
 * ── WHAT EVERY TEST CHECKS ──────────────────────────────────────────────────
 * Three layers for the same Trip: the stored snapshot (header and items), the
 * effective breakdown the API answers with, and — where an action answers with
 * pricing itself — that response. A figure right in one layer and wrong in
 * another is exactly the failure being guarded against.
 *
 * ── THE NUMBERS ─────────────────────────────────────────────────────────────
 *   Tarief     200.00  the one configured road
 *   Brandstof   30.00  15 % of the Tarief
 *   Backload    50.00  any group
 *   Waiting    180 min → 60 billable → 4 blocks × 13.75 = 55.00
 *              135 min → below the 150-minute threshold → no charge
 *   Genset      35.00, Douane 12.50 (Custom Values → Others)
 * ────────────────────────────────────────────────────────────────────────────
 */

const TRIP = "trip-1";
const PARTNER = "trip-2";

/** 10:00 → 13:00: charged. */
const CHARGED_WINDOW = { waitingTimeStart: "10:00", waitingTimeEnd: "13:00" };
/** 10:00 → 12:15: below the threshold, so priced at €0. */
const UNCHARGED_WINDOW = { waitingTimeStart: "10:00", waitingTimeEnd: "12:15" };
const REMOVE_WINDOW = { waitingTimeStart: null, waitingTimeEnd: null };

describe("the pricing lifecycle of a Trip", () => {
  let world: PricingLifecycle;

  beforeEach(() => {
    world = buildPricingLifecycle();
  });

  async function close(tripId: string) {
    return world.tripService.changeStatus(tripId, { status: TripStatus.CLOSED });
  }

  async function closedTrip(tripId = TRIP) {
    world.seed(buildTrip(tripId));
    await close(tripId);
  }

  /** The API's breakdown for the Trip, read back from what is stored. */
  async function apiPricing(tripId = TRIP) {
    return (await world.readTrip(tripId)).pricing;
  }

  /** The stored items by component code, summed, as fixed-2 text. */
  function storedComponents(tripId = TRIP): Record<string, string> {
    const snapshot = world.storedSnapshot(tripId);
    const sums: Record<string, Prisma.Decimal> = {};

    for (const item of snapshot?.items ?? []) {
      const code = item.pricingComponent.code;
      sums[code] = (sums[code] ?? new Prisma.Decimal(0)).plus(item.amount);
    }

    return Object.fromEntries(
      Object.entries(sums).map(([code, sum]) => [code, sum.toFixed(2)]),
    );
  }

  /**
   * ── THE INVARIANTS, CHECKED AFTER EVERY ACTION THAT PRICES ───────────────
   * The stored total equals its items; the API's Totaal equals its seven
   * columns; with no override both totals agree; Brandstof is 15 % of Tarief.
   */
  async function expectConsistent(tripId = TRIP): Promise<void> {
    const snapshot = world.storedSnapshot(tripId);
    const pricing = await apiPricing(tripId);

    expect(snapshot).not.toBeNull();
    expect(pricing).not.toBeNull();

    const itemSum = snapshot!.items.reduce(
      (sum, item) => sum.plus(item.amount),
      new Prisma.Decimal(0),
    );
    expect(snapshot!.totalPrice.toFixed(2)).toBe(itemSum.toFixed(2));

    const columns = [
      pricing!.tarief,
      pricing!.brandstof,
      pricing!.backload,
      pricing!.tol,
      pricing!.tunnel,
      pricing!.others,
      pricing!.ek,
    ].reduce((sum, amount) => sum.plus(amount), new Prisma.Decimal(0));
    expect(pricing!.totaal).toBe(columns.toFixed(2));
    expect(pricing!.totaal).toBe(snapshot!.totalPrice.toFixed(2));
    expect(pricing!.brandstof).toBe(
      new Prisma.Decimal(pricing!.tarief).times("0.15").toFixed(2),
    );
  }

  describe("closing", () => {
    it("1. stores a complete snapshot and answers with it", async () => {
      world.seed(buildTrip(TRIP));

      const response = await close(TRIP);

      expect(storedComponents()).toEqual({
        BASE_PRICE: "200.00",
        FUEL_SURCHARGE: "30.00",
      });
      expect(response.pricing).toMatchObject({
        tarief: "200.00",
        brandstof: "30.00",
        backload: "0.00",
        ek: "0.00",
        totaal: "230.00",
      });
      await expectConsistent();
    });

    /*
     * An unconfigured road prices at zero, visibly: a snapshot exists and
     * every column reads 0.00. That is a calculated price of €0, not a
     * missing calculation — which would be null, and "-" on screen.
     */
    it("2. stores a real zero, never a missing price", async () => {
      world.seed(buildTrip(TRIP, { destinationCity: "Nergens" }));

      await close(TRIP);

      const pricing = await apiPricing();
      expect(pricing).toMatchObject({
        tarief: "0.00",
        brandstof: "0.00",
        totaal: "0.00",
      });
      expect(world.storedSnapshot(TRIP)).not.toBeNull();
    });

    /*
     * ── THE "-" ON EVERY COLUMN ─────────────────────────────────────────────
     * One assigned Custom Value without a price used to refuse the whole
     * calculation: no snapshot, every column "-". It now contributes nothing
     * and the rest of the Trip is priced.
     */
    it("prices a Trip carrying a Custom Value that has no price", async () => {
      world.seed(buildTrip(TRIP));
      await world.customValues.assign({
        tripId: TRIP,
        customPropertyId: PROPERTIES.unpriced.id,
      });

      await close(TRIP);

      expect(await apiPricing()).toMatchObject({
        tarief: "200.00",
        others: "0.00",
        totaal: "230.00",
      });
      await expectConsistent();
    });
  });

  describe("EK: waiting time and Cost Confirmations", () => {
    it("3. one confirmation and no waiting time is the EK", async () => {
      await closedTrip();

      const recorded = await world.confirmCost(TRIP, "4132482", "25.00");

      expect(recorded.pricing?.ek).toBe("25.00");
      expect(await apiPricing()).toMatchObject({ ek: "25.00", totaal: "255.00" });
      expect(storedComponents().COST_CONFIRMATION).toBe("25.00");
      await expectConsistent();
    });

    it("sums several different confirmations", async () => {
      await closedTrip();

      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.confirmCost(TRIP, "4139509", "41.25");

      expect(await apiPricing()).toMatchObject({ ek: "66.25", totaal: "296.25" });
      await expectConsistent();
    });

    it("4. a charged waiting time added after closing becomes the EK", async () => {
      await closedTrip();
      await world.confirmCost(TRIP, "4132482", "25.00");

      const response = await world.tripService.update(TRIP, CHARGED_WINDOW);

      expect(response.pricing).toMatchObject({ ek: "55.00", totaal: "285.00" });
      expect(await apiPricing()).toMatchObject({ ek: "55.00" });
      // Counted once: the confirmation line is stored at €0, never added.
      expect(storedComponents()).toMatchObject({
        WAITING_TIME: "55.00",
        COST_CONFIRMATION: "0.00",
      });
      // The confirmation itself is untouched.
      expect(world.costConfirmations).toHaveLength(1);
      await expectConsistent();
    });

    it("5. changing it to an uncharged window falls back to the confirmations", async () => {
      await closedTrip();
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.tripService.update(TRIP, CHARGED_WINDOW);

      const response = await world.tripService.update(TRIP, UNCHARGED_WINDOW);

      expect(world.trips.get(TRIP)?.waitingTimeMinutes).toBe(135);
      expect(response.pricing).toMatchObject({ ek: "25.00" });
      expect(storedComponents()).not.toHaveProperty("WAITING_TIME");
      await expectConsistent();
    });

    it("6. removing it falls back to the confirmations and keeps them", async () => {
      await closedTrip();
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.confirmCost(TRIP, "4139509", "41.25");
      await world.tripService.update(TRIP, CHARGED_WINDOW);

      const response = await world.tripService.update(TRIP, REMOVE_WINDOW);

      expect(world.trips.get(TRIP)).toMatchObject({
        waitingTimeStart: null,
        waitingTimeEnd: null,
        waitingTimeMinutes: null,
        status: TripStatus.CLOSED,
      });
      expect(response.pricing).toMatchObject({ ek: "66.25", totaal: "296.25" });
      expect(world.costConfirmations.map((row) => row.ccNumber)).toEqual([
        "4132482",
        "4139509",
      ]);
      await expectConsistent();
    });

    it("7. a waiting time priced at €0 does not displace a confirmation", async () => {
      await closedTrip();
      await world.confirmCost(TRIP, "4132482", "25.00");

      await world.tripService.update(TRIP, UNCHARGED_WINDOW);

      expect(await apiPricing()).toMatchObject({ ek: "25.00" });
      await expectConsistent();
    });

    it("8. a charged waiting time with no confirmation is the EK on its own", async () => {
      await closedTrip();

      await world.tripService.update(TRIP, CHARGED_WINDOW);

      expect(await apiPricing()).toMatchObject({ ek: "55.00", totaal: "285.00" });
      await expectConsistent();
    });
  });

  describe("Custom Values after closing", () => {
    it("9. assigning reprices Others, and removing takes it out again", async () => {
      await closedTrip();

      const assigned = await world.customValues.assign({
        tripId: TRIP,
        customPropertyId: PROPERTIES.genset.id,
      });
      await world.customValues.assign({
        tripId: TRIP,
        customPropertyId: PROPERTIES.douane.id,
      });

      expect(await apiPricing()).toMatchObject({ others: "47.50", totaal: "277.50" });
      await expectConsistent();

      const removed = await world.customValues.remove(assigned.id);

      expect(removed.pricing).toMatchObject({ others: "12.50", totaal: "242.50" });
      expect(await apiPricing()).toMatchObject({ others: "12.50" });
      await expectConsistent();
    });

    /*
     * Assigning an unpriced Custom Value used to make the recalculation fail,
     * so the response said null and the OLD snapshot stayed in the database.
     */
    it("reprices when an unpriced Custom Value is assigned", async () => {
      await closedTrip();
      await world.tripService.update(TRIP, CHARGED_WINDOW);

      const assigned = await world.customValues.assign({
        tripId: TRIP,
        customPropertyId: PROPERTIES.unpriced.id,
      });

      expect(assigned.pricing).toMatchObject({ ek: "55.00", totaal: "285.00" });
      expect(assigned.reasonCode).toBeNull();
    });
  });

  describe("groups after closing", () => {
    it("10. grouping two CLOSED Trips gives both their Backload", async () => {
      await closedTrip(TRIP);
      await closedTrip(PARTNER);

      const responses = await world.tripService.createGroup([TRIP, PARTNER]);

      for (const response of responses) {
        expect(response.pricing).toMatchObject({ backload: "50.00", totaal: "280.00" });
      }
      for (const tripId of [TRIP, PARTNER]) {
        expect(storedComponents(tripId).COMBINATION).toBe("50.00");
        await expectConsistent(tripId);
      }
    });

    it("11. taking one out removes its Backload and leaves the other's", async () => {
      await closedTrip(TRIP);
      await closedTrip(PARTNER);
      await world.tripService.createGroup([TRIP, PARTNER]);

      const response = await world.tripService.removeFromGroup(TRIP);

      expect(response.pricing).toMatchObject({ backload: "0.00", totaal: "230.00" });
      expect(storedComponents(TRIP)).not.toHaveProperty("COMBINATION");
      // The member left behind keeps its group, and so its Backload.
      expect(world.trips.get(PARTNER)?.tripGroupId).not.toBeNull();
      expect(await apiPricing(PARTNER)).toMatchObject({ backload: "50.00" });
      await expectConsistent(TRIP);
      await expectConsistent(PARTNER);
    });

    it("moves a Trip to another group: out of one, into a new one", async () => {
      const THIRD = "trip-3";
      await closedTrip(TRIP);
      await closedTrip(PARTNER);
      await closedTrip(THIRD);
      await world.tripService.createGroup([TRIP, PARTNER]);
      await world.tripService.removeFromGroup(TRIP);

      await world.tripService.createGroup([TRIP, THIRD]);

      expect(await apiPricing(TRIP)).toMatchObject({ backload: "50.00" });
      expect(await apiPricing(THIRD)).toMatchObject({ backload: "50.00" });
      expect(world.trips.get(TRIP)?.tripGroupId).toBe(
        world.trips.get(THIRD)?.tripGroupId,
      );
    });

    it("keeps waiting time, CC and Custom Values through a regrouping", async () => {
      await closedTrip(TRIP);
      await closedTrip(PARTNER);
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.customValues.assign({
        tripId: TRIP,
        customPropertyId: PROPERTIES.genset.id,
      });

      await world.tripService.createGroup([TRIP, PARTNER]);

      expect(await apiPricing(TRIP)).toMatchObject({
        backload: "50.00",
        others: "35.00",
        ek: "25.00",
        totaal: "340.00",
      });
      await expectConsistent(TRIP);
    });
  });

  describe("ordering", () => {
    it("12. two edits in a row leave the price of the last", async () => {
      await closedTrip();

      await world.tripService.update(TRIP, CHARGED_WINDOW);
      await world.tripService.update(TRIP, REMOVE_WINDOW);

      expect(await apiPricing()).toMatchObject({ ek: "0.00", totaal: "230.00" });
      await expectConsistent();
    });

    /*
     * Two recalculations of one Trip running at once can finish in either
     * order. One that started reading BEFORE an edit and stores AFTER the edit's
     * own recalculation must not put the old figures back.
     */
    it("never lets an older calculation overwrite a newer snapshot", async () => {
      await closedTrip();
      const beforeTheEdit = await world.engine.calculate(TRIP);
      // The edit's own recalculation starts reading strictly later.
      await new Promise((resolve) => setTimeout(resolve, 5));

      await world.tripService.update(TRIP, CHARGED_WINDOW);
      await world.tripPricing.replaceSnapshot({
        tripId: TRIP,
        totalPrice: beforeTheEdit.totalPrice,
        calculatedAt: beforeTheEdit.calculatedAt,
        pricingEngineVersion: beforeTheEdit.pricingEngineVersion,
        pricingRuleVersion: beforeTheEdit.pricingRuleVersion,
        calculationStatus: beforeTheEdit.calculationStatus,
        routePricingId: beforeTheEdit.context.routeMatch.routePricingId,
        routeMatch: beforeTheEdit.context.routeMatch.method,
        combinationRouteGroupId: null,
        routeLegs: [],
        items: [],
      });

      expect(await apiPricing()).toMatchObject({ ek: "55.00", totaal: "285.00" });
      expect(world.snapshots).toHaveLength(1);
      await expectConsistent();
    });
  });

  /*
   * ── ONLY A CLOSED TRIP HAS A CURRENT PRICE ──────────────────────────────
   * The stored snapshot of a reopened Trip is kept as history and is never
   * shown as its price. Closing it again prices it afresh, from what it holds
   * by then — and nothing is calculated while it is OPEN.
   */
  describe("the Trip's status decides whether it has a current price", () => {
    async function reopen(tripId = TRIP) {
      return world.tripService.changeStatus(tripId, { status: TripStatus.OPEN });
    }

    /** What the exports and the detail page read: the CURRENT snapshots. */
    async function currentSnapshot(tripId = TRIP) {
      const [bulk] = await world.tripPricing.findManyByTripIds([tripId]);
      const single = await world.tripPricing.findByTripId(tripId);

      return { bulk: bulk ?? null, single };
    }

    it("1. an OPEN Trip never priced has no price", async () => {
      world.seed(buildTrip(TRIP));

      expect(await apiPricing()).toBeNull();
      expect(await currentSnapshot()).toEqual({ bulk: null, single: null });
    });

    it("3. a CLOSED Trip shows its price everywhere", async () => {
      await closedTrip();

      expect(await apiPricing()).toMatchObject({ totaal: "230.00" });
      const current = await currentSnapshot();
      expect(current.bulk?.pricing.tripId).toBe(TRIP);
      expect(current.single?.tripId).toBe(TRIP);
    });

    it("2/4. reopening hides the price at once, and keeps the snapshot as history", async () => {
      await closedTrip();

      const response = await reopen();

      expect(response.pricing).toBeNull();
      expect(await apiPricing()).toBeNull();
      expect(await currentSnapshot()).toEqual({ bulk: null, single: null });
      // History is not deleted.
      expect(world.storedSnapshot(TRIP)).not.toBeNull();
    });

    it("calculates nothing while the Trip is OPEN, whatever is edited", async () => {
      await closedTrip();
      await reopen();
      const before = world.storedSnapshot(TRIP);

      const waiting = await world.tripService.update(TRIP, CHARGED_WINDOW);
      const property = await world.customValues.assign({
        tripId: TRIP,
        customPropertyId: PROPERTIES.genset.id,
      });
      const confirmation = await world.confirmCost(TRIP, "4132482", "25.00");

      for (const answer of [waiting, property, confirmation]) {
        expect(answer.pricing).toBeNull();
      }
      expect(world.storedSnapshot(TRIP)).toEqual(before);
    });

    it("5/6/8. closing again prices every component from the current data", async () => {
      await closedTrip();
      await reopen();
      await world.tripService.update(TRIP, CHARGED_WINDOW);
      await world.customValues.assign({ tripId: TRIP, customPropertyId: PROPERTIES.genset.id });
      await world.confirmCost(TRIP, "4132482", "25.00");

      const response = await close(TRIP);

      expect(response.pricing).toMatchObject({
        tarief: "200.00",
        brandstof: "30.00",
        backload: "0.00",
        others: "35.00",
        ek: "55.00",
        totaal: "320.00",
      });
      expect(storedComponents()).toMatchObject({
        BASE_PRICE: "200.00",
        FUEL_SURCHARGE: "30.00",
        CUSTOM_PROPERTY: "35.00",
        WAITING_TIME: "55.00",
        COST_CONFIRMATION: "0.00",
      });
      await expectConsistent();
    });

    it("7/9. a group joined while OPEN is priced when the Trip closes again", async () => {
      await closedTrip(TRIP);
      await closedTrip(PARTNER);
      await reopen(TRIP);

      await world.tripService.createGroup([TRIP, PARTNER]);
      // The OPEN Trip is not priced by the regrouping; the CLOSED partner is.
      expect(await apiPricing(TRIP)).toBeNull();
      expect(await apiPricing(PARTNER)).toMatchObject({ backload: "50.00" });

      await close(TRIP);

      expect(await apiPricing(TRIP)).toMatchObject({ backload: "50.00", totaal: "280.00" });
      expect(storedComponents(TRIP).COMBINATION).toBe("50.00");
    });

    it("prices a group left while OPEN without its Backload on closing", async () => {
      await closedTrip(TRIP);
      await closedTrip(PARTNER);
      await world.tripService.createGroup([TRIP, PARTNER]);
      await reopen(TRIP);

      await world.tripService.removeFromGroup(TRIP);
      await close(TRIP);

      expect(await apiPricing(TRIP)).toMatchObject({ backload: "0.00", totaal: "230.00" });
      expect(storedComponents(TRIP)).not.toHaveProperty("COMBINATION");
    });

    it("hides the price of a CANCELLED or DELETED Trip that was once priced", async () => {
      await closedTrip(TRIP);
      await reopen(TRIP);
      await world.tripService.changeStatus(TRIP, { status: TripStatus.CANCELLED });
      expect(await apiPricing(TRIP)).toBeNull();

      await closedTrip(PARTNER);
      await world.tripService.softDelete(PARTNER);
      expect(await apiPricing(PARTNER)).toBeNull();
      expect(world.storedSnapshot(PARTNER)).not.toBeNull();
    });
  });

  /*
   * ── THE CC REFERENCES DO NOT DEPEND ON THE PRICE ──────────────────────────
   * Which documents Eucon sent is a fact about the Trip; whether its price is
   * shown is a fact about its status. The export words read the confirmation
   * records, so an OPEN Trip names every confirmation — and naming them prices
   * nothing.
   */
  describe("the CC references the exports print", () => {
    async function labelsOf(tripId = TRIP) {
      return (await world.exportLabels.findForTrips([tripId])).get(tripId)!;
    }

    it("1. an OPEN Trip without confirmations names none and has no price", async () => {
      world.seed(buildTrip(TRIP));

      expect((await labelsOf()).costConfirmations).toEqual([]);
      expect(await apiPricing()).toBeNull();
    });

    it("2/3/5. an OPEN Trip names every confirmation it receives, priced by nobody", async () => {
      world.seed(buildTrip(TRIP));

      await world.confirmCost(TRIP, "4132482", "25.00");
      expect((await labelsOf()).costConfirmations).toEqual(["CC4132482"]);

      await world.confirmCost(TRIP, "4139509", "41.25");
      const labels = await labelsOf();

      expect(labels.costConfirmations).toEqual(["CC4139509", "CC4132482"]);
      expect(labels.remarks).toBe("CC4139509 | CC4132482");
      expect(labels.tarCharged).toBe(false);
      expect(await apiPricing()).toBeNull();
      expect(world.storedSnapshot(TRIP)).toBeNull();
    });

    it("keeps every reference of a reopened Trip, and its price hidden", async () => {
      await closedTrip();
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.confirmCost(TRIP, "4139509", "41.25");
      await world.tripService.changeStatus(TRIP, { status: TripStatus.OPEN });

      expect((await labelsOf()).costConfirmations).toEqual(["CC4139509", "CC4132482"]);
      expect(await apiPricing()).toBeNull();
    });

    it("4. a CLOSED Trip names every confirmation beside its current price", async () => {
      await closedTrip();
      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.confirmCost(TRIP, "4139509", "41.25");

      expect((await labelsOf()).costConfirmations).toEqual(["CC4139509", "CC4132482"]);
      expect(await apiPricing()).toMatchObject({ ek: "66.25", totaal: "296.25" });
    });

    it("6. the same confirmation imported twice is named once", async () => {
      world.seed(buildTrip(TRIP));

      await world.confirmCost(TRIP, "4132482", "25.00");
      await world.confirmCost(TRIP, "4132482", "25.00");

      expect((await labelsOf()).costConfirmations).toEqual(["CC4132482"]);
      expect(world.costConfirmations).toHaveLength(1);
    });
  });

  describe("13. what a failed or impossible calculation looks like", () => {
    /*
     * A Trip that is not CLOSED is not priced, and says so with a reason —
     * never with figures presented as current.
     */
    it("answers null with a reason for a Trip that is still OPEN", async () => {
      world.seed(buildTrip(TRIP));

      const response = await world.tripService.update(TRIP, CHARGED_WINDOW);

      expect(response.pricing).toBeNull();
      expect(response.reasonCode).toBe("PRICING_TRIP_NOT_CLOSED");
      expect(world.storedSnapshot(TRIP)).toBeNull();
    });

    it("never calls a missing snapshot a price", async () => {
      world.seed(buildTrip(TRIP, { status: TripStatus.CLOSED }));

      expect(await apiPricing()).toBeNull();
    });
  });
});
