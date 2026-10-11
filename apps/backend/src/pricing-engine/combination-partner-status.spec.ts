import { TripDirection, TripStatus } from "@prisma/client";

import {
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
 * Only OPEN and CLOSED Trips are pricing partners — through the real services.
 *
 * A CANCELLED or DELETED Trip is filtered out of its group BEFORE the partner
 * is chosen, so it never prices a pair, by any rule or fallback; its leaving
 * and its coming back reprice the CLOSED Trips whose pair it moved.
 *
 * The Combination (fixtures): Leg 1 Quay 869 → Ghlin, Leg 2 Mons → Quay 869,
 * Over ST 40 / 10 / —. Here the legs come from DIFFERENT documents and are
 * grouped by hand — a group of two — unless a test says otherwise.
 */

const OUT = "outbound";
const BACK = "return";
const THIRD = "third";

describe("pricing partners by status", () => {
  let world: PricingLifecycle;
  let actions: ReturnType<typeof routeMatchActions>;

  beforeEach(() => {
    world = buildPricingLifecycle();
    actions = routeMatchActions(world);
    actions.configureCombination();
  });

  /** Both legs OPEN, grouped as a pair of two; the caller closes what it needs. */
  async function groupedPair(sameDocument = false): Promise<void> {
    world.seed(
      buildTrip(OUT, {
        pdfDocumentId: sameDocument ? "pdf-pair" : "pdf-out",
        direction: TripDirection.DELIVERY,
        planningDate: new Date(`${DAY_ONE}T00:00:00Z`),
      }),
    );
    world.seed(
      buildTrip(BACK, {
        pdfDocumentId: sameDocument ? "pdf-pair" : "pdf-back",
        direction: TripDirection.COLLECTION,
        destinationCity: "Mons",
        planningDate: new Date(`${DAY_TWO}T00:00:00Z`),
      }),
    );
    await world.tripService.createGroup([OUT, BACK]);
  }

  async function route(tripId: string) {
    const ritten = (await actions.apiPricing(tripId))?.routeMatch ?? null;

    expect((await world.snapshotResponse(tripId))?.routeMatch ?? null).toEqual(ritten);

    return ritten;
  }

  const overStLines = (tripId: string) =>
    (world.storedSnapshot(tripId)?.items ?? []).filter((item) =>
      item.description.startsWith("Over ST"),
    );

  it("1. two active Trips in a manual group of two are priced as the Combination", async () => {
    await groupedPair();
    await actions.close(OUT);
    await actions.close(BACK);

    expect((await route(BACK))?.combinationRouteGroupId).toBe(COMBINATION_ID);
    expect(await actions.apiPricing(BACK)).toMatchObject(WITH_OVER_ST);
  });

  it("2/12. a CLOSED leg pairs with an OPEN partner; the OPEN one has no price", async () => {
    await groupedPair();
    await actions.close(BACK);

    expect(await route(BACK)).toMatchObject({
      combinationRouteGroupId: COMBINATION_ID,
      combinationMatch: "MATCHED",
      overSt: { applied: true },
    });
    expect(await actions.apiPricing(OUT)).toBeNull();
    expect(world.storedSnapshot(OUT)).toBeNull();
  });

  describe("a partner that is cancelled", () => {
    it("3/8/11. reprices the CLOSED leg: no Combination, no Over ST, no €70", async () => {
      await groupedPair();
      await actions.close(BACK);
      expect(overStLines(BACK)).toHaveLength(3);

      await world.tripService.changeStatus(OUT, { status: TripStatus.CANCELLED });

      expect(await route(BACK)).toMatchObject({
        combinationRouteGroupId: null,
        combinationMatch: "NO_PAIR",
        method: "NOT_FOUND",
        legs: [],
      });
      expect(overStLines(BACK)).toEqual([]);
      expect(await actions.apiPricing(BACK)).toMatchObject({ tarief: "0.00", backload: "50.00" });
      await actions.expectConsistent(BACK);
    });

    it("10. pairs again when the cancelled Trip is reopened", async () => {
      await groupedPair();
      await actions.close(BACK);
      await world.tripService.changeStatus(OUT, { status: TripStatus.CANCELLED });

      await world.tripService.changeStatus(OUT, { status: TripStatus.OPEN });

      expect((await route(BACK))?.combinationRouteGroupId).toBe(COMBINATION_ID);
      expect(await actions.apiPricing(BACK)).toMatchObject(WITH_OVER_ST);
      // 14. However often it left and came back: the €70 once.
      expect(actions.surcharges(BACK)).toHaveLength(1);
      // The reopened Trip itself stays without a price until it closes.
      expect(await actions.apiPricing(OUT)).toBeNull();
    });

    it("5/6. the other leg of the SAME document is never chosen once cancelled", async () => {
      await groupedPair(true);
      await actions.close(BACK);
      expect((await route(BACK))?.combinationMatch).toBe("MATCHED");

      await world.tripService.changeStatus(OUT, { status: TripStatus.CANCELLED });

      // Not as the document's leg, and not by the group-of-two fallback.
      expect(await route(BACK)).toMatchObject({ combinationMatch: "NO_PAIR", legs: [] });
    });
  });

  describe("a partner that is deleted", () => {
    it("9. reprices the CLOSED leg without the deleted partner", async () => {
      await groupedPair();
      await actions.close(OUT);
      await actions.close(BACK);

      await world.tripService.softDelete(OUT);

      expect(await route(BACK)).toMatchObject({ combinationMatch: "NO_PAIR", legs: [] });
      expect(actions.surcharges(BACK)).toEqual([]);
      expect(await actions.apiPricing(OUT)).toBeNull();
    });

    it("pairs again when the deleted partner is restored", async () => {
      await groupedPair();
      await actions.close(BACK);
      await world.tripService.softDelete(OUT);

      await world.tripService.restore(OUT);

      expect((await route(BACK))?.combinationRouteGroupId).toBe(COMBINATION_ID);
      expect(actions.surcharges(BACK)).toHaveLength(1);
    });
  });

  /**
   * 7. A group of three counts its ACTIVE members (owner's decision): with one
   * cancelled, the two that remain are a group of two — a deterministic pair,
   * still matched through the configured Combination.
   */
  describe("a group of three", () => {
    async function groupOfThree(): Promise<void> {
      await groupedPair();
      await world.tripService.removeFromGroup(OUT);
      await world.tripService.removeFromGroup(BACK);
      world.seed(
        buildTrip(THIRD, { pdfDocumentId: "pdf-third", destinationCity: "Kallo" }),
      );
      await world.tripService.createGroup([OUT, BACK, THIRD]);
    }

    it("has no pair while all three are active", async () => {
      await groupOfThree();
      await actions.close(BACK);

      expect((await route(BACK))?.combinationMatch).toBe("NO_PAIR");
    });

    it("pairs the two active members once the third is cancelled", async () => {
      await groupOfThree();
      await actions.close(BACK);

      await world.tripService.changeStatus(THIRD, { status: TripStatus.CANCELLED });

      expect(await route(BACK)).toMatchObject({
        combinationRouteGroupId: COMBINATION_ID,
        combinationMatch: "MATCHED",
      });
    });

    it("has no pair again when the third is reopened", async () => {
      await groupOfThree();
      await actions.close(BACK);
      await world.tripService.changeStatus(THIRD, { status: TripStatus.CANCELLED });

      await world.tripService.changeStatus(THIRD, { status: TripStatus.OPEN });

      expect((await route(BACK))?.combinationMatch).toBe("NO_PAIR");
      expect(overStLines(BACK)).toEqual([]);
    });
  });

  /** 13. A status change that moves no pair reprices no other Trip. */
  it("13. closing a Trip reprices nobody else's pair", async () => {
    await groupedPair();
    await actions.close(BACK);
    const before = world.storedSnapshot(BACK)!.calculatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));

    // OPEN → CLOSED: OUT is a partner before and after.
    await actions.close(OUT);

    expect(world.storedSnapshot(BACK)!.calculatedAt).toEqual(before);
  });
});
