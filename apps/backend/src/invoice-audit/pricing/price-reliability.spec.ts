import {
  CombinationMatchOutcome,
  Prisma,
  RouteMatchMethod,
  TripDirection,
} from "@prisma/client";

import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import type { RouteMatchView } from "../../trip-pricing/route-match-view";
import type { ManualPartnerFacts, ManualRouteFacts } from "./manual-route-facts.reader";
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
    selection: "AUTOMATIC" as const,
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
    reviewed: null,
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
    expect(assessPriceReliability(TRIP, pricing(), null)).toMatchObject({
      reliable: true,
      problem: null,
      route: { matchMethod: "EXACT", tripRoute: "Quay 869 → Zemst", pricedRoute: "Quay 869 → ZEMST" },
    });
  });

  /** A Trip never priced is not a Trip that costs nothing. */
  it("does not rely on a Trip that was never priced", () => {
    expect(assessPriceReliability(TRIP, null, null)).toMatchObject({
      reliable: false,
      problem: "NO_SNAPSHOT",
    });
  });

  it.each([
    [RouteMatchMethod.NOT_FOUND, "ROUTE_NOT_FOUND"],
    [RouteMatchMethod.AMBIGUOUS, "ROUTE_AMBIGUOUS"],
    [null, "METADATA_MISSING"],
  ])("does not rely on a route match of %s", (method, problem) => {
    expect(assessPriceReliability(TRIP, pricing({ method }), null)).toMatchObject({
      reliable: false,
      problem,
    });
  });

  /**
   * ── THE SYSTEM'S SUCCESSFUL MATCH DECIDES ─────────────────────────────────
   * A different spelling of the Trip's place and the priced place is not a
   * reason to doubt a route the matcher FOUND. The two roads are reported for
   * information only.
   */
  describe("a route the system matched", () => {
    /** The priced leg, as the snapshot recorded it. */
    const pricedOn = (destination: string, method: RouteMatchMethod) =>
      pricing({
        method,
        legs: [
          {
            legPosition: null,
            isPricedLeg: true,
            routePricingId: "route-1",
            departure: "Quay 869",
            destination,
            method,
          },
        ],
      });

    it("relies on Eindhout priced on LAAKDAL (EINDHOUT)", () => {
      const eindhout = { ...TRIP, destinationCity: "Eindhout" };

      expect(
        assessPriceReliability(eindhout, pricedOn("LAAKDAL (EINDHOUT)", RouteMatchMethod.NORMALIZED), null),
      ).toEqual({
        reliable: true,
        problem: null,
        explanation: null,
        route: {
          matchMethod: "NORMALIZED",
          tripRoute: "Quay 869 → Eindhout",
          pricedRoute: "Quay 869 → LAAKDAL (EINDHOUT)",
        },
      });
    });

    it("relies on Kallo priced on Kallo (Beveren)", () => {
      const kallo = { ...TRIP, destinationCity: "Kallo" };

      expect(
        assessPriceReliability(kallo, pricedOn("Kallo (Beveren)", RouteMatchMethod.NORMALIZED), null),
      ).toMatchObject({ reliable: true, problem: null });
    });

    /** Formerly refused as an unconfirmed place in brackets. */
    it("relies on any NORMALIZED match, however differently the names are spelled", () => {
      const beveren = { ...TRIP, destinationCity: "Beveren" };

      expect(
        assessPriceReliability(beveren, pricedOn("Kallo (Beveren)", RouteMatchMethod.NORMALIZED), null),
      ).toMatchObject({ reliable: true, problem: null });
    });

    /** The matcher records FUZZY only for one unique, uncontested candidate. */
    it("relies on a FUZZY match", () => {
      const typo = { ...TRIP, destinationCity: "Zemts" };

      expect(assessPriceReliability(typo, pricedOn("ZEMST", RouteMatchMethod.FUZZY), null)).toMatchObject({
        reliable: true,
      });
    });

    it("relies on a found route even when the snapshot recorded no leg to show", () => {
      expect(
        assessPriceReliability(TRIP, pricing({ method: RouteMatchMethod.NORMALIZED, legs: [] }), null),
      ).toMatchObject({ reliable: true, route: { pricedRoute: null } });
    });

    it("still shows both roads beside a route that was not found", () => {
      expect(
        assessPriceReliability(TRIP, pricedOn("ZEMST", RouteMatchMethod.NOT_FOUND), null),
      ).toMatchObject({
        reliable: false,
        problem: "ROUTE_NOT_FOUND",
        explanation: "Voor de rit is geen route gevonden.",
        route: { matchMethod: "NOT_FOUND", tripRoute: "Quay 869 → Zemst" },
      });
    });
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
          null,
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
        assessPriceReliability(grouped, pricing({ combinationMatch: outcome }, "50"), null),
      ).toMatchObject({ reliable: false, problem: "COMBINATION_NOT_PRICED" });
    });

    it("does not rely on a grouped Trip whose price records no Combination", () => {
      expect(assessPriceReliability(grouped, pricing(), null)).toMatchObject({
        reliable: false,
        problem: "SNAPSHOT_INCONSISTENT",
      });
    });

    /** The Backload follows membership: a Trip that left its group owes none. */
    it("does not rely on an ungrouped Trip still priced with a Backload", () => {
      expect(assessPriceReliability(TRIP, pricing({}, "50"), null)).toMatchObject({
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
          null,
        ),
      ).toMatchObject({ reliable: false, problem: "SNAPSHOT_INCONSISTENT" });
    });
  });

  /**
   * A route chosen by hand (owner, October 2026): the stored NOT_FOUND,
   * AMBIGUOUS or PAIR_NOT_CONFIGURED is why it was chosen, not a verdict on the
   * price. The snapshot must confirm the choice, the route must still exist,
   * the choice stored NOW must be the one it was priced on, and a chosen
   * Combination must be confirmed by its partner leg (owner, 20 October 2026).
   */
  describe("a route chosen by hand", () => {
    const manual = (overrides: Partial<RouteMatchView> = {}) =>
      pricing({ method: RouteMatchMethod.NOT_FOUND, selection: "MANUAL", reviewed: false, ...overrides });
    const GROUPED: AssessedTrip = { ...TRIP, tripGroupId: "group-1" };
    const twoLegs = [
      { legPosition: 1, isPricedLeg: true, routePricingId: "leg-1", departure: "Quay 869", destination: "Zemst", method: RouteMatchMethod.NOT_FOUND },
      { legPosition: 2, isPricedLeg: false, routePricingId: "leg-2", departure: "Zemst", destination: "Quay 869", method: RouteMatchMethod.NOT_FOUND },
    ];
    const chosenCombination = (overrides: Partial<RouteMatchView> = {}) =>
      manual({
        routePricingId: "leg-1",
        combinationRouteGroupId: "combination-1",
        combinationMatch: CombinationMatchOutcome.PAIR_NOT_CONFIGURED,
        legs: twoLegs,
        ...overrides,
      });
    /** The partner leg, chosen and priced on Leg 2 of the same Combination. */
    const partnerOnLeg2 = (overrides: Partial<RouteMatchView> = {}): ManualPartnerFacts => ({
      tripId: "partner",
      currentChoice: "leg-2",
      pricing: chosenCombination({
        routePricingId: "leg-2",
        legs: twoLegs.map((leg) => ({ ...leg, isPricedLeg: leg.routePricingId === "leg-2" })),
        ...overrides,
      }),
    });
    const facts = (currentChoice: string | null, partner: ManualPartnerFacts | null = null): ManualRouteFacts => ({
      currentChoice,
      partner,
    });

    it("1. relies on an ordinary route chosen after NOT_FOUND", () => {
      expect(assessPriceReliability(TRIP, manual(), facts("route-1"))).toMatchObject({ reliable: true, problem: null });
    });

    it("2. relies on an ordinary route chosen after AMBIGUOUS", () => {
      expect(
        assessPriceReliability(TRIP, manual({ method: RouteMatchMethod.AMBIGUOUS }), facts("route-1")),
      ).toMatchObject({ reliable: true, problem: null });
    });

    it("6. relies on a whole Combination confirmed by its partner leg", () => {
      expect(
        assessPriceReliability(GROUPED, chosenCombination(), facts("leg-1", partnerOnLeg2())),
      ).toMatchObject({ reliable: true, problem: null });
    });

    it("4. does not rely on a choice whose route no longer exists", () => {
      expect(assessPriceReliability(TRIP, manual({ reviewed: null }), facts(null))).toMatchObject({
        reliable: false,
        problem: "MANUAL_ROUTE_REMOVED",
      });
    });

    it("does not rely on a snapshot that records no route", () => {
      expect(assessPriceReliability(TRIP, manual({ routePricingId: null }), facts("route-1"))).toMatchObject({
        reliable: false,
        problem: "SNAPSHOT_INCONSISTENT",
      });
    });

    it("does not rely on an ordinary choice for a grouped Trip", () => {
      expect(assessPriceReliability(GROUPED, manual(), facts("route-1"))).toMatchObject({
        reliable: false,
        problem: "SNAPSHOT_INCONSISTENT",
      });
    });

    /*
     * 7. An explicit reprocess removed the choice, and its own pricing failed:
     * the snapshot still says MANUAL. The current situation decides — the old
     * choice is never used to vouch for it.
     */
    describe("7. a choice that is no longer stored", () => {
      it("does not rely on a snapshot whose choice was removed", () => {
        expect(assessPriceReliability(TRIP, manual(), facts(null))).toMatchObject({
          reliable: false,
          problem: "SNAPSHOT_INCONSISTENT",
          explanation: expect.stringContaining("gewist of gewijzigd"),
        });
      });

      it("does not rely on a snapshot priced on another route than the one chosen now", () => {
        expect(assessPriceReliability(TRIP, manual(), facts("route-2"))).toMatchObject({
          reliable: false,
          problem: "SNAPSHOT_INCONSISTENT",
        });
      });

      it("does not rely on a MANUAL snapshot when nothing about the choice was read", () => {
        expect(assessPriceReliability(TRIP, manual(), null)).toMatchObject({ reliable: false });
      });

      it("follows a snapshot the automatic matcher wrote after the choice was removed", () => {
        expect(assessPriceReliability(TRIP, pricing(), null)).toMatchObject({ reliable: true });
        expect(
          assessPriceReliability(TRIP, pricing({ method: RouteMatchMethod.NOT_FOUND }), null),
        ).toMatchObject({ reliable: false, problem: "ROUTE_NOT_FOUND" });
      });
    });

    describe("5. an incomplete or inconsistent chosen Combination", () => {
      it("does not rely on half a Combination", () => {
        expect(
          assessPriceReliability(
            GROUPED,
            chosenCombination({ legs: [twoLegs[0]] }),
            facts("leg-1", partnerOnLeg2()),
          ),
        ).toMatchObject({ reliable: false, problem: "SNAPSHOT_INCONSISTENT" });
      });

      it.each([
        ["two legs at the same position", twoLegs.map((leg) => ({ ...leg, legPosition: 1 }))],
        ["no leg marked as priced", twoLegs.map((leg) => ({ ...leg, isPricedLeg: false }))],
        ["both legs marked as priced", twoLegs.map((leg) => ({ ...leg, isPricedLeg: true }))],
        ["the priced leg not the route it was priced on", twoLegs.map((leg) => ({ ...leg, isPricedLeg: !leg.isPricedLeg }))],
      ])("does not rely on %s", (_name, legs) => {
        expect(
          assessPriceReliability(GROUPED, chosenCombination({ legs }), facts("leg-1", partnerOnLeg2())),
        ).toMatchObject({ reliable: false, problem: "SNAPSHOT_INCONSISTENT" });
      });

      it.each<[string, ManualPartnerFacts | null]>([
        ["no partner leg", null],
        ["a partner without a current price", { ...partnerOnLeg2(), pricing: null }],
        ["a partner whose choice was removed", { ...partnerOnLeg2(), currentChoice: null }],
        ["a partner chosen on the same leg", { ...partnerOnLeg2(), currentChoice: "leg-1" }],
        ["a partner priced on another Combination", partnerOnLeg2({ combinationRouteGroupId: "combination-2" })],
        ["a partner priced on the same leg", partnerOnLeg2({ routePricingId: "leg-1" })],
      ])("does not rely on %s", (_name, partner) => {
        expect(
          assessPriceReliability(GROUPED, chosenCombination(), facts("leg-1", partner)),
        ).toMatchObject({ reliable: false, problem: "COMBINATION_NOT_PRICED" });
      });
    });
  });
});
