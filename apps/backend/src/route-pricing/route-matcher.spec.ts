import {
  FUZZY_ROUTE_RULES,
  RouteMatchMethod,
  editDistance,
  matchCombinationPair,
  matchRoad,
  normalizeLocation,
} from "./route-matcher";

/**
 * The one route matcher pricing uses.
 *
 * Positive AND negative cases. The negative ones are real: every pair of
 * place names below that must NOT match is taken from the documents, the
 * captures or the customer's own price list, where they are different places.
 */

interface Road {
  readonly id: string;
  readonly departure: string;
  readonly destination: string;
}

const road = (id: string, departure: string, destination: string): Road => ({
  id,
  departure,
  destination,
});

const QUAY = "Quay 869";
const ids = (match: { matches: readonly Road[] }) => match.matches.map((each) => each.id);

describe("safe normalisation", () => {
  it.each([
    ["ZEMST", "zemst"],
    ["  Bergen   Op Zoom ", "bergen op zoom"],
    ["SINT-GILLIS-WAAS", "sint gillis waas"],
    ["Saint-Martin-au-Laërt", "saint martin au laert"],
    ["Kallo (Beveren)", "kallo beveren"],
    ["PSA Quay 869", "quay 869"],
  ])("normalises %p to %p", (given, expected) => {
    expect(normalizeLocation(given)).toBe(expected);
  });

  it("keeps a qualifier: it may be a different place", () => {
    expect(normalizeLocation("MECHELEN (MUIZEN)")).not.toBe(normalizeLocation("MECHELEN"));
  });

  it("strips PSA only before a quay, never inside other text", () => {
    expect(normalizeLocation("PSA Logistics Hub")).toBe("psa logistics hub");
  });
});

