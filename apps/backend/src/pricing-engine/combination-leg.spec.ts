import { TripDirection } from "@prisma/client";

import {
  CombinationLeg,
  CombinationMember,
  carriesCombinationSurcharge,
  combinationLegOf,
  pricingPartnerOf,
  tripsRepricedByRegrouping,
} from "./combination-leg";

/**
 * Telling a real Combination from a manual group.
 *
 * The distinction decides money — a Combination pays TAR once, two ordinary
 * Trips pay it twice — so these tests care most about the cases where the two
 * look alike: Trips sharing a group but not a document, and Trips sharing a
 * document whose pair is malformed.
 */

const GROUP = "97777777-7777-4777-8777-777777777777";
const DOCUMENT = "pdf-1";

function member(overrides: Partial<CombinationMember> = {}): CombinationMember {
  return {
    id: "trip-1",
    tripGroupId: null,
    pdfDocumentId: DOCUMENT,
    direction: null,
    status: "CLOSED",
    ...overrides,
  };
}

const DELIVERY = member({
  id: "trip-delivery",
  tripGroupId: GROUP,
  direction: TripDirection.DELIVERY,
});

const COLLECTION = member({
  id: "trip-collection",
  tripGroupId: GROUP,
  direction: TripDirection.COLLECTION,
});

describe("a genuine Combination", () => {
  const PAIR = [DELIVERY, COLLECTION];

  it("names the delivery leg", () => {
    expect(combinationLegOf(DELIVERY, PAIR)).toBe(CombinationLeg.DELIVERY);
  });

  it("names the collection leg", () => {
    expect(combinationLegOf(COLLECTION, PAIR)).toBe(CombinationLeg.COLLECTION);
  });

  /** Order is not evidence. The same pair, listed either way, reads the same. */
  it("does not depend on the order the legs are listed in", () => {
    const reversed = [COLLECTION, DELIVERY];

    expect(combinationLegOf(DELIVERY, reversed)).toBe(CombinationLeg.DELIVERY);
    expect(combinationLegOf(COLLECTION, reversed)).toBe(
      CombinationLeg.COLLECTION,
    );
  });
});

describe("an ordinary Trip", () => {
  it("belongs to no Combination when it has no group", () => {
    expect(combinationLegOf(member(), [member()])).toBe(CombinationLeg.NONE);
  });

  it("belongs to no Combination when it has no document", () => {
    const manual = member({ tripGroupId: GROUP, pdfDocumentId: null });

    expect(combinationLegOf(manual, [manual, COLLECTION])).toBe(
      CombinationLeg.NONE,
    );
  });
});

/**
 * ── A MANUAL GROUP IS NOT A PAIR ────────────────────────────────────────────
 * An operator may group any Trips at all. That grouping carries no claim about
 * pairing, so for TAR each Trip in it stays an ordinary transport. (It does
 * carry the Combination Surcharge — see below.)
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("a manual group", () => {
  it("is not a Combination when the Trips came from different documents", () => {
    const first = member({
      id: "trip-a",
      tripGroupId: GROUP,
      pdfDocumentId: "pdf-a",
      direction: TripDirection.DELIVERY,
    });
    const second = member({
      id: "trip-b",
      tripGroupId: GROUP,
      pdfDocumentId: "pdf-b",
      direction: TripDirection.COLLECTION,
    });

    // One of each direction, and still not a Combination: two documents.
    expect(combinationLegOf(first, [first, second])).toBe(CombinationLeg.NONE);
    expect(combinationLegOf(second, [first, second])).toBe(CombinationLeg.NONE);
  });

  it("is not a Combination when a document's leg is grouped with strangers", () => {
    const stranger = member({
      id: "trip-stranger",
      tripGroupId: GROUP,
      pdfDocumentId: "pdf-other",
      direction: null,
    });

    expect(combinationLegOf(COLLECTION, [COLLECTION, stranger])).toBe(
      CombinationLeg.NONE,
    );
  });
});

/**
 * The Trips of ONE document, grouped, but not one delivery and one collection.
 * No real transport order produces this, so it is reported rather than priced.
 */
describe("a malformed pair", () => {
  it("is invalid when both legs are collections", () => {
    const twin = member({
      id: "trip-twin",
      tripGroupId: GROUP,
      direction: TripDirection.COLLECTION,
    });

    expect(combinationLegOf(COLLECTION, [COLLECTION, twin])).toBe(
      CombinationLeg.INVALID,
    );
  });

  it("is invalid when a leg states no direction", () => {
    const directionless = member({
      id: "trip-directionless",
      tripGroupId: GROUP,
      direction: null,
    });

    expect(combinationLegOf(COLLECTION, [COLLECTION, directionless])).toBe(
      CombinationLeg.INVALID,
    );
  });

  it("is invalid when one document produced three grouped Trips", () => {
    const third = member({
      id: "trip-third",
      tripGroupId: GROUP,
      direction: TripDirection.COLLECTION,
    });

    expect(combinationLegOf(DELIVERY, [DELIVERY, COLLECTION, third])).toBe(
      CombinationLeg.INVALID,
    );
  });
});

