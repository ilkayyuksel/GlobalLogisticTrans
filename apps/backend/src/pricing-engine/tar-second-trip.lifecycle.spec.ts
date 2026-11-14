import { TripDirection, TripStatus } from "@prisma/client";

import {
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import { routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * Only the SECOND Trip of a pair may receive the automatic TAR from its
 * TAR-nummer field (owner, November 2026) — through the real services over
 * in-memory tables, from closing to the shared read the exports and the invoice
 * check use.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A pair is one DELIVERY and one COLLECTION: a genuine Combination, or a group
 * of exactly two active Trips. The DELIVERY is the first Trip and never
 * receives the automatic TAR, whatever it states; the COLLECTION is the second
 * and follows the existing rules. An operator's manual TAR is independent of
 * both and is always charged.
 *
 * "D" is the delivery and "C" the collection of one document unless a test
 * says otherwise. TAR is 20,00; every Trip runs on 2026-08-31.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TAR = "TAR-1";

describe("the automatic TAR on the second Trip of a pair", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
  });

  const tarLines = (tripId: string) =>
    (world.storedSnapshot(tripId)?.items ?? []).filter(
      (item) => item.customPropertyId === PROPERTIES.tar.id,
    );
  const automaticTar = (tripId: string) => tarLines(tripId).filter((item) => item.isAutomatic);
  const manualTar = (tripId: string) => tarLines(tripId).filter((item) => !item.isAutomatic);
  const automaticHolders = () =>
    [...world.trips.values()]
      .filter((trip) => trip.status === TripStatus.CLOSED)
      .filter((trip) => automaticTar(trip.id).length > 0)
      .map((trip) => trip.id)
      .sort();
  const othersOf = async (tripId: string) => (await actions.apiPricing(tripId))?.others;

  /**
   * The Trip's TAR lines, Others and Totaal, as stored and as every reader
   * sees them: the API row, the shared effective read the Excel invoice check
   * and both exports select from, and the export's TAR label.
   */
  async function expectTar(
    tripId: string,
    expected: { automatic: number; manual: number; others: string },
  ): Promise<void> {
    expect(automaticTar(tripId)).toHaveLength(expected.automatic);
    expect(manualTar(tripId)).toHaveLength(expected.manual);
    for (const line of tarLines(tripId)) {
      expect(line.amount.toFixed(2)).toBe("20.00");
    }

    expect(await othersOf(tripId)).toBe(expected.others);
    await actions.expectConsistent(tripId);

    const shared = (await world.effectivePricing.findForTrips([tripId])).get(tripId)!;
    const stored = world.storedSnapshot(tripId)!;

    expect(shared.others.toFixed(2)).toBe(expected.others);
    expect(shared.totaal.toFixed(2)).toBe(stored.totalPrice.toFixed(2));

    const labels = (await world.exportLabels.findForTrips([tripId])).get(tripId)!;

    expect(labels.tarCharged).toBe(expected.automatic + expected.manual > 0);
  }

  function seed(id: string, fields: Parameters<typeof buildTrip>[1] = {}) {
    world.seed(buildTrip(id, { tarNummer: TAR, ...fields }));
  }

  /** One document's DELIVERY and COLLECTION, grouped, OPEN. */
  async function pair(
    numbers: { delivery: string | null; collection: string | null },
    documents: { delivery: string; collection: string } = { delivery: "pdf-pair", collection: "pdf-pair" },
  ) {
    seed("D", { direction: TripDirection.DELIVERY, pdfDocumentId: documents.delivery, tarNummer: numbers.delivery });
    seed("C", { direction: TripDirection.COLLECTION, pdfDocumentId: documents.collection, tarNummer: numbers.collection });
    await world.tripService.createGroup(["D", "C"]);
  }

  async function closeBoth() {
    await actions.close("D");
    await actions.close("C");
  }

  const assignManualTar = async (tripId: string) =>
    (await world.customValues.assign({ tripId, customPropertyId: PROPERTIES.tar.id })).id;

  it("1. charges an ordinary Trip that states a number, as before", async () => {
    seed("solo", { direction: TripDirection.DELIVERY });
    await actions.close("solo");

    await expectTar("solo", { automatic: 1, manual: 0, others: "20.00" });
  });

  it("2. charges no automatic TAR when only the first Trip states a number", async () => {
    await pair({ delivery: TAR, collection: null });
    await closeBoth();

    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
    await expectTar("C", { automatic: 0, manual: 0, others: "0.00" });
    expect(automaticHolders()).toEqual([]);
  });

  it("3. charges only the second Trip when both state the same number", async () => {
    await pair({ delivery: TAR, collection: TAR });
    await closeBoth();

    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
    await expectTar("C", { automatic: 1, manual: 0, others: "20.00" });
    expect(automaticHolders()).toEqual(["C"]);
  });

  it("3. charges only the second Trip whichever leg closes first", async () => {
    await pair({ delivery: TAR, collection: TAR });
    await actions.close("C");
    await actions.close("D");

    expect(automaticHolders()).toEqual(["C"]);
    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
  });

  it("4. charges the second Trip when only it states a number", async () => {
    await pair({ delivery: null, collection: TAR });
    await closeBoth();

    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
    await expectTar("C", { automatic: 1, manual: 0, others: "20.00" });
  });

  it("applies to a manual group of two from different documents", async () => {
    await pair({ delivery: TAR, collection: TAR }, { delivery: "pdf-d", collection: "pdf-c" });
    await closeBoth();

    expect(automaticHolders()).toEqual(["C"]);
    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
  });

  describe("a manual TAR stays independent", () => {
    it("5. is charged on the first Trip", async () => {
      await pair({ delivery: null, collection: null });
      await closeBoth();
      await assignManualTar("D");

      await expectTar("D", { automatic: 0, manual: 1, others: "20.00" });
    });

    it("6. is the only TAR on a first Trip that also states a number", async () => {
      await pair({ delivery: TAR, collection: null });
      await closeBoth();
      await assignManualTar("D");

      await expectTar("D", { automatic: 0, manual: 1, others: "20.00" });
      expect(automaticHolders()).toEqual([]);
    });

    it("7. stands beside the automatic TAR on the second Trip, each once", async () => {
      await pair({ delivery: TAR, collection: TAR });
      await closeBoth();
      await assignManualTar("C");

      await expectTar("C", { automatic: 1, manual: 1, others: "40.00" });
      await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
      expect(automaticHolders()).toEqual(["C"]);
    });
  });

  it("8. gives the same result whichever leg is repriced", async () => {
    await pair({ delivery: TAR, collection: TAR });
    await closeBoth();

    await world.pairs.reprocessWithPartner("D");
    expect(automaticHolders()).toEqual(["C"]);
    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
    await expectTar("C", { automatic: 1, manual: 0, others: "20.00" });

    await world.pairs.reprocessWithPartner("C");
    expect(automaticHolders()).toEqual(["C"]);
    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
    await expectTar("C", { automatic: 1, manual: 0, others: "20.00" });
  });

  describe("9. a change of group never charges the number twice", () => {
    it("moves the charge from the delivery to the collection when they are grouped", async () => {
      seed("D", { direction: TripDirection.DELIVERY, pdfDocumentId: "pdf-d" });
      seed("C", { direction: TripDirection.COLLECTION, pdfDocumentId: "pdf-c" });
      await actions.close("D");
      await actions.close("C");
      // Ungrouped, the first Trip priced with the number holds it.
      expect(automaticHolders()).toEqual(["D"]);

      await world.tripService.createGroup(["D", "C"]);

      expect(automaticHolders()).toEqual(["C"]);
      await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
      await expectTar("C", { automatic: 1, manual: 0, others: "20.00" });
    });

    it("keeps one holder through unlinking and grouping again", async () => {
      await pair({ delivery: TAR, collection: TAR }, { delivery: "pdf-d", collection: "pdf-c" });
      await closeBoth();

      await world.tripService.removeFromGroup("C");
      expect(automaticHolders()).toEqual(["C"]);

      await world.tripService.removeFromGroup("D");
      await world.tripService.createGroup(["D", "C"]);
      expect(automaticHolders()).toEqual(["C"]);

      await world.pairs.reprocessWithPartner("D");
      expect(automaticHolders()).toEqual(["C"]);
    });

    it("treats a group of three as ordinary Trips, still once a day", async () => {
      seed("D", { direction: TripDirection.DELIVERY, pdfDocumentId: "pdf-d" });
      seed("C", { direction: TripDirection.COLLECTION, pdfDocumentId: "pdf-c" });
      seed("X", { direction: TripDirection.COLLECTION, pdfDocumentId: "pdf-x" });
      await world.tripService.createGroup(["D", "C", "X"]);
      await actions.close("D");
      await actions.close("C");
      await actions.close("X");

      expect(automaticHolders()).toEqual(["D"]);
    });
  });

  it("gives the first Trip the charge once its collection is cancelled, and takes it back on reclose", async () => {
    await pair({ delivery: TAR, collection: TAR });
    await closeBoth();
    expect(automaticHolders()).toEqual(["C"]);

    await actions.reopen("C");
    await world.tripService.changeStatus("C", { status: TripStatus.CANCELLED });
    // Its partner cancelled, D stands alone and is an ordinary Trip again.
    expect(automaticHolders()).toEqual(["D"]);
    await expectTar("D", { automatic: 1, manual: 0, others: "20.00" });

    await world.tripService.changeStatus("C", { status: TripStatus.OPEN });
    await actions.close("C");
    expect(automaticHolders()).toEqual(["C"]);
    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
  });

  it("moves the charge when the second Trip's number is cleared, and never to the first", async () => {
    await pair({ delivery: TAR, collection: TAR });
    await closeBoth();
    seed("other", { direction: TripDirection.DELIVERY });
    await actions.close("other");
    expect(automaticHolders()).toEqual(["C"]);

    await world.tripService.update("C", { tarNummer: null });

    expect(automaticHolders()).toEqual(["other"]);
    await expectTar("D", { automatic: 0, manual: 0, others: "0.00" });
  });
});
