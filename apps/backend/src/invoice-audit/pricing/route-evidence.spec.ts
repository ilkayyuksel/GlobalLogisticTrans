import { RouteMatchMethod, TripDirection } from "@prisma/client";

import type { RouteMatchView } from "../../trip-pricing/route-match-view";
import { assessRouteEvidence } from "./route-evidence";

/**
 * What a stored snapshot proves about the road a Trip was priced on.
 *
 * Every case is a pair of RECORDED names — the Trip's own road and the road the
 * snapshot priced it on — exactly as the owner would see them side by side. No
 * matcher runs here.
 */

const delivery = (city: string, terminal = "Quay 869") => ({
  direction: TripDirection.DELIVERY,
  terminal,
  destinationCity: city,
});

const collection = (city: string, terminal = "Quay 869") => ({
  direction: TripDirection.COLLECTION,
  terminal,
  destinationCity: city,
});

function pricedOn(
  departure: string,
  destination: string,
  method: RouteMatchView["method"] = RouteMatchMethod.NORMALIZED,
): RouteMatchView {
  return {
    method,
    routePricingId: "route-1",
    combinationRouteGroupId: null,
    combinationMatch: null,
    legs: [
      {
        legPosition: null,
        isPricedLeg: true,
        routePricingId: "route-1",
        departure,
        destination,
        method: method ?? RouteMatchMethod.NORMALIZED,
      },
    ],
    overSt: null,
  };
}

describe("assessRouteEvidence", () => {
  describe("the safe normalisations stay usable", () => {
    it("accepts the same road after letter case and spacing", () => {
      expect(
        assessRouteEvidence(delivery("ANTWERPEN"), pricedOn("Quay 869", "Antwerpen")),
      ).toMatchObject({ relation: "SAME_ROAD", reliable: true });
    });

    it("accepts a confirmed city alias", () => {
      expect(
        assessRouteEvidence(delivery("Antwerp"), pricedOn("Quay 869", "Antwerpen")),
      ).toMatchObject({ relation: "SAME_ROAD", reliable: true });
    });

    it("accepts a terminal written the PSA way", () => {
      expect(
        assessRouteEvidence(collection("Ieper", "PSA Quay 869"), pricedOn("IEPER", "Quay 869")),
      ).toMatchObject({ relation: "SAME_ROAD", reliable: true });
    });

    /** `Kallo` is `Kallo (Beveren)`: the qualifier on one side only. */
    it("accepts a qualifier given on one side only", () => {
      expect(
        assessRouteEvidence(delivery("Kallo"), pricedOn("Quay 869", "Kallo (Beveren)")),
      ).toMatchObject({ relation: "OPTIONAL_QUALIFIER", reliable: true });
    });
  });

  describe("the place in brackets", () => {
    /** The owner's confirmation of 15 October 2026, in both directions. */
    it("accepts Rumbeke priced on ROESELARE (RUMBEKE)", () => {
      expect(
        assessRouteEvidence(delivery("Rumbeke"), pricedOn("Quay 869", "ROESELARE (RUMBEKE)")),
      ).toMatchObject({ relation: "APPROVED_BRACKETED_PLACE", reliable: true });
    });

    it("accepts ROESELARE (RUMBEKE) priced on Rumbeke", () => {
      expect(
        assessRouteEvidence(delivery("Roeselare (Rumbeke)"), pricedOn("Quay 869", "Rumbeke")),
      ).toMatchObject({ relation: "APPROVED_BRACKETED_PLACE", reliable: true });
    });

    /** The reverse convention: the MUNICIPALITY is in the brackets. */
    it("does not rely on Beveren priced on Kallo (Beveren), and shows both roads", () => {
      expect(
        assessRouteEvidence(delivery("Beveren"), pricedOn("Quay 869", "Kallo (Beveren)")),
      ).toEqual({
        relation: "UNCONFIRMED_BRACKETED_PLACE",
        reliable: false,
        tripRoute: "Quay 869 → Beveren",
        pricedRoute: "Quay 869 → Kallo (Beveren)",
      });
    });

    it("does not rely on Muizen priced on MECHELEN (MUIZEN)", () => {
      expect(
        assessRouteEvidence(collection("Muizen"), pricedOn("MECHELEN (MUIZEN)", "Quay 869")),
      ).toMatchObject({ relation: "UNCONFIRMED_BRACKETED_PLACE", reliable: false });
    });

    it("does not take Rumbeke's confirmation for another bracket of Roeselare", () => {
      expect(
        assessRouteEvidence(delivery("Oekene"), pricedOn("Quay 869", "ROESELARE (OEKENE)")),
      ).toMatchObject({ reliable: false });
    });
  });

  describe("what cannot be shown", () => {
    it("does not rely on two unrelated names", () => {
      expect(
        assessRouteEvidence(delivery("Zemst"), pricedOn("Quay 869", "Mechelen")),
      ).toMatchObject({ relation: "NOT_EXPLAINED", reliable: false });
    });

    it("does not rely on a road priced from another terminal", () => {
      expect(
        assessRouteEvidence(delivery("Kallo"), pricedOn("MPET 1742", "Kallo (Beveren)")),
      ).toMatchObject({ relation: "NOT_EXPLAINED", reliable: false });
    });

    it("does not rely on a snapshot that recorded no road", () => {
      expect(
        assessRouteEvidence(delivery("Zemst"), { ...pricedOn("Quay 869", "Zemst"), legs: [] }),
      ).toMatchObject({ relation: "NO_LEG_RECORDED", reliable: false, pricedRoute: null });
    });

    it("does not rely on a Trip without a city", () => {
      expect(
        assessRouteEvidence(
          { direction: TripDirection.DELIVERY, terminal: "Quay 869", destinationCity: null },
          pricedOn("Quay 869", "Zemst"),
        ),
      ).toMatchObject({ relation: "NO_TRIP_ROAD", reliable: false });
    });
  });

  describe("a Combination", () => {
    /** Only the leg that priced THIS Trip is its road. */
    it("reads the priced leg, not its partner", () => {
      const combination: RouteMatchView = {
        ...pricedOn("Quay 869", "Kallo (Beveren)"),
        legs: [
          {
            legPosition: 1,
            isPricedLeg: false,
            routePricingId: "leg-1",
            departure: "Quay 869",
            destination: "Kallo (Beveren)",
            method: RouteMatchMethod.NORMALIZED,
          },
          {
            legPosition: 2,
            isPricedLeg: true,
            routePricingId: "leg-2",
            departure: "IEPER",
            destination: "Quay 869",
            method: RouteMatchMethod.NORMALIZED,
          },
        ],
      };

      expect(assessRouteEvidence(collection("Ieper"), combination)).toMatchObject({
        relation: "SAME_ROAD",
        reliable: true,
        pricedRoute: "IEPER → Quay 869",
      });
    });
  });

  describe("EXACT and FUZZY", () => {
    it("relies on an exact match without looking further", () => {
      expect(
        assessRouteEvidence(delivery("Zemst"), pricedOn("Quay 869", "ZEMST", RouteMatchMethod.EXACT)),
      ).toMatchObject({ relation: "EXACT", reliable: true });
    });

    /** The matcher returns FUZZY only for one uncontested road. */
    it("relies on a fuzzy match, and still shows both roads", () => {
      expect(
        assessRouteEvidence(delivery("Zemts"), pricedOn("Quay 869", "ZEMST", RouteMatchMethod.FUZZY)),
      ).toEqual({
        relation: "FUZZY",
        reliable: true,
        tripRoute: "Quay 869 → Zemts",
        pricedRoute: "Quay 869 → ZEMST",
      });
    });
  });
});
