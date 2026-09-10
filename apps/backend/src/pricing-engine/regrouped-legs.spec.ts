import { TripDirection } from "@prisma/client";

import { CombinationMember, tripsWhoseLegChanged } from "./combination-leg";

/**
 * Which Trips a change of group membership re-classifies.
 *
 * Both sides of the comparison are `combinationLegOf`, so these tests pin the
 * DIFFERENCE, not a second definition of a Combination: a Trip is named when
 * its leg before the change is not its leg after it.
 */

const GROUP = "97777777-7777-4777-8777-777777777777";
const DOCUMENT = "pdf-1";

function member(
  id: string,
  overrides: Partial<CombinationMember> = {},
): CombinationMember {
  return { id, tripGroupId: null, pdfDocumentId: DOCUMENT, direction: null, ...overrides };
}

const DELIVERY = member("delivery", { direction: TripDirection.DELIVERY });
const COLLECTION = member("collection", { direction: TripDirection.COLLECTION });
const STRANGER = member("stranger", {
  pdfDocumentId: "pdf-2",
  direction: TripDirection.COLLECTION,
});

function grouped(...members: CombinationMember[]): CombinationMember[] {
  return members.map((trip) => ({ ...trip, tripGroupId: GROUP }));
}

describe("which legs a regrouping changes", () => {
  it("names both legs when one order's two legs are grouped", () => {
    expect(
      tripsWhoseLegChanged([DELIVERY, COLLECTION], grouped(DELIVERY, COLLECTION)),
    ).toEqual([DELIVERY.id, COLLECTION.id]);
  });

  it("names nobody when Trips of different orders are grouped", () => {
    expect(
      tripsWhoseLegChanged([DELIVERY, STRANGER], grouped(DELIVERY, STRANGER)),
    ).toEqual([]);
  });

  it("names only the pair when a genuine pair joins a larger manual group", () => {
    expect(
      tripsWhoseLegChanged(
        [DELIVERY, COLLECTION, STRANGER],
        grouped(DELIVERY, COLLECTION, STRANGER),
      ),
    ).toEqual([DELIVERY.id, COLLECTION.id]);
  });

  it("names both legs when one leg leaves a genuine pair", () => {
    const before = grouped(DELIVERY, COLLECTION);
    const after = [{ ...before[0], tripGroupId: null }, before[1]];

    expect(tripsWhoseLegChanged(before, after)).toEqual([
      DELIVERY.id,
      COLLECTION.id,
    ]);
  });

  it("names nobody when a stranger leaves a group that still holds the pair", () => {
    const before = grouped(DELIVERY, COLLECTION, STRANGER);
    const after = [before[0], before[1], { ...before[2], tripGroupId: null }];

    expect(tripsWhoseLegChanged(before, after)).toEqual([]);
  });

  /** NONE to INVALID is a change too: the Engine refuses to price INVALID. */
  it("names the legs of a malformed group, which the Engine will refuse", () => {
    const secondDelivery = member("delivery-2", {
      direction: TripDirection.DELIVERY,
    });

    expect(
      tripsWhoseLegChanged(
        [DELIVERY, secondDelivery],
        grouped(DELIVERY, secondDelivery),
      ),
    ).toEqual([DELIVERY.id, secondDelivery.id]);
  });

  it("does not depend on the order the Trips are listed in", () => {
    expect(
      tripsWhoseLegChanged(
        [COLLECTION, DELIVERY],
        grouped(DELIVERY, COLLECTION).reverse(),
      ).sort(),
    ).toEqual([COLLECTION.id, DELIVERY.id]);
  });
});
