import { Prisma, TripDirection } from "@prisma/client";

import { reliablyPriced } from "../__fixtures__/invoice-pricing";
import { tripRecord } from "../__fixtures__/invoice-rows";
import type { TripRemarkFacts } from "../remarks/remark-plan";
import { planAddedRows } from "./added-rows";
import type { MissingTrip } from "./missing-trips.service";

const zero = new Prisma.Decimal(0);
const PRICED = reliablyPriced({
  components: [],
  tarief: new Prisma.Decimal("200"),
  brandstof: zero,
  backload: zero,
  tol: zero,
  tunnel: zero,
  others: zero,
  ek: zero,
  totaal: new Prisma.Decimal("200"),
});

function missing(
  id: string,
  overrides: { tripGroupId?: string | null; direction?: TripDirection; priced?: boolean } = {},
): MissingTrip {
  return {
    trip: tripRecord({
      id,
      tripGroupId: overrides.tripGroupId ?? null,
      direction: overrides.direction ?? TripDirection.DELIVERY,
    }),
    pricing: overrides.priced === false ? null : PRICED,
    route: "Quay 869 -> MELSELE",
  };
}

function facts(overrides: Partial<TripRemarkFacts> = {}): TripRemarkFacts {
  return { propertyNames: [], tarCharged: false, ccNumbers: [], waiting: null, ...overrides };
}

describe("planAddedRows", () => {
  describe("the COMBINATION marker", () => {
    it("marks the Endpoint of a leg out of the terminal in a group of two", () => {
      const [row] = planAddedRows(
        [missing("a", { tripGroupId: "g", direction: TripDirection.DELIVERY })],
        new Map(),
        new Map([["g", 2]]),
      );

      expect(row.combinationEnd).toBe("endPoint");
    });

    it("marks the Startpoint of a leg back to the terminal in a group of two", () => {
      const [row] = planAddedRows(
        [missing("a", { tripGroupId: "g", direction: TripDirection.COLLECTION })],
        new Map(),
        new Map([["g", 2]]),
      );

      expect(row.combinationEnd).toBe("startPoint");
    });

    it("marks nothing for a group that is not exactly two", () => {
      const [row] = planAddedRows(
        [missing("a", { tripGroupId: "g" })],
        new Map(),
        new Map([["g", 3]]),
      );

      expect(row.combinationEnd).toBeNull();
    });

    it("marks nothing for a Trip in no group", () => {
      expect(planAddedRows([missing("a")], new Map(), new Map())[0].combinationEnd).toBeNull();
    });
  });

  it("puts two missing legs of one Combination together, the leg out first", () => {
    const rows = planAddedRows(
      [
        missing("back", { tripGroupId: "g", direction: TripDirection.COLLECTION }),
        missing("other"),
        missing("out", { tripGroupId: "g", direction: TripDirection.DELIVERY }),
      ],
      new Map(),
      new Map([["g", 2]]),
    );

    expect(rows.map((row) => row.trip.id)).toEqual(["out", "back", "other"]);
  });

  it("writes the Remarks in the customer's words", () => {
    const [row] = planAddedRows(
      [missing("a")],
      new Map([["a", facts({ propertyNames: ["Flat"], tarCharged: true, ccNumbers: ["4220981"] })]]),
      new Map(),
    );

    expect(row.remarks).toBe("flat,tar,EC 4220981");
    expect(row.reliability.reliable).toBe(true);
  });

  /*
   * The properties and TAR are what the stored price charged; a price nobody
   * stands behind cannot say that. The confirmation is simply held.
   */
  it("names no property and no tar for a Trip whose price cannot be relied on", () => {
    const [row] = planAddedRows(
      [missing("a", { priced: false })],
      new Map([["a", facts({ propertyNames: ["Flat"], tarCharged: true, ccNumbers: ["4220981"] })]]),
      new Map(),
    );

    expect(row.remarks).toBe("EC 4220981");
    expect(row.reliability.reliable).toBe(false);
  });
});
