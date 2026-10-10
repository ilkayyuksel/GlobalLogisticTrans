import { render, screen, within } from "@testing-library/react";

import { PricingCells } from "@/components/ritten/pricing-cells";
import type { EffectivePricing, RouteMatch } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { RouteMatchSection } from "./route-match-section";

/**
 * Which configured route a stored price came from, where the price is read.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   1. the route shown is the RECORDED one — the configured road as the
 *      backend stored it, in its driving direction, with how it matched;
 *   2. a Combination names both legs, marks this Trip's, and shows the Over ST
 *      the calculation applied, the €70 surcharge included;
 *   3. NOT_FOUND, AMBIGUOUS and "not recorded" are never shown as a route —
 *      a missing configuration never reads as a configured route at zero.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ORDINARY: RouteMatch = {
  method: "NORMALIZED",
  routePricingId: "route-1",
  combinationRouteGroupId: null,
  legs: [
    {
      legPosition: null,
      isPricedLeg: true,
      routePricingId: "route-1",
      departure: "Quay 869",
      destination: "Ghlin",
      method: "NORMALIZED",
    },
  ],
  overSt: null,
};

const COMBINATION: RouteMatch = {
  method: "FUZZY",
  routePricingId: "leg-2",
  combinationRouteGroupId: "combination-1",
  legs: [
    {
      legPosition: 2,
      isPricedLeg: true,
      routePricingId: "leg-2",
      departure: "Charleroi",
      destination: "Quay 869",
      method: "FUZZY",
    },
    {
      legPosition: 1,
      isPricedLeg: false,
      routePricingId: "leg-1",
      departure: "Quay 869",
      destination: "Ghlin",
      method: "EXACT",
    },
  ],
  overSt: { applied: true, tarief: "40.00", toll: "10.00", tunnel: "0.00", surcharge: "70.00" },
};

const NO_ROUTE = { routePricingId: null, combinationRouteGroupId: null, legs: [], overSt: null };

function renderSection(routeMatch: RouteMatch) {
  render(
    <ThemeProvider>
      <LanguageProvider>
        <RouteMatchSection routeMatch={routeMatch} />
      </LanguageProvider>
    </ThemeProvider>,
  );

  return screen.getByRole("region", { name: "Gematchte route" });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("the route on the detail panel", () => {
  it("shows the recorded route in its driving direction, its configuration and method", () => {
    const section = renderSection(ORDINARY);

    expect(within(section).getByText("Quay 869 → Ghlin")).toBeInTheDocument();
    expect(within(section).getByText("route-1")).toBeInTheDocument();
    expect(within(section).getAllByText(/Genormaliseerd/).length).toBeGreaterThan(0);
    expect(within(section).getByText("NORMALIZED")).toBeInTheDocument();
  });

  it("shows both legs of a Combination, Leg 1 first, this Trip's marked", () => {
    const section = renderSection(COMBINATION);
    const legs = within(section).getAllByRole("listitem");

    expect(legs.map((leg) => leg.textContent)).toEqual([
      expect.stringContaining("Leg 1Quay 869 → GhlinExact"),
      expect.stringContaining("Leg 2Charleroi → Quay 869Fuzzy (één typfout)(deze rit)"),
    ]);
    expect(legs[0]).not.toHaveTextContent("deze rit");
    expect(within(section).getByText("combination-1")).toBeInTheDocument();
  });

  it("shows the Over ST the calculation applied, with the surcharge", () => {
    const section = renderSection(COMBINATION);

    expect(section).toHaveTextContent("Over ST: Toegepast");
    expect(within(section).getByText("Over ST-toeslag").nextSibling).toHaveTextContent("70.00");
    expect(within(section).getByText("Tol").nextSibling).toHaveTextContent("10.00");
  });

  it("says Over ST was not applied, without amounts", () => {
    const section = renderSection({
      ...COMBINATION,
      overSt: { applied: false, tarief: "0.00", toll: "0.00", tunnel: "0.00", surcharge: "0.00" },
    });

    expect(section).toHaveTextContent("Over ST: Niet toegepast");
    expect(within(section).queryByText("Over ST-toeslag")).not.toBeInTheDocument();
  });

  describe("no route", () => {
    it.each([
      ["NOT_FOUND", /Geen betrouwbare route gevonden/],
      ["AMBIGUOUS", /Meerdere mogelijke routes/],
    ] as const)("%s: says no route was used, and names none", (method, message) => {
      const section = renderSection({ method, ...NO_ROUTE });

      expect(within(section).getByRole("status")).toHaveTextContent(message);
      expect(within(section).queryByRole("listitem")).not.toBeInTheDocument();
    });

    it("an older calculation: says the match was not recorded, never guesses", () => {
      const section = renderSection({ method: null, ...NO_ROUTE });

      expect(section).toHaveTextContent(/Niet vastgelegd/);
      expect(within(section).queryByRole("listitem")).not.toBeInTheDocument();
    });
  });
});

describe("the route on the Ritten Tarief cell", () => {
  function pricing(routeMatch: RouteMatch | null | undefined): EffectivePricing {
    return {
      tarief: "0.00",
      brandstof: "0.00",
      backload: "0.00",
      tol: "0.00",
      tunnel: "0.00",
      others: "0.00",
      ek: "0.00",
      totaal: "0.00",
      components: [],
      ...(routeMatch === undefined ? {} : { routeMatch }),
    };
  }

  function renderRow(routeMatch: RouteMatch | null | undefined) {
    render(
      <ThemeProvider>
        <LanguageProvider>
          <table>
            <tbody>
              <tr>
                <PricingCells
                  pricing={pricing(routeMatch)}
                  onSaveOverride={jest.fn()}
                  onResetOverride={jest.fn()}
                  isDisabled={false}
                />
              </tr>
            </tbody>
          </table>
        </LanguageProvider>
      </ThemeProvider>,
    );
  }

  it("names the recorded route and method in the marker's tooltip", () => {
    renderRow(ORDINARY);

    const marker = screen.getByRole("img", { name: /Route-match/ });
    expect(marker).toHaveAttribute(
      "title",
      "Quay 869 → Ghlin (Genormaliseerd (hoofdletters, accenten of leestekens))",
    );
  });

  it("lists both legs and the applied Over ST for a Combination", () => {
    renderRow(COMBINATION);

    expect(screen.getByRole("img", { name: /Route-match/ }).getAttribute("title")).toBe(
      [
        "Leg 1: Quay 869 → Ghlin (Exact)",
        "Leg 2: Charleroi → Quay 869 (Fuzzy (één typfout))",
        "Over ST: Toegepast",
      ].join("\n"),
    );
  });

  /** A € 0 Tarief that is no route at all is marked, never left looking normal. */
  it("marks a Tarief priced at zero because no route matched", () => {
    renderRow({ method: "NOT_FOUND", ...NO_ROUTE });

    const marker = screen.getByRole("img", { name: /Route-match/ });
    expect(marker).toHaveTextContent("!");
    expect(marker).toHaveAttribute("data-route-match", "unmatched");
  });

  it("marks an older calculation as not recorded", () => {
    renderRow({ method: null, ...NO_ROUTE });

    expect(screen.getByRole("img", { name: /Route-match/ })).toHaveAttribute(
      "data-route-match",
      "unknown",
    );
  });

  it("shows no marker when the response carries no route record", () => {
    renderRow(undefined);

    expect(screen.queryByRole("img", { name: /Route-match/ })).not.toBeInTheDocument();
  });
});
