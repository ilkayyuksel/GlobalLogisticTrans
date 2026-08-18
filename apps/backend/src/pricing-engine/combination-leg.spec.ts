import { TripDirection } from "@prisma/client";

import {
  CombinationLeg,
  CombinationMember,
  combinationLegOf,
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
 * ── A MANUAL GROUP IS NOT A COMBINATION ─────────────────────────────────────
 * An operator may group any Trips at all. That grouping carries no claim about
 * pairing, so each Trip in it stays an ordinary transport — and pays its own
 * charges.
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