/**
 * ── THE BACKLOAD FOLLOWS THE GROUP ──────────────────────────────────────────
 * Since September 2026 every Trip in a group carries its own Combination
 * Surcharge, manual group or imported Combination alike. The genuine rule above
 * decides TAR only.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the Combination Surcharge", () => {
  it("is carried by both legs of an imported Combination", () => {
    expect(carriesCombinationSurcharge(DELIVERY)).toBe(true);
    expect(carriesCombinationSurcharge(COLLECTION)).toBe(true);
  });

  it("is carried by every member of a manual group, whatever its document", () => {
    expect(
      carriesCombinationSurcharge(
        member({ tripGroupId: GROUP, pdfDocumentId: "pdf-other" }),
      ),
    ).toBe(true);
    expect(
      carriesCombinationSurcharge(member({ tripGroupId: GROUP, pdfDocumentId: null })),
    ).toBe(true);
  });

  it("is not carried by a Trip in no group", () => {
    expect(carriesCombinationSurcharge(member())).toBe(false);
  });
});

describe("which Trips a regrouping reprices", () => {
  const A = member({ id: "a", pdfDocumentId: "pdf-a" });
  const B = member({ id: "b", pdfDocumentId: "pdf-b" });
  const grouped = (trip: CombinationMember) => ({ ...trip, tripGroupId: GROUP });

  it("reprices every Trip that joins a group", () => {
    expect(
      tripsRepricedByRegrouping([A, B], [grouped(A), grouped(B)]).sort(),
    ).toEqual(["a", "b"]);
  });

  /** The member left behind keeps its group, and with it its surcharge. */
  /**
   * October 2026: a group of two is a pricing pair. The member left behind
   * keeps its group and its Backload, but no longer has a pair its route price
   * could be matched on — so it is repriced too.
   */
  it("reprices the Trip taken out of a group of two, and the one left behind", () => {
    const before = [grouped(A), grouped(B)];

    expect(tripsRepricedByRegrouping(before, [A, grouped(B)]).sort()).toEqual(["a", "b"]);
  });

  it("reprices only the Trip taken out when the group keeps no pair either way", () => {
    const C = { ...B, id: "c" };
    const D = { ...B, id: "d" };
    const before = [grouped(A), grouped(B), grouped(C), grouped(D)];

    expect(
      tripsRepricedByRegrouping(before, [A, grouped(B), grouped(C), grouped(D)]),
    ).toEqual(["a"]);
  });

  /** One leg leaves; the other stays grouped but is no longer a leg for TAR. */
  it("reprices both legs when a genuine pair is split", () => {
    const after = [{ ...DELIVERY, tripGroupId: null }, COLLECTION];

    expect(
      tripsRepricedByRegrouping([DELIVERY, COLLECTION], after).sort(),
    ).toEqual(["trip-collection", "trip-delivery"]);
  });

  it("reprices nothing when nothing changed", () => {
    expect(
      tripsRepricedByRegrouping([DELIVERY, COLLECTION], [DELIVERY, COLLECTION]),
    ).toEqual([]);
  });
});

describe("what must never decide the leg", () => {
  /*
   * Only the group, the document and the direction are read. Nothing else on a
   * Trip may change the answer — a date or a row position least of all.
   */
  it("ignores everything except the group, the document and the direction", () => {
    const pair = [DELIVERY, COLLECTION];

    expect(combinationLegOf({ ...DELIVERY, id: "renamed" }, pair)).toBe(
      CombinationLeg.DELIVERY,
    );
  });
});

/**
 * ── WHICH TRIP IS A GROUPED TRIP'S PRICING PARTNER (OCTOBER 2026) ───────────
 * Only a candidate: the pair match decides whether the pair IS a Combination.
 */
