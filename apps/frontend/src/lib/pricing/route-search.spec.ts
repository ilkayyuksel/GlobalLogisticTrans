import type {
  CombinationRouteConfiguration,
  RouteConfiguration,
} from "@/lib/api/route-configuration";

import { matchesCombinationSearch, matchesRouteSearch } from "./route-search";

function road(departure: string, destination: string): RouteConfiguration {
  return {
    id: `${departure}-${destination}`,
    departure,
    destination,
    tarief: "100.00",
    toll: "20.00",
    hasToll: true,
    tunnel: "0.00",
    hasTunnel: true,
    type: "NORMAL",
    combinationGroupId: null,
    reviewed: false,
  };
}

function combination(
  first: [string, string],
  second: [string, string],
): CombinationRouteConfiguration {
  return {
    id: "group",
    reviewed: false,
    legs: [road(...first), road(...second)],
    overSt: { tarief: "50.00", toll: null, tunnel: null },
  };
}

describe("searching ordinary routes", () => {
  const route = road("PSA Quay 869", "GENT");

  it.each([
    ["869", true],
    ["quay", true],
    ["gent", true],
    ["GENT", true],
    ["  869  ", true],
    ["Lessines", false],
  ])("matches %p: %p", (search, expected) => {
    expect(matchesRouteSearch(route, search)).toBe(expected);
  });

  it("matches everything for an empty search", () => {
    expect(matchesRouteSearch(route, "")).toBe(true);
    expect(matchesRouteSearch(route, "   ")).toBe(true);
  });
});

describe("searching Combinations", () => {
  const pair = combination(["PSA Quay 869", "GENT"], ["GENT", "LESSINES"]);

  it("matches on Leg 1", () => {
    expect(matchesCombinationSearch(pair, "869")).toBe(true);
  });

  it("matches on Leg 2", () => {
    expect(matchesCombinationSearch(pair, "lessines")).toBe(true);
  });

  /** Over ST has no Van or Naar, so its amounts are never searched. */
  it("does not search Over ST", () => {
    expect(matchesCombinationSearch(pair, "50.00")).toBe(false);
  });

  it("matches nothing that neither leg mentions", () => {
    expect(matchesCombinationSearch(pair, "Brussels")).toBe(false);
  });
});
