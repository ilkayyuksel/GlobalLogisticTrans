import { render, screen, within } from "@testing-library/react";

import { buildPricing, buildTrip } from "@/app/trips/ritten-test-support";
import { listTrips } from "@/lib/api/trips";
import type { RouteMatch, Trip } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { combinationPalette } from "@/lib/ritten/combination";
import { ThemeProvider } from "@/lib/theme/theme-provider";
import { CombinationDialog } from "./combination-dialog";

jest.mock("@/lib/api/trips");

const listTripsMock = listTrips as jest.MockedFunction<typeof listTrips>;

/**
 * The group view: which Combination actually priced each leg.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   1. a group priced as a Combination names THE Combination its stored price
 *      recorded, both legs, each member's own leg, and the Over ST applied;
 *   2. a group priced on ordinary routes says so, and why — and shows no
 *      Combination id at all;
 *   3. an older snapshot says its match was not recorded;
 *   4. a member that is not CLOSED shows no current price and no current match.
 * Everything is read from each member's stored pricing; nothing is chosen here.
 * ────────────────────────────────────────────────────────────────────────────
 */

const GROUP_ID = "group-1";

const LEGS: RouteMatch["legs"] = [
  {
    legPosition: 1,
    isPricedLeg: false,
    routePricingId: "ghlin-mons-leg-1",
    departure: "Quay 869",
    destination: "Ghlin",
    method: "EXACT",
  },
  {
    legPosition: 2,
    isPricedLeg: false,
    routePricingId: "ghlin-mons-leg-2",
    departure: "Mons",
    destination: "Quay 869",
    method: "NORMALIZED",
  },
];

function matched(ownPosition: 1 | 2): RouteMatch {
  return {
    method: ownPosition === 1 ? "EXACT" : "NORMALIZED",
    routePricingId: `ghlin-mons-leg-${ownPosition}`,
    combinationRouteGroupId: "ghlin-mons",
    combinationMatch: "MATCHED",
    legs: LEGS.map((leg) => ({ ...leg, isPricedLeg: leg.legPosition === ownPosition })),
    overSt:
      ownPosition === 2
        ? { applied: true, tarief: "40.00", toll: "10.00", tunnel: "0.00", surcharge: "70.00" }
        : { applied: false, tarief: "0.00", toll: "0.00", tunnel: "0.00", surcharge: "0.00" },
  };
}

function member(id: string, routeMatch: RouteMatch | null, overrides: Partial<Trip> = {}): Trip {
  return buildTrip({
    id,
    bookingNumber: `BK-${id}`,
    tripGroupId: GROUP_ID,
    status: "CLOSED",
    pricing: { ...buildPricing({ backload: "50.00" }), routeMatch },
    ...overrides,
  });
}

function renderDialog(members: Trip[]) {
  listTripsMock.mockResolvedValue({
    items: members,
    meta: { page: 1, pageSize: 50, totalItems: members.length, totalPages: 1 },
  } as Awaited<ReturnType<typeof listTrips>>);

  render(
    <ThemeProvider>
      <LanguageProvider>
        <CombinationDialog
          tripGroupId={GROUP_ID}
          palette={combinationPalette([])}
          onUnlink={jest.fn()}
          onClose={jest.fn()}
        />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

async function sectionOf(bookingNumber: string) {
  const link = await screen.findByRole("link", { name: bookingNumber });

  return within(link.closest("li") as HTMLElement).getByRole("region", {
    name: "Gematchte route",
  });
}

beforeEach(() => {
  window.localStorage.clear();
  listTripsMock.mockReset();
});

describe("which Combination priced a group", () => {
  it("names the matched Combination, both legs and each member's own leg", async () => {
    renderDialog([member("out", matched(1)), member("back", matched(2))]);

    const back = await sectionOf("BK-back");
    expect(within(back).getByText("Combinatieprijs")).toBeInTheDocument();
    expect(within(back).getByText("ghlin-mons")).toBeInTheDocument();
    const legs = within(back).getAllByRole("listitem");
    expect(legs[0]).toHaveTextContent("Leg 1Quay 869 → GhlinExact");
    expect(legs[1]).toHaveTextContent("Leg 2Mons → Quay 869");
    expect(legs[1]).toHaveTextContent("(deze rit)");
    expect(back).toHaveTextContent("Over ST: Toegepast");
    expect(within(back).getByText("Over ST-toeslag").nextSibling).toHaveTextContent("70.00");

    const out = await sectionOf("BK-out");
    expect(within(out).getAllByRole("listitem")[0]).toHaveTextContent("(deze rit)");
    expect(out).toHaveTextContent("Over ST: Niet toegepast");
  });

  it.each([
    ["NO_PAIR", /geen eenduidig paar/],
    ["PAIR_NOT_CONFIGURED", /verschillende combinaties/],
    ["LEG_NOT_IDENTIFIED", /geen geconfigureerde combinatie-leg/],
    ["AMBIGUOUS", /meerdere combinaties/],
  ] as const)(
    "%s: says the group got no Combination price, and shows no Combination id",
    async (outcome, reason) => {
      const ordinary: RouteMatch = {
        method: "EXACT",
        routePricingId: "route-1",
        combinationRouteGroupId: null,
        combinationMatch: outcome,
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
      };
      renderDialog([member("out", ordinary)]);

      const section = await sectionOf("BK-out");
      expect(section).toHaveTextContent("Geen combinatieprijs");
      expect(section).toHaveTextContent(reason);
      expect(section).not.toHaveTextContent("Combinatieprijs:");
      expect(within(section).queryByText(/ghlin-mons/)).not.toBeInTheDocument();
    },
  );

  it("says an older snapshot did not record its match", async () => {
    renderDialog([
      member("old", {
        method: null,
        routePricingId: null,
        combinationRouteGroupId: null,
        combinationMatch: null,
        legs: [],
        overSt: null,
      }),
    ]);

    expect(await sectionOf("BK-old")).toHaveTextContent(/Niet vastgelegd/);
  });

  it("shows no current price or match for a member that is not CLOSED", async () => {
    renderDialog([member("open", matched(2), { status: "OPEN", pricing: null })]);

    const link = await screen.findByRole("link", { name: "BK-open" });
    const item = link.closest("li") as HTMLElement;
    expect(item).toHaveTextContent("Geen actuele prijs");
    expect(within(item).queryByRole("region", { name: "Gematchte route" })).not.toBeInTheDocument();
  });
});
