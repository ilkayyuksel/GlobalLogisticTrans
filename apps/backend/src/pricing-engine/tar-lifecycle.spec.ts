import { PricingCalculationStatus, TripDirection, TripStatus } from "@prisma/client";

import { MissingPricingSettingException } from "./exceptions/pricing-engine.exceptions";
import {
  PROPERTIES,
  buildPricingLifecycle,
  buildTrip,
  type PricingLifecycle,
} from "./pricing-lifecycle.harness";
import { routeMatchActions } from "./route-match-lifecycle.fixtures";

/**
 * The automatic TAR through every lifecycle path that can move it — regrouping,
 * cancelling and reactivating, reopening, manual TAR, concurrent closing — with
 * the real services over in-memory tables.
 *
 * ── THE RULES, UNCHANGED ────────────────────────────────────────────────────
 * One TAR-nummer is charged automatically once per day, on the first Trip
 * priced with it; the COLLECTION leg of a genuine Combination never owes it; a
 * manual TAR is an extra beside it and never holds or blocks it. What these
 * tests add is that every change reaches the Trips sharing the number at once,
 * so the charge is always on exactly one CLOSED Trip that owes it.
 *
 * Every Trip states TAR-1 on 2026-08-31 unless said otherwise. TAR is 20,00.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TAR = "TAR-1";

describe("the automatic TAR through the Trip lifecycle", () => {
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
  const automaticHolders = () =>
    [...world.trips.values()]
      .filter((trip) => trip.status === TripStatus.CLOSED)
      .filter((trip) => tarLines(trip.id).some((item) => item.isAutomatic))
      .map((trip) => trip.id)
      .sort();
  const othersOf = async (tripId: string) => (await actions.apiPricing(tripId))?.others;

  function seed(id: string, fields: Parameters<typeof buildTrip>[1] = {}) {
    world.seed(buildTrip(id, { tarNummer: TAR, ...fields }));
  }

  async function closed(id: string, fields: Parameters<typeof buildTrip>[1] = {}) {
    seed(id, fields);
    await actions.close(id);
  }

  /** A holds the day's TAR, B states the same number and owes none. */
  async function holderAndSharer() {
    await closed("A");
    await closed("B");

    expect(automaticHolders()).toEqual(["A"]);
    expect(await othersOf("B")).toBe("0.00");
  }

  const assignTar = async (tripId: string) =>
    (await world.customValues.assign({ tripId, customPropertyId: PROPERTIES.tar.id })).id;

  describe("1/2. a change of group", () => {
    it("1. moves the charge when its holder becomes the COLLECTION leg of a genuine Combination", async () => {
      // A is a collection on its own: it owes the TAR and holds it.
      await closed("A", { direction: TripDirection.COLLECTION, pdfDocumentId: "pdf-1" });
      await closed("B");
      await closed("delivery", { tarNummer: null, direction: TripDirection.DELIVERY, pdfDocumentId: "pdf-1" });
      expect(automaticHolders()).toEqual(["A"]);

      // Grouped with the delivery of its own document, A is that pair's collection.
      await world.tripService.createGroup(["A", "delivery"]);

      expect(tarLines("A")).toEqual([]);
      expect(automaticHolders()).toEqual(["B"]);
      expect(await othersOf("B")).toBe("20.00");
      await actions.expectConsistent("B");
    });

    it("1. gives the charge back to the leg that owes it again when the pair is split", async () => {
      await closed("A", { direction: TripDirection.COLLECTION, pdfDocumentId: "pdf-1" });
      await closed("delivery", { tarNummer: null, direction: TripDirection.DELIVERY, pdfDocumentId: "pdf-1" });
      await world.tripService.createGroup(["A", "delivery"]);
      await closed("B");
      expect(automaticHolders()).toEqual(["B"]);

      await world.tripService.removeFromGroup("A");

      // B holds it now, and keeps it: the first Trip priced with the number.
      expect(automaticHolders()).toEqual(["B"]);
      expect(tarLines("A")).toEqual([]);
    });

    it("2. leaves the charge where it is when a group change does not touch its leg", async () => {
      await holderAndSharer();
      await closed("other", { tarNummer: null, pdfDocumentId: "pdf-other" });

      // A manual group of two: B is no leg of a genuine Combination.
      await world.tripService.createGroup(["B", "other"]);

      expect(automaticHolders()).toEqual(["A"]);
      expect(await othersOf("A")).toBe("20.00");
      expect(await othersOf("B")).toBe("0.00");
    });
  });

  describe("3. a cancelled Trip that becomes active again", () => {
    it("never charges the number twice, at any step", async () => {
      await holderAndSharer();
      await actions.reopen("A");
      await world.tripService.changeStatus("A", { status: TripStatus.CANCELLED });
      expect(automaticHolders()).toEqual(["B"]);

      // Back from CANCELLED: B, which took the charge meanwhile, keeps it.
      await world.tripService.changeStatus("A", { status: TripStatus.OPEN });
      await world.pairs.reprocessWithPartner("B");
      expect(automaticHolders()).toEqual(["B"]);
      expect(await othersOf("B")).toBe("20.00");

      await actions.close("A");
      expect(automaticHolders()).toEqual(["B"]);
      expect(tarLines("A")).toEqual([]);
    });

    it("never charges the number twice when a deleted Trip is restored", async () => {
      await holderAndSharer();
      await actions.reopen("A");
      await world.tripService.softDelete("A");
      expect(automaticHolders()).toEqual(["B"]);

      await world.tripService.restore("A");
      await world.pairs.reprocessWithPartner("B");
      await actions.close("A");

      expect(automaticHolders()).toEqual(["B"]);
      expect(tarLines("A")).toEqual([]);
      expect(await othersOf("B")).toBe("20.00");
    });

    it("keeps the charge with a Trip that was only reopened", async () => {
      await holderAndSharer();
      await actions.reopen("A");

      await world.pairs.reprocessWithPartner("B");
      await closed("C");

      expect(tarLines("B")).toEqual([]);
      expect(tarLines("C")).toEqual([]);
      await actions.close("A");
      expect(automaticHolders()).toEqual(["A"]);
    });
  });

  /** 4. Two Trips closing at once each find the number free; only one may keep it. */
  it("4. charges the number once when two Trips close at the same time", async () => {
    seed("A");
    seed("B");

    await Promise.all([actions.close("A"), actions.close("B")]);

    expect(automaticHolders()).toHaveLength(1);
    const total = (await othersOf("A"))! + (await othersOf("B"))!;
    expect(["20.000.00", "0.0020.00"]).toContain(total);
  });

  describe("5/6/7. a manual TAR", () => {
    it("5. added to a reopened holder does not hand its automatic charge to another Trip", async () => {
      await holderAndSharer();
      await actions.reopen("A");
      await assignTar("A");

      await world.pairs.reprocessWithPartner("B");
      await closed("C");
      expect(tarLines("B")).toEqual([]);
      expect(tarLines("C")).toEqual([]);

      await actions.close("A");
      // The automatic charge and the operator's extra.
      expect(tarLines("A").map((item) => item.isAutomatic).sort()).toEqual([false, true]);
      expect(await othersOf("A")).toBe("40.00");
    });

    it("6. removed again: the extra goes, the automatic charge stays", async () => {
      await holderAndSharer();
      const manual = await assignTar("A");
      expect(await othersOf("A")).toBe("40.00");

      await world.customValues.remove(manual);

      expect(await othersOf("A")).toBe("20.00");
      expect(automaticHolders()).toEqual(["A"]);
    });

    it("6. on a holder that lets the number go: the automatic charge moves, the manual one stays", async () => {
      await holderAndSharer();
      await assignTar("A");

      await world.tripService.update("A", { tarNummer: null });

      expect(await othersOf("A")).toBe("20.00");
      expect(tarLines("A").map((item) => item.isAutomatic)).toEqual([false]);
      expect(automaticHolders()).toEqual(["B"]);
    });

    it("7. on another Trip never blocks the automatic charge, before or after it is removed", async () => {
      await holderAndSharer();
      const manual = await assignTar("B");

      await world.pairs.reprocessWithPartner("A");
      expect(automaticHolders()).toEqual(["A"]);
      expect(await othersOf("B")).toBe("20.00");

      await world.customValues.remove(manual);
      await world.pairs.reprocessWithPartner("A");
      expect(automaticHolders()).toEqual(["A"]);
      expect(await othersOf("B")).toBe("0.00");
    });

    it("7. on a reopened Trip whose snapshot held only that manual TAR blocks nothing", async () => {
      await closed("B", { tarNummer: "TAR-OTHER" });
      await assignTar("B");
      await world.tripService.update("B", { tarNummer: TAR });
      expect(tarLines("B").map((item) => item.isAutomatic).sort()).toEqual([false, true]);
      await actions.reopen("B");
      await world.tripService.update("B", { tarNummer: "TAR-OTHER" });

      await closed("A");

      expect(automaticHolders()).toEqual(["A"]);
    });
  });

  it("8. never adds a TAR twice however often the Trips are repriced", async () => {
    await holderAndSharer();
    await assignTar("A");

    for (const tripId of ["A", "B", "A", "B"]) {
      await world.pairs.reprocessWithPartner(tripId);
    }

    expect(tarLines("A")).toHaveLength(2);
    expect(tarLines("B")).toEqual([]);
    expect(await othersOf("A")).toBe("40.00");
    await actions.expectConsistent("A");
  });

  it("9. shows no old price for a Trip whose repricing for a moved charge failed", async () => {
    await holderAndSharer();
    world.ruleResolver.resolve
      .mockImplementationOnce(world.ruleResolver.resolve.getMockImplementation()!)
      .mockRejectedValueOnce(new MissingPricingSettingException("PRICING", "FUEL_PERCENTAGE"));

    await world.tripService.update("A", { tarNummer: null });

    expect(world.storedSnapshot("B")?.calculationStatus).toBe(PricingCalculationStatus.FAILED);
    expect(await actions.apiPricing("B")).toBeNull();
  });
});