describe("the pricing partner", () => {
  const STRANGER = member({ id: "trip-stranger", tripGroupId: GROUP, pdfDocumentId: "pdf-2" });

  it("is the other leg of a genuine pair from one document", () => {
    expect(pricingPartnerOf(DELIVERY, [DELIVERY, COLLECTION])).toEqual({
      kind: "PAIRED",
      partner: COLLECTION,
      basis: "SAME_DOCUMENT",
    });
  });

  /** A genuine pair stays a pair whatever else an operator added to the group. */
  it("is still the genuine leg in a larger group", () => {
    expect(pricingPartnerOf(DELIVERY, [DELIVERY, COLLECTION, STRANGER])).toMatchObject({
      partner: COLLECTION,
      basis: "SAME_DOCUMENT",
    });
  });

  it("is the other member of a group of two from another document", () => {
    expect(pricingPartnerOf(DELIVERY, [DELIVERY, STRANGER])).toEqual({
      kind: "PAIRED",
      partner: STRANGER,
      basis: "TWO_TRIP_GROUP",
    });
  });

  /** Direction and document do not filter a group of two: the pair match will. */
  it("is the other member of a group of two even in the same direction", () => {
    const secondDelivery = { ...STRANGER, direction: TripDirection.DELIVERY };

    expect(pricingPartnerOf(DELIVERY, [DELIVERY, secondDelivery])).toMatchObject({
      kind: "PAIRED",
      basis: "TWO_TRIP_GROUP",
    });
  });

  it("does not exist in a larger group with no genuine pair", () => {
    const third = { ...STRANGER, id: "trip-third", pdfDocumentId: "pdf-3" };

    expect(pricingPartnerOf(STRANGER, [DELIVERY, STRANGER, third])).toEqual({
      kind: "UNPAIRED",
      reason: "NO_UNAMBIGUOUS_PARTNER",
    });
  });

  it("does not exist for a Trip left alone in its group, or in none", () => {
    expect(pricingPartnerOf(DELIVERY, [DELIVERY])).toEqual({
      kind: "UNPAIRED",
      reason: "NO_UNAMBIGUOUS_PARTNER",
    });
    expect(pricingPartnerOf(member(), [])).toEqual({ kind: "UNPAIRED", reason: "NOT_GROUPED" });
  });

  /** TAR allocation keeps its own rule: a manual pair is no genuine leg. */
  it("leaves the TAR leg rule untouched", () => {
    expect(combinationLegOf(DELIVERY, [DELIVERY, STRANGER])).toBe(CombinationLeg.NONE);
  });
});

/**
 * ── ONLY OPEN AND CLOSED TRIPS ARE PRICING PARTNERS (OCTOBER 2026) ──────────
 * Filtered out BEFORE any rule reads the group, so no fallback can pick one.
 */
describe("the pricing partner by status", () => {
  const STRANGER = member({ id: "trip-stranger", tripGroupId: GROUP, pdfDocumentId: "pdf-2" });

  it.each(["CANCELLED", "DELETED"] as const)(
    "never pairs with a %s leg of the same document, nor by the fallback",
    (status) => {
      expect(pricingPartnerOf(DELIVERY, [DELIVERY, { ...COLLECTION, status }])).toEqual({
        kind: "UNPAIRED",
        reason: "NO_UNAMBIGUOUS_PARTNER",
      });
    },
  );

  it.each(["CANCELLED", "DELETED"] as const)(
    "never pairs with a %s member of a group of two",
    (status) => {
      expect(pricingPartnerOf(DELIVERY, [DELIVERY, { ...STRANGER, status }]).kind).toBe(
        "UNPAIRED",
      );
    },
  );

  it("pairs with an OPEN partner", () => {
    expect(
      pricingPartnerOf(DELIVERY, [DELIVERY, { ...COLLECTION, status: "OPEN" }]),
    ).toMatchObject({ kind: "PAIRED", basis: "SAME_DOCUMENT" });
  });

  /** The owner's decision: a group counts its ACTIVE members. */
  it("counts a group of three with one cancelled as a group of two", () => {
    const third = { ...STRANGER, id: "trip-third", pdfDocumentId: "pdf-3", status: "CANCELLED" as const };

    expect(pricingPartnerOf(DELIVERY, [DELIVERY, STRANGER, third])).toEqual({
      kind: "PAIRED",
      partner: STRANGER,
      basis: "TWO_TRIP_GROUP",
    });
  });

  /** A cancelled genuine leg: the remaining stranger becomes the pair of two. */
  it("falls to the group of two only among ACTIVE members", () => {
    const cancelledLeg = { ...COLLECTION, status: "CANCELLED" as const };

    expect(pricingPartnerOf(DELIVERY, [DELIVERY, cancelledLeg, STRANGER])).toMatchObject({
      partner: STRANGER,
      basis: "TWO_TRIP_GROUP",
    });
  });

  it("names the CLOSED partner of a Trip that is cancelled as repriced", () => {
    const before = [{ ...DELIVERY, status: "OPEN" as const }, COLLECTION];
    const after = [{ ...DELIVERY, status: "CANCELLED" as const }, COLLECTION];

    // The partner lost its pair; the cancelled Trip itself is never priced.
    expect(tripsRepricedByRegrouping(before, after)).toEqual(["trip-collection"]);
  });

  it("names no one when a status change keeps every pair", () => {
    const before = [{ ...DELIVERY, status: "OPEN" as const }, COLLECTION];
    const after = [DELIVERY, COLLECTION];

    expect(tripsRepricedByRegrouping(before, after)).toEqual([]);
  });

  /** TAR allocation keeps its own, status-blind rule. */
  it("leaves the TAR leg rule untouched", () => {
    expect(combinationLegOf(DELIVERY, [DELIVERY, { ...COLLECTION, status: "CANCELLED" }])).toBe(
      CombinationLeg.DELIVERY,
    );
  });
});
