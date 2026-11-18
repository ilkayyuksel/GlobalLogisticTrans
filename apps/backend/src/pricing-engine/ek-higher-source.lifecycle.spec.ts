import { Prisma, TripStatus } from "@prisma/client";

import { buildPricingLifecycle, buildTrip, type PricingLifecycle } from "./pricing-lifecycle.harness";
import { routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * EK: the HIGHER of the manual waiting time and the Cost Confirmations (owner,
 * November 2026) — through the real services over in-memory tables, from the
 * operator's edit or the PDF import's `record` to the stored snapshot and the
 * shared read every screen, export and the invoice check use.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *   EK = max(waiting time charge, sum of the confirmations, each number once)
 * Never the two added. The lower one is stored at €0; the confirmations are
 * always kept. Whatever order the two arrive in: every trigger prices from the
 * current Trip and the current confirmations, never on top of an earlier EK.
 *
 * ── THE NUMBERS (the Settings' defaults, as the harness holds them) ─────────
 * 06:00 → 20:00 counts; from 150 minutes, 120 are free and every started 15
 * minutes costs €13.75. Tarief 200 + Fuel 30 = 230 before EK.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TRIP = "trip";
const BEFORE_EK = new Prisma.Decimal("230.00");

/** 180 counted minutes → 4 blocks → 55.00. */
const WAITING_55 = { waitingTimeStart: "10:00", waitingTimeEnd: "13:00" };
/** 195 counted minutes → 5 blocks → 68.75. */
const WAITING_68_75 = { waitingTimeStart: "10:00", waitingTimeEnd: "13:15" };
/** 285 counted minutes → 11 blocks → 151.25, the nearest the block price comes to €150. */
const WAITING_151_25 = { waitingTimeStart: "10:00", waitingTimeEnd: "14:45" };
/** 135 counted minutes: below the threshold, a valid window priced at €0. */
const WAITING_0 = { waitingTimeStart: "10:00", waitingTimeEnd: "12:15" };
const NO_WAITING = { waitingTimeStart: null, waitingTimeEnd: null };

describe("EK: the higher of the manual waiting time and the Cost Confirmations", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(async () => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
    world.seed(buildTrip(TRIP));
    await actions.close(TRIP);
  });

  /** A confirmation as the PDF import records it: the real `record`. */
  const importCc = (ccNumber: string, amount: string) => world.confirmCost(TRIP, ccNumber, amount);
  const recordWaiting = (window: Record<string, string | null>) => world.tripService.update(TRIP, window);

  function storedComponent(code: string): string | undefined {
    const items = world.storedSnapshot(TRIP)!.items.filter((item) => item.pricingComponent.code === code);

    return items.length === 0
      ? undefined
      : items.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)).toFixed(2);
  }

  /** EK as stored, as the API answers it, and as the shared read sees it. */
  async function expectEk(ek: string): Promise<void> {
    const totaal = BEFORE_EK.plus(ek).toFixed(2);

    expect(await actions.apiPricing(TRIP)).toMatchObject({ ek, totaal });
    expect(world.storedSnapshot(TRIP)!.totalPrice.toFixed(2)).toBe(totaal);
    await actions.expectConsistent(TRIP);

    const shared = (await world.effectivePricing.findForTrips([TRIP])).get(TRIP)!;

    expect(shared.ek.toFixed(2)).toBe(ek);
    expect(shared.totaal.toFixed(2)).toBe(totaal);
  }

  /** The lower source is kept on the snapshot at €0, the higher one in full. */
  function expectStored(waitingTime: string | undefined, confirmations: string | undefined): void {
    expect([storedComponent("WAITING_TIME"), storedComponent("COST_CONFIRMATION")]).toEqual([waitingTime, confirmations]);
  }

  /** Every confirmation is kept as recorded, whatever EK counts of it. */
  function expectConfirmationsKept(expected: readonly [string, string][]): void {
    expect(world.costConfirmations.map((row) => [row.ccNumber, row.amount.toFixed(2)])).toEqual(expected);
  }

  /*
   * Nothing in the application edits or deletes a confirmation: the only flow
   * records one (`cost-confirmation.repository.ts`). These change the stored
   * rows directly and reprice through the central trigger, to show EK is
   * rebuilt from the CURRENT rows every time.
   */
  async function removeConfirmation(ccNumber: string): Promise<void> {
    world.costConfirmations.splice(
      world.costConfirmations.findIndex((row) => row.ccNumber === ccNumber),
      1,
    );
    await world.pairs.reprocessWithPartner(TRIP);
  }

  describe("the comparison", () => {
    it("1. a waiting time above one confirmation: the waiting time", async () => {
      await importCc("4100001", "50.00");
      await recordWaiting(WAITING_68_75);

      await expectEk("68.75");
      expectStored("68.75", "0.00");
      expectConfirmationsKept([["4100001", "50.00"]]);
    });

    it("2. a confirmation above the waiting time: the confirmation", async () => {
      await importCc("4100001", "70.00");
      await recordWaiting(WAITING_55);

      await expectEk("70.00");
      expectStored("0.00", "70.00");
      // The waiting time stays on the snapshot at €0, its blocks and price kept.
      const waitingLine = world.storedSnapshot(TRIP)!.items.find((item) => item.pricingComponent.code === "WAITING_TIME")!;
      expect([waitingLine.quantity?.toFixed(0), waitingLine.unitPrice?.toFixed(2)]).toEqual(["4", "13.75"]);
    });

    it("3. several confirmations together above the waiting time: their whole sum", async () => {
      await recordWaiting(WAITING_55);
      await importCc("4261544", "68.75");
      await importCc("4261545", "70.00");
      await importCc("4261546", "25.00");

      await expectEk("163.75");
      expectStored("0.00", "163.75");
    });

    it("4. a waiting time above the sum of several confirmations: the waiting time", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");
      await recordWaiting(WAITING_151_25);

      await expectEk("151.25");
      expectStored("151.25", "0.00");
    });

    it("5. equal amounts: that amount, once", async () => {
      await importCc("4100001", "55.00");
      await recordWaiting(WAITING_55);

      await expectEk("55.00");
      expectStored("55.00", "0.00");
    });

    it("6. no waiting time, one confirmation: the confirmation", async () => {
      await importCc("4100001", "70.00");

      await expectEk("70.00");
      expectStored(undefined, "70.00");
    });

    it("7. no waiting time, several confirmations: their whole sum", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");

      await expectEk("138.75");
      expectStored(undefined, "138.75");
    });

    it("8. a waiting time, no confirmations: the waiting time", async () => {
      await recordWaiting(WAITING_68_75);

      await expectEk("68.75");
      expectStored("68.75", undefined);
    });

    it("9. both €0: EK €0", async () => {
      await recordWaiting(WAITING_0);

      expect(world.trips.get(TRIP)!.waitingTimeMinutes).toBe(135);
      await expectEk("0.00");
      expectStored(undefined, undefined);
    });

    it("10. a waiting time priced at €0 beside confirmations: their sum", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");

      await recordWaiting(WAITING_0);

      await expectEk("138.75");
      expectStored(undefined, "138.75");
      expectConfirmationsKept([
        ["4100001", "70.00"],
        ["4100002", "68.75"],
      ]);
    });
  });

  describe("every trigger compares again, from the current data", () => {
    it("11. a removed confirmation: the remaining ones against the waiting time", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");
      await recordWaiting(WAITING_55);
      await expectEk("138.75");

      await removeConfirmation("4100001");
      await expectEk("68.75");

      await removeConfirmation("4100002");
      await expectEk("55.00");
      expectStored("55.00", undefined);
    });

    it("11. a changed confirmation amount is compared again", async () => {
      await importCc("4100001", "70.00");
      await recordWaiting(WAITING_68_75);
      await expectEk("70.00");

      world.costConfirmations[0].amount = new Prisma.Decimal("40.00");
      await world.pairs.reprocessWithPartner(TRIP);

      await expectEk("68.75");
    });

    it("12. a changed waiting time is compared again, up and down", async () => {
      await importCc("4100001", "70.00");
      await recordWaiting(WAITING_55);
      await expectEk("70.00");

      await recordWaiting(WAITING_151_25);
      await expectEk("151.25");

      await recordWaiting(WAITING_68_75);
      await expectEk("70.00");
    });

    it("13. a removed waiting time gives the EK to the sum of the confirmations", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");
      await recordWaiting(WAITING_151_25);
      await expectEk("151.25");

      await recordWaiting(NO_WAITING);

      await expectEk("138.75");
      expectStored(undefined, "138.75");
    });

    it("13. a removed waiting time without confirmations leaves EK €0", async () => {
      await recordWaiting(WAITING_55);

      await recordWaiting(NO_WAITING);

      await expectEk("0.00");
      expectStored(undefined, undefined);
    });

    it("14. confirmations imported beside a waiting time: compared PDF by PDF", async () => {
      await recordWaiting(WAITING_68_75);

      const first = await importCc("4100001", "50.00");
      expect(first.outcome).not.toBe("ALREADY_RECORDED");
      await expectEk("68.75");

      await importCc("4100002", "70.00");
      await expectEk("120.00");

      await importCc("4100003", "12.50");
      await expectEk("132.50");
      expectConfirmationsKept([
        ["4100001", "50.00"],
        ["4100002", "70.00"],
        ["4100003", "12.50"],
      ]);
    });

    it("15. pricing the same Trip again and again adds nothing", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");
      await recordWaiting(WAITING_55);

      for (let run = 0; run < 3; run += 1) {
        await world.pairs.reprocessWithPartner(TRIP);
        await recordWaiting(WAITING_55);
        await importCc("4100002", "68.75");
      }

      await expectEk("138.75");
      expectStored("0.00", "138.75");
    });

    it("16. a confirmation imported again is counted once", async () => {
      await importCc("4261544", "68.75");
      await importCc("4261545", "70.00");
      await importCc("4261546", "25.00");
      await recordWaiting(WAITING_55);

      const again = await importCc("4261545", "70.00");
      await world.pairs.reprocessWithPartner(TRIP);

      expect(again.outcome).toBe("ALREADY_RECORDED");
      await expectEk("163.75");
      expectConfirmationsKept([
        ["4261544", "68.75"],
        ["4261545", "70.00"],
        ["4261546", "25.00"],
      ]);
    });

    it("gives the same EK whichever order the waiting time and the confirmations arrive in", async () => {
      await recordWaiting(WAITING_55);
      await importCc("4100001", "70.00");
      const waitingFirst = await actions.apiPricing(TRIP);

      world = buildPricingLifecycle();
      actions = routeMatchActions(world);
      world.seed(buildTrip(TRIP));
      await actions.close(TRIP);
      await importCc("4100001", "70.00");
      await recordWaiting(WAITING_55);

      expect(await actions.apiPricing(TRIP)).toEqual(waitingFirst);
      expect(waitingFirst).toMatchObject({ ek: "70.00" });
    });

    it("shows no stale EK when the repricing after a waiting-time edit fails", async () => {
      await importCc("4100001", "50.00");
      await expectEk("50.00");
      world.ruleResolver.resolve.mockRejectedValueOnce(new Error("pricing rules unavailable"));

      const response = await recordWaiting(WAITING_55);

      // The window is saved; the old snapshot is no current price any more.
      expect(world.trips.get(TRIP)!.waitingTimeMinutes).toBe(180);
      expect(response.pricing).toBeNull();
      expect(world.trips.get(TRIP)!.status).toBe(TripStatus.CLOSED);

      await world.pairs.reprocessWithPartner(TRIP);
      await expectEk("55.00");
    });
  });
});
