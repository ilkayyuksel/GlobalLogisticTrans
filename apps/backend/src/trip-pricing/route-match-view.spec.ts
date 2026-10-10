import { Prisma } from "@prisma/client";

import { toRouteMatchDto } from "./dto/route-match.dto";
import { toRouteMatchView, type StoredRouteMatch } from "./route-match-view";

/**
 * What a stored price says about its route — from the snapshot alone.
 */
function line(code: string, description: string, amount: string) {
  return {
    pricingComponent: { code },
    description,
    amount: new Prisma.Decimal(amount),
  };
}

const ORDINARY_LEG = {
  legPosition: null,
  isPricedLeg: true,
  routePricingId: "route-1",
  departure: "Quay 869",
  destination: "Ghlin",
  matchMethod: "EXACT" as const,
};

function stored(overrides: Partial<StoredRouteMatch> = {}): StoredRouteMatch {
  return {
    routeMatch: "EXACT",
    routePricingId: "route-1",
    combinationRouteGroupId: null,
    routeLegs: [ORDINARY_LEG],
    items: [line("BASE_PRICE", "Quay 869 - Ghlin", "200.00")],
    ...overrides,
  };
}

describe("the route a stored price was matched to", () => {
  it("names the ordinary route as it was configured, and how it matched", () => {
    expect(toRouteMatchDto(toRouteMatchView(stored()))).toEqual({
      method: "EXACT",
      routePricingId: "route-1",
      combinationRouteGroupId: null,
      legs: [
        {
          legPosition: null,
          isPricedLeg: true,
          routePricingId: "route-1",
          departure: "Quay 869",
          destination: "Ghlin",
          method: "EXACT",
        },
      ],
      overSt: null,
    });
  });

  /** Four different facts, never one another. */
  describe("telling the zero prices apart", () => {
    it("NOT_FOUND: no route, no configuration", () => {
      const view = toRouteMatchView(
        stored({ routeMatch: "NOT_FOUND", routePricingId: null, routeLegs: [] }),
      );

      expect(view).toMatchObject({ method: "NOT_FOUND", routePricingId: null, legs: [] });
    });

    it("AMBIGUOUS: no route chosen between candidates", () => {
      const view = toRouteMatchView(
        stored({ routeMatch: "AMBIGUOUS", routePricingId: null, routeLegs: [] }),
      );

      expect(view).toMatchObject({ method: "AMBIGUOUS", routePricingId: null, legs: [] });
    });

    it("not recorded: an older snapshot says so instead of guessing", () => {
      const view = toRouteMatchView(
        stored({ routeMatch: null, routePricingId: null, routeLegs: [] }),
      );

      expect(view).toMatchObject({ method: null, routePricingId: null, legs: [] });
    });

    it("a configured route at zero: matched, with its configuration", () => {
      const view = toRouteMatchView(
        stored({ items: [line("BASE_PRICE", "Quay 869 - Ghlin", "0.00")] }),
      );

      expect(view).toMatchObject({ method: "EXACT", routePricingId: "route-1" });
      expect(view.legs).toHaveLength(1);
    });
  });

  describe("a Combination", () => {
    const LEGS = [
      { ...ORDINARY_LEG, legPosition: 2, isPricedLeg: true, routePricingId: "leg-2", departure: "Mons", destination: "Quay 869" },
      { ...ORDINARY_LEG, legPosition: 1, isPricedLeg: false, routePricingId: "leg-1" },
    ];

    it("names both legs, Leg 1 first, and the selected Combination", () => {
      const view = toRouteMatchView(
        stored({ combinationRouteGroupId: "combination-1", routePricingId: "leg-2", routeLegs: LEGS }),
      );

      expect(view.combinationRouteGroupId).toBe("combination-1");
      expect(view.legs.map((leg) => [leg.legPosition, leg.routePricingId, leg.isPricedLeg])).toEqual([
        [1, "leg-1", false],
        [2, "leg-2", true],
      ]);
    });

    it("reads the Over ST the calculation applied from its own lines", () => {
      const view = toRouteMatchView(
        stored({
          combinationRouteGroupId: "combination-1",
          routeLegs: LEGS,
          items: [
            line("BASE_PRICE", "Mons - Quay 869", "120.00"),
            line("BASE_PRICE", "Over ST", "40.00"),
            line("BASE_PRICE", "Over ST toeslag", "70.00"),
            line("TOLL", "Over ST", "10.00"),
          ],
        }),
      );

      expect(toRouteMatchDto(view).overSt).toEqual({
        applied: true,
        tarief: "40.00",
        toll: "10.00",
        tunnel: "0.00",
        surcharge: "70.00",
      });
    });

    it("says Over ST was not applied when the calculation wrote none", () => {
      const view = toRouteMatchView(
        stored({ combinationRouteGroupId: "combination-1", routeLegs: LEGS }),
      );

      expect(toRouteMatchDto(view).overSt).toEqual({
        applied: false,
        tarief: "0.00",
        toll: "0.00",
        tunnel: "0.00",
        surcharge: "0.00",
      });
    });

    /** Every Over ST amount configured as zero: only the surcharge line exists. */
    it("counts the surcharge alone as Over ST applied", () => {
      const view = toRouteMatchView(
        stored({
          combinationRouteGroupId: "combination-1",
          routeLegs: LEGS,
          items: [line("BASE_PRICE", "Over ST toeslag", "70.00")],
        }),
      );

      expect(view.overSt?.applied).toBe(true);
    });
  });

  it("says nothing about Over ST for an ordinary route", () => {
    expect(toRouteMatchView(stored()).overSt).toBeNull();
  });
});
