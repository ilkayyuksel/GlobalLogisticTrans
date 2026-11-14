import { Prisma, TripStatus } from "@prisma/client";

import { buildPricingLifecycle, buildTrip, type PricingLifecycle } from "./pricing-lifecycle.harness";
import { routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * EK: a RECORDED manual waiting time always wins over the Cost Confirmations
 * (owner, November 2026) — through the real services over in-memory tables,
 * from the operator's edit or the PDF import's `record` to the stored snapshot
 * and the shared read every screen, export and the invoice check use.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *   waiting time recorded   → EK is its price alone, also at €0; the
 *                             confirmations are kept, stored at €0 in EK
 *   none recorded           → EK is the confirmations, each number once
 *   neither                 → EK €0
 * Whatever order the two arrive in: every trigger prices from the current Trip
 * and the current confirmations, never on top of an earlier EK.
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
/** 135 counted minutes: below the threshold, a valid window priced at €0. */
const WAITING_0 = { waitingTimeStart: "10:00", waitingTimeEnd: "12:15" };
const NO_WAITING = { waitingTimeStart: null, waitingTimeEnd: null };

describe("EK: a recorded waiting time before the Cost Confirmations", () => {
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

  /** Every confirmation is kept as recorded, whatever EK counts of it. */
  function expectConfirmationsKept(expected: readonly [string, string][]): void {
    expect(world.costConfirmations.map((row) => [row.ccNumber, row.amount.toFixed(2)])).toEqual(expected);
  }

  describe("without a recorded waiting time", () => {
    it("1. one confirmation is the EK", async () => {
      await importCc("4100001", "70.00");

      await expectEk("70.00");
      expect(storedComponent("COST_CONFIRMATION")).toBe("70.00");
    });

    it("2. several confirmations are summed, each number once", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");
      await importCc("4100002", "68.75");

      await expectEk("138.75");
      expectConfirmationsKept([
        ["4100001", "70.00"],
        ["4100002", "68.75"],
      ]);
    });
  });

  it("3. a waiting time alone is the EK", async () => {
    await recordWaiting(WAITING_55);

    await expectEk("55.00");
    expect(storedComponent("WAITING_TIME")).toBe("55.00");
    expect(storedComponent("COST_CONFIRMATION")).toBeUndefined();
  });

  it("4. with both present, only the waiting time is the EK", async () => {
    await importCc("4100001", "70.00");
    await recordWaiting(WAITING_55);
    await importCc("4100002", "68.75");

    await expectEk("55.00");
    expect(storedComponent("COST_CONFIRMATION")).toBe("0.00");
  });

  it("5/16. confirmations first, then a waiting time: EK is replaced, not added to", async () => {
    await importCc("4100001", "70.00");
    await importCc("4100002", "68.75");
    await expectEk("138.75");

    await recordWaiting(WAITING_55);

    await expectEk("55.00");
    expect(storedComponent("COST_CONFIRMATION")).toBe("0.00");
    expectConfirmationsKept([
      ["4100001", "70.00"],
      ["4100002", "68.75"],
    ]);
  });

  it("6/11. a waiting time first, then a confirmation from a PDF: EK stays the waiting time", async () => {
    await recordWaiting(WAITING_55);

    const imported = await importCc("4100001", "68.75");

    expect(imported.outcome).not.toBe("ALREADY_RECORDED");
    await expectEk("55.00");
    expectConfirmationsKept([["4100001", "68.75"]]);
  });

  it("7. several confirmation PDFs in a row never move the waiting time's EK", async () => {
    await recordWaiting(WAITING_55);

    for (const [ccNumber, amount] of [["4100001", "70.00"], ["4100002", "68.75"], ["4100003", "12.50"]]) {
      await importCc(ccNumber, amount);
      await expectEk("55.00");
    }
  });

  it("8. a changed waiting time replaces the old one entirely", async () => {
    await importCc("4100001", "70.00");
    await recordWaiting(WAITING_55);

    await recordWaiting(WAITING_68_75);

    await expectEk("68.75");
    expect(storedComponent("WAITING_TIME")).toBe("68.75");
  });

  it("9/17. a removed waiting time gives the EK back to every confirmation", async () => {
    await importCc("4100001", "70.00");
    await importCc("4100002", "68.75");
    await recordWaiting(WAITING_55);
    await expectEk("55.00");

    await recordWaiting(NO_WAITING);

    await expectEk("138.75");
    expect(storedComponent("WAITING_TIME")).toBeUndefined();
  });

  it("10/17. a removed waiting time without confirmations leaves EK €0", async () => {
    await recordWaiting(WAITING_55);

    await recordWaiting(NO_WAITING);

    await expectEk("0.00");
    expect(storedComponent("WAITING_TIME")).toBeUndefined();
    expect(storedComponent("COST_CONFIRMATION")).toBeUndefined();
  });

  /*
   * Nothing in the application edits or deletes a confirmation: the only flow
   * records one. These change the stored rows directly and reprice through the
   * central trigger, to show EK is rebuilt from the CURRENT rows every time.
   */
  describe("12/13. confirmations that changed since the last pricing", () => {
    async function changeConfirmations(): Promise<void> {
      world.costConfirmations[0].amount = new Prisma.Decimal("80.00");
      world.costConfirmations.splice(1, 1);
      await world.pairs.reprocessWithPartner(TRIP);
    }

    it("12. still leave a recorded waiting time as the EK alone", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");
      await recordWaiting(WAITING_55);

      await changeConfirmations();

      await expectEk("55.00");
    });

    it("13. rebuild the EK from the current confirmations without a waiting time", async () => {
      await importCc("4100001", "70.00");
      await importCc("4100002", "68.75");

      await changeConfirmations();

      await expectEk("80.00");
    });
  });

  it("14. a valid waiting window priced at €0 still keeps the confirmations out", async () => {
    await importCc("4100001", "70.00");
    await importCc("4100002", "68.75");

    await recordWaiting(WAITING_0);

    expect(world.trips.get(TRIP)!.waitingTimeMinutes).toBe(135);
    await expectEk("0.00");
    expect(storedComponent("COST_CONFIRMATION")).toBe("0.00");
    expectConfirmationsKept([
      ["4100001", "70.00"],
      ["4100002", "68.75"],
    ]);
  });

  it("15. pricing the same Trip again adds nothing twice", async () => {
    await importCc("4100001", "70.00");
    await importCc("4100002", "68.75");
    await recordWaiting(WAITING_55);

    for (let run = 0; run < 3; run += 1) {
      await world.pairs.reprocessWithPartner(TRIP);
      await recordWaiting(WAITING_55);
    }

    await expectEk("55.00");
    expect(storedComponent("WAITING_TIME")).toBe("55.00");
    expect(storedComponent("COST_CONFIRMATION")).toBe("0.00");
  });

  it("sums three confirmations to €163.75, counts a re-import once, and yields to a waiting time and back", async () => {
    await importCc("4261544", "68.75");
    await expectEk("68.75");
    await importCc("4261545", "70.00");
    await expectEk("138.75");
    await importCc("4261546", "25.00");
    await expectEk("163.75");

    const again = await importCc("4261545", "70.00");
    await world.pairs.reprocessWithPartner(TRIP);

    expect(again.outcome).toBe("ALREADY_RECORDED");
    await expectEk("163.75");
    expect(storedComponent("COST_CONFIRMATION")).toBe("163.75");

    await recordWaiting(WAITING_55);
    await expectEk("55.00");

    await recordWaiting(NO_WAITING);
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
  });

  it("shows no stale EK when the repricing after a waiting-time edit fails", async () => {
    await importCc("4100001", "70.00");
    await expectEk("70.00");
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
