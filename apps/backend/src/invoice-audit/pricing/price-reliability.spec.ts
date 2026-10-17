import {
  CombinationMatchOutcome,
  Prisma,
  RouteMatchMethod,
  TripDirection,
} from "@prisma/client";

import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import type { RouteMatchView } from "../../trip-pricing/route-match-view";
import { assessPriceReliability, type AssessedTrip } from "./price-reliability";

/**
 * Whether a Trip's stored price may be used on the customer's invoice.
 *
 * Every unreliable case here is one the OLD check would have used: a zero for a
 * route that was never found, a Combination price for a Trip no longer
 * grouped. Each must now be refused, with a reason a person can read.
 */

const zero = new Prisma.Decimal(0);

const TRIP: AssessedTrip = {
  direction: TripDirection.DELIVERY,
  terminal: "Quay 869",
  destinationCity: "Zemst",
  tripGroupId: null,
};

function routeMatch(overrides: Partial<RouteMatchView> = {}): RouteMatchView {
  return {
    method: RouteMatchMethod.EXACT,
    routePricingId: "route-1",
    combinationRouteGroupId: null,
    combinationMatch: null,
    legs: [
      {
        legPosition: null,
        isPricedLeg: true,
        routePricingId: "route-1",
        departure: "Quay 869",
        destination: "ZEMST",
        method: RouteMatchMethod.EXACT,
      },
    ],
    overSt: null,
    ...overrides,
  };
}

function pricing(
  match: Partial<RouteMatchView> = {},
  backload: string = "0",
): CurrentTripPricing {
  return {
    components: [],
    tarief: new Prisma.Decimal("105"),
    brandstof: zero,
    backload: new Prisma.Decimal(backload),
    tol: zero,
    tunnel: zero,
    others: zero,
    ek: zero,
    totaal: new Prisma.Decimal("105"),
    routeMatch: routeMatch(match),
  };
}

describe("assessPriceReliability", () => {
  it("relies on a price found on an exact route", () => {
    expect(assessPriceReliability(TRIP, pricing())).toMatchObject({
      reliable: true,
      problem: null,
      evidence: { relation: "EXACT" },
    });
  });

  /** A Trip never priced is not a Trip that costs nothing. */
  it("does not rely on a Trip that was never priced", () => {
    expect(assessPriceReliability(TRIP, null)).toMatchObject({
      reliable: false,
      problem: "NO_SNAPSHOT",
    });
  });

  it.each([
    [RouteMatchMethod.NOT_FOUND, "ROUTE_NOT_FOUND"],
    [RouteMatchMethod.AMBIGUOUS, "ROUTE_AMBIGUOUS"],
    [null, "METADATA_MISSING"],
  ])("does not rely on a route match of %s", (method, problem) => {
    expect(assessPriceReliability(TRIP, pricing({ method }))).toMatchObject({
      reliable: false,
      problem,
    });
  });

  it("does not rely on a route the stored data does not show to be the Trip's", () => {
    const beveren = { ...TRIP, destinationCity: "Beveren" };
    const result = assessPriceReliability(
      beveren,
      pricing({
        method: RouteMatchMethod.NORMALIZED,
        legs: [
          {
            legPosition: null,
            isPricedLeg: true,
            routePricingId: "route-1",
            departure: "Quay 869",
            destination: "Kallo (Beveren)",
            method: RouteMatchMethod.NORMALIZED,
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      reliable: false,
      problem: "ROUTE_NOT_EVIDENCED",
      evidence: {
        relation: "UNCONFIRMED_BRACKETED_PLACE",
        tripRoute: "Quay 869 → Beveren",
        pricedRoute: "Quay 869 → Kallo (Beveren)",
      },
    });
    expect(result.explanation).toContain("Kallo (Beveren)");
  });

  describe("the Trip's group", () => {
    const grouped = { ...TRIP, tripGroupId: "group-1" };

    it("relies on a grouped Trip priced on its Combination", () => {
      expect(
        assessPriceReliability(
          grouped,
          pricing(
            {
              combinationMatch: CombinationMatchOutcome.MATCHED,
              combinationRouteGroupId: "combination-1",
            },
            "50",
          ),
        ),
      ).toMatchObject({ reliable: true });
    });

    it.each([
      CombinationMatchOutcome.PAIR_NOT_CONFIGURED,
      CombinationMatchOutcome.LEG_NOT_IDENTIFIED,
      CombinationMatchOutcome.AMBIGUOUS,
      CombinationMatchOutcome.NO_PAIR,
    ])("does not rely on a grouped Trip whose Combination came out %s", (outcome) => {
      expect(
        assessPriceReliability(grouped, pricing({ combinationMatch: outcome }, "50")),
      ).toMatchObject({ reliable: false, problem: "COMBINATION_NOT_PRICED" });
    });

    it("does not rely on a grouped Trip whose price records no Combination", () => {
      expect(assessPriceReliability(grouped, pricing())).toMatchObject({
        reliable: false,
        problem: "SNAPSHOT_INCONSISTENT",
      });
    });

    /** The Backload follows membership: a Trip that left its group owes none. */
    it("does not rely on an ungrouped Trip still priced with a Backload", () => {
      expect(assessPriceReliability(TRIP, pricing({}, "50"))).toMatchObject({
        reliable: false,
        problem: "SNAPSHOT_INCONSISTENT",
      });
    });

    it("does not rely on an ungrouped Trip priced on a Combination", () => {
      expect(
        assessPriceReliability(
          TRIP,
          pricing({
            combinationMatch: CombinationMatchOutcome.MATCHED,
            combinationRouteGroupId: "combination-1",
          }),
        ),
      ).toMatchObject({ reliable: false, problem: "SNAPSHOT_INCONSISTENT" });
    });
  });
});