describe("matchRoad: an ordinary route", () => {
  const ROUTES = [
    road("zemst", QUAY, "ZEMST"),
    road("zemst-back", "ZEMST", QUAY),
    road("dendermonde", QUAY, "DENDERMONDE"),
    road("genk", QUAY, "GENK"),
    road("mechelen", QUAY, "MECHELEN"),
    road("mechelen-muizen", QUAY, "MECHELEN (MUIZEN)"),
    road("aalst", "AALST", QUAY),
    road("avelgem", QUAY, "AVELGEM"),
    road("tessenderlo", QUAY, "TESSENDERLO"),
  ];

  it("1. matches exactly as configured", () => {
    const match = matchRoad(road("t", QUAY, "ZEMST"), ROUTES);

    expect(match.method).toBe(RouteMatchMethod.EXACT);
    expect(ids(match)).toEqual(["zemst"]);
  });

  it("2. matches after safe normalisation: case, PSA prefix, punctuation", () => {
    const match = matchRoad(road("t", "PSA Quay 869", "Zemst"), ROUTES);

    expect(match.method).toBe(RouteMatchMethod.NORMALIZED);
    expect(ids(match)).toEqual(["zemst"]);
  });

  it("4. matches a single typo in a long name", () => {
    const match = matchRoad(road("t", QUAY, "Dendermonda"), ROUTES);

    expect(match.method).toBe(RouteMatchMethod.FUZZY);
    expect(ids(match)).toEqual(["dendermonde"]);
  });

  it("matches a swapped pair of letters as one edit", () => {
    for (const typo of ["Tesesnderlo", "Tessednerlo", "Tessendrelo"]) {
      expect(ids(matchRoad(road("t", QUAY, typo), ROUTES))).toEqual(["tessenderlo"]);
    }
  });

  it("refuses two swaps, which are two edits", () => {
    expect(matchRoad(road("t", QUAY, "Tesesndrelo"), ROUTES).method).toBe(
      RouteMatchMethod.NOT_FOUND,
    );
  });

  it("5. refuses two edits, however long the name", () => {
    expect(matchRoad(road("t", QUAY, "Dendrmonda"), ROUTES).method).toBe(
      RouteMatchMethod.NOT_FOUND,
    );
  });

  /* GENK and GENT are one letter apart and two different cities. */
  it("7/10. never fuzzes a short name: GENT is not GENK", () => {
    expect(matchRoad(road("t", QUAY, "GENT"), ROUTES).method).toBe(RouteMatchMethod.NOT_FOUND);
  });

  /* AVELGEM and EVERGEM: two real places, two edits apart. */
  it("10. never takes one real place for another: EVERGEM is not AVELGEM", () => {
    expect(matchRoad(road("t", QUAY, "EVERGEM"), ROUTES).method).toBe(RouteMatchMethod.NOT_FOUND);
  });

  it("10. does not drop a qualifier: Kallo is not Kallo (Beveren)", () => {
    const routes = [road("kallo-beveren", QUAY, "Kallo (Beveren)")];

    expect(matchRoad(road("t", QUAY, "Kallo"), routes).method).toBe(RouteMatchMethod.NOT_FOUND);
  });

  it("10. matches MECHELEN and MECHELEN (MUIZEN) each to its own route", () => {
    expect(ids(matchRoad(road("t", QUAY, "Mechelen"), ROUTES))).toEqual(["mechelen"]);
    expect(ids(matchRoad(road("t", QUAY, "Mechelen (Muizen)"), ROUTES))).toEqual([
      "mechelen-muizen",
    ]);
  });

  it("9. never reverses a road: ZEMST → Quay is not Quay → ZEMST", () => {
    const outbound = [road("zemst", QUAY, "ZEMST")];

    expect(matchRoad(road("t", "ZEMST", QUAY), outbound).method).toBe(RouteMatchMethod.NOT_FOUND);
    expect(ids(matchRoad(road("t", "ZEMST", QUAY), ROUTES))).toEqual(["zemst-back"]);
  });

  /** Normalisation and the typo rule compare end to end, never across. */
  describe("direction survives every layer", () => {
    const outbound = [road("dendermonde", QUAY, "DENDERMONDE")];

    it("never reverses a road that only differs in letter case", () => {
      expect(matchRoad(road("t", "dendermonde", "quay 869"), outbound).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("never reverses a road with a trusted typo in it", () => {
      expect(matchRoad(road("t", "Dendermonda", QUAY), outbound).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("reports the reversed configuration as nearest, never as a match", () => {
      const match = matchRoad(road("t", "DENDERMONDE", QUAY), outbound);

      expect(match.matches).toEqual([]);
      expect(match.nearest[0]).toMatchObject({ route: { id: "dendermonde" } });
      expect(match.nearest[0].departureEdits).toBeGreaterThan(1);
    });
  });

  it("7. refuses a wrong departure with a correct destination", () => {
    expect(matchRoad(road("t", "MPET 1742", "ZEMST"), ROUTES).method).toBe(
      RouteMatchMethod.NOT_FOUND,
    );
  });

  it("8. refuses a correct departure with a wrong destination", () => {
    expect(matchRoad(road("t", QUAY, "Zwijndrecht"), ROUTES).method).toBe(
      RouteMatchMethod.NOT_FOUND,
    );
  });

  it("never fuzzes a number: Quay 868 is not Quay 869", () => {
    expect(matchRoad(road("t", "Quay 868", "ZEMST"), ROUTES).method).toBe(
      RouteMatchMethod.NOT_FOUND,
    );
  });

  it("never trusts both ends fuzzy at once", () => {
    const routes = [road("long", "Grobbendonk", "Dendermonde")];

    expect(matchRoad(road("t", "Grobendonk", "Dendermonda"), routes).method).toBe(
      RouteMatchMethod.NOT_FOUND,
    );
  });

  it("6. refuses two candidates that score alike", () => {
    const routes = [road("a", QUAY, "Westerhoven"), road("b", QUAY, "Westerhoeve")];

    expect(matchRoad(road("t", QUAY, "Westerhovem"), routes).method).toBe(
      RouteMatchMethod.AMBIGUOUS,
    );
  });

  it("refuses a typo whose runner-up is within the margin", () => {
    const routes = [road("a", QUAY, "Hoogstraten"), road("b", QUAY, "Hoogstraaten")];

    expect(matchRoad(road("t", QUAY, "Hoogstratem"), routes).method).toBe(
      RouteMatchMethod.AMBIGUOUS,
    );
  });

  it("14. reports two different configured roads that normalise alike as ambiguous", () => {
    const routes = [road("upper", QUAY, "ZEMST"), road("lower", QUAY, "Zemst ")];

    expect(matchRoad(road("t", QUAY, "zemst"), routes)).toMatchObject({
      method: RouteMatchMethod.NORMALIZED,
      matches: [expect.objectContaining({ id: "upper" }), expect.objectContaining({ id: "lower" })],
    });
  });

  it("lets an exact configuration win over a fuzzy one", () => {
    const routes = [road("typo", QUAY, "Dendermonda"), road("real", QUAY, "Dendermonde")];

    expect(ids(matchRoad(road("t", QUAY, "Dendermonde"), routes))).toEqual(["real"]);
  });

  it("13/15. reports the nearest candidates with their scores when nothing matches", () => {
    const match = matchRoad(road("t", QUAY, "Westerlo"), ROUTES);

    expect(match.method).toBe(RouteMatchMethod.NOT_FOUND);
    expect(match.nearest.length).toBeGreaterThan(0);
    expect(match.nearest[0]).toEqual(
      expect.objectContaining({ departureEdits: 0, destinationEdits: expect.any(Number) }),
    );
  });

  it("documents its own thresholds", () => {
    expect(FUZZY_ROUTE_RULES).toEqual({ maxEdits: 1, minLength: 8, minRunnerUpEdits: 3 });
  });
});

/*
 * The calibration itself: no two DIFFERENT real places come within the fuzzy
 * rule. If a place is ever added that does, this is where it shows.
 */
describe("the calibration against real place names", () => {
  const REAL_PLACES = [
    "aalst", "aalter", "antwerp", "antwerpen", "arendonk", "aubel", "avelgem", "beernem",
    "beerse", "bergen op zoom", "bilzen", "bousbecque", "calais", "coulogne", "dendermonde",
    "diest", "dourges", "evergem", "fretin", "genk", "gondecourt", "grobbendonk", "helmond",
    "henin beaumont", "herentals", "hoek", "ieper", "kallo", "kallo beveren", "kalmthout",
    "kapelle", "lanklaar", "lessines", "lokeren", "lommel", "mechelen", "mechelen muizen",
    "meerhout", "melsele", "melsele beveren", "merksem", "moerdijk", "mons", "mouscron",
    "overpelt", "puurs", "raillencourt ste olle", "roeselare rumbeke", "roosendaal",
    "rotterdam", "saint laurent blangy", "sint gillis waas", "sint niklaas nieuwkerken waas",
    "sittard", "soumagne", "st martin au laert", "tessenderlo", "tielt", "veghel", "waregem",
    "warneton", "westerlo oevel", "wetteren", "wevelgem gullegem", "willebroek", "wimille",
    "zaventem brucargo", "zele", "zemst", "zottegem", "zwijndrecht",
  ];

  it("keeps every pair of different real places outside the fuzzy rule", () => {
    for (const [index, left] of REAL_PLACES.entries()) {
      for (const right of REAL_PLACES.slice(index + 1)) {
        const edits = editDistance(left, right);
        const longEnough = Math.min(left.length, right.length) >= FUZZY_ROUTE_RULES.minLength;

        expect({ left, right, fuzzy: longEnough && edits <= FUZZY_ROUTE_RULES.maxEdits }).toEqual({
          left,
          right,
          fuzzy: false,
        });
      }
    }
  });
});

describe("matchCombinationPair", () => {
  type Leg = Road & { readonly position: 1 | 2 };
  const leg = (id: string, position: 1 | 2, departure: string, destination: string): Leg => ({
    ...road(id, departure, destination),
    position,
  });

  const ZEMST_COMBO = {
    id: "zemst-combo",
    legs: [leg("z1", 1, QUAY, "ZEMST"), leg("z2", 2, "ZEMST", QUAY)],
  };
  const SHARED_OUTBOUND = {
    id: "zemst-aalst",
    legs: [leg("a1", 1, QUAY, "ZEMST"), leg("a2", 2, "AALST", QUAY)],
  };
  const GROUPS = [ZEMST_COMBO, SHARED_OUTBOUND];

  it("1. identifies the pair when both legs match exactly", () => {
    const match = matchCombinationPair(
      [road("t1", QUAY, "ZEMST"), road("t2", "ZEMST", QUAY)],
      GROUPS,
    );

    expect(match).toMatchObject({ kind: "MATCHED", group: { id: "zemst-combo" }, method: "EXACT" });
  });

  /* The outbound is shared by both Combinations: the partner decides. */
  it("7/8. picks the Combination by its pair, not by the shared leg", () => {
    const match = matchCombinationPair(
      [road("t1", QUAY, "ZEMST"), road("t2", "AALST", QUAY)],
      GROUPS,
    );

    expect(match).toMatchObject({ kind: "MATCHED", group: { id: "zemst-aalst" } });
    if (match.kind === "MATCHED") {
      expect(match.legs.map((each) => each.id)).toEqual(["a1", "a2"]);
    }
  });

  it("9. returns the leg each road matched, in the roads' own order", () => {
    const match = matchCombinationPair(
      [road("t2", "ZEMST", QUAY), road("t1", QUAY, "ZEMST")],
      GROUPS,
    );

    expect(match.kind === "MATCHED" && match.legs.map((each) => each.position)).toEqual([2, 1]);
  });

  it("2. accepts one exact leg and one trusted typo, as the weaker method", () => {
    const groups = [
      { id: "dm", legs: [leg("d1", 1, QUAY, "DENDERMONDE"), leg("d2", 2, "DENDERMONDE", QUAY)] },
    ];

    expect(
      matchCombinationPair([road("t1", QUAY, "Dendermonde"), road("t2", "Dendermonda", QUAY)], groups),
    ).toMatchObject({ kind: "MATCHED", method: "FUZZY", methods: ["NORMALIZED", "FUZZY"] });
  });

  it("3. accepts two legs that are each a trusted typo", () => {
    const groups = [
      { id: "dm", legs: [leg("d1", 1, QUAY, "DENDERMONDE"), leg("d2", 2, "DENDERMONDE", QUAY)] },
    ];

    expect(
      matchCombinationPair([road("t1", QUAY, "Dendermonda"), road("t2", "Dendermonda", QUAY)], groups),
    ).toMatchObject({ kind: "MATCHED", method: "FUZZY" });
  });

  it("never identifies a pair driven the other way round", () => {
    const groups = [{ id: "z", legs: [leg("z1", 1, QUAY, "ZEMST"), leg("z2", 2, "AALST", QUAY)] }];

    expect(
      matchCombinationPair([road("t1", "ZEMST", QUAY), road("t2", QUAY, "AALST")], groups).kind,
    ).toBe("LEG_NOT_IDENTIFIED");
  });

  it("4. leaves the pair unidentified when one leg matches nothing", () => {
    expect(
      matchCombinationPair([road("t1", QUAY, "ZEMST"), road("t2", "GENT", QUAY)], GROUPS),
    ).toMatchObject({ kind: "LEG_NOT_IDENTIFIED" });
  });

  it("5. leaves the pair unidentified when one leg is ambiguous", () => {
    const groups = [
      { id: "w1", legs: [leg("w1a", 1, QUAY, "Westerhoven"), leg("w1b", 2, "Westerhoven", QUAY)] },
      { id: "w2", legs: [leg("w2a", 1, QUAY, "Westerhoeve"), leg("w2b", 2, "Westerhoeve", QUAY)] },
    ];

    expect(
      matchCombinationPair([road("t1", QUAY, "Westerhovem"), road("t2", "Westerhoven", QUAY)], groups),
    ).toMatchObject({ kind: "LEG_NOT_IDENTIFIED" });
  });

  /* Each road is a configured leg — of a different Combination. */
  it("6. reports two configured roads that are no configured pair", () => {
    const genkAalst = {
      id: "genk-aalst",
      legs: [leg("g1", 1, QUAY, "GENK"), leg("g2", 2, "AALST", QUAY)],
    };

    expect(
      matchCombinationPair([road("t1", QUAY, "ZEMST"), road("t2", "AALST", QUAY)], [ZEMST_COMBO, genkAalst]),
    ).toMatchObject({ kind: "PAIR_NOT_CONFIGURED" });
  });

  it("never selects one of two Combinations that hold the same pair", () => {
    const twin = { id: "twin", legs: [leg("x1", 1, QUAY, "Zemst"), leg("x2", 2, "Zemst", QUAY)] };

    expect(
      matchCombinationPair([road("t1", QUAY, "zemst"), road("t2", "zemst", QUAY)], [ZEMST_COMBO, twin]),
    ).toMatchObject({ kind: "AMBIGUOUS" });
  });
});
