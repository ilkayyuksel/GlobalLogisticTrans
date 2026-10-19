import { canonicalCityAlias } from "../common/city-aliases";
import { isTrustedTypo, similarity } from "./name-similarity";
import {
  FUZZY_ROUTE_RULES,
  RouteMatchMethod,
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
    expect(FUZZY_ROUTE_RULES).toEqual({
      minSimilarity: 0.85,
      minOrderedSimilarity: 0.85,
      minRunnerUpGap: 0.1,
    });
  });
});

/*
 * The calibration itself: no two DIFFERENT real places come within the fuzzy
 * rule. If a place is ever added that does, this is where it shows.
 */
describe("the calibration against real place names", () => {
  // Read through the confirmed city aliases: `antwerp` and `antwerpen` are
  // one place, not a close pair of two.
  const REAL_PLACES_AS_LISTED = [
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
    // Added October 2026: the planning sheets and the Ritten export.
    "alken", "berlare", "dessel", "gent", "isnes", "kortemark", "lanaken veldwezelt",
    "leuven heverlee", "lillers", "meer", "merksplas", "muizen", "nivelles", "roeselare",
    "schoten", "st niklaas", "tongeren", "wanze", "wevelgem", "zeebrugge",
  ];
  const REAL_PLACES = [...new Set(REAL_PLACES_AS_LISTED.map(canonicalCityAlias))];

  it("keeps every pair of different real places outside the fuzzy rule", () => {
    for (const [index, left] of REAL_PLACES.entries()) {
      for (const right of REAL_PLACES.slice(index + 1)) {
        expect({ left, right, trusted: isTrustedTypo(left, right) }).toEqual({
          left,
          right,
          trusted: false,
        });
      }
    }
  });

  /** The margin, measured: the closest two different places stay below 0.76. */
  it("keeps the closest different places well under the threshold", () => {
    let closest = 0;

    for (const [index, left] of REAL_PLACES.entries()) {
      for (const right of REAL_PLACES.slice(index + 1)) {
        closest = Math.max(closest, similarity(left, right));
      }
    }

    expect(closest).toBeLessThanOrEqual(0.75);
    // 0.85 − 0.75, within floating-point rounding.
    expect(FUZZY_ROUTE_RULES.minSimilarity - closest).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });

  it.each([
    ["charelroi", "charleroi"],
    ["roterdam", "rotterdam"],
    ["dendermonda", "dendermonde"],
    ["lokren", "lokeren"],
    ["grobendonk", "grobbendonk"],
    ["wilebroek", "willebroek"],
    ["herentlas", "herentals"],
    ["sint gilis waas", "sint gillis waas"],
    ["zwijndrect", "zwijndrecht"],
    ["tessendrlo", "tessenderlo"],
    ["meerhuot", "meerhout"],
  ])("trusts the known typo %s for %s", (given, configured) => {
    expect(isTrustedTypo(configured, given)).toBe(true);
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

/**
 * ── CONFIRMED TERMINAL ALIASES (OCTOBER 2026) ───────────────────────────────
 * `Quay`, `PSA Quay`, `PSA Quay 869`, `Kaai` and `K869` name `Quay 869` — at the
 * TERMINAL end of the Trip's road only, as whole values, never another quay.
 */
describe("terminal aliases", () => {
  const delivery = (terminal: string, city = "Ghlin") => ({
    id: "trip",
    departure: terminal,
    destination: city,
    terminalEnd: "departure" as const,
  });
  const collection = (city: string, terminal: string) => ({
    id: "trip",
    departure: city,
    destination: terminal,
    terminalEnd: "destination" as const,
  });
  const GHLIN = [road("ghlin", QUAY, "Ghlin")];

  it.each([
    ["Quay", RouteMatchMethod.NORMALIZED],
    ["PSA Quay", RouteMatchMethod.NORMALIZED],
    ["PSA Quay 869", RouteMatchMethod.EXACT],
    ["Kaai", RouteMatchMethod.NORMALIZED],
    ["KAAI", RouteMatchMethod.NORMALIZED],
    ["  kaai  ", RouteMatchMethod.NORMALIZED],
    ["psa   QUAY", RouteMatchMethod.NORMALIZED],
    ["Kaai.", RouteMatchMethod.NORMALIZED],
  ])("1-7. a delivery from %s matches Quay 869 → Ghlin (%s)", (terminal, method) => {
    const match = matchRoad(delivery(terminal), GHLIN);

    expect(match.method).toBe(method);
    expect(ids(match)).toEqual(["ghlin"]);
  });

  it("8. a collection TO an alias matches the configured return", () => {
    const routes = [road("mons-back", "Mons", QUAY)];

    expect(ids(matchRoad(collection("Mons", "KAAI"), routes))).toEqual(["mons-back"]);
  });

  it("9. never matches the road the other way round", () => {
    expect(matchRoad(collection("Ghlin", "Kaai"), GHLIN).method).toBe(RouteMatchMethod.NOT_FOUND);
  });

  it.each(["Quay 170", "Quay 868", "PSA Quay 1742", "Kaaistraat", "Quay 869 Noord"])(
    "10. %s is no alias of Quay 869",
    (terminal) => {
      expect(matchRoad(delivery(terminal), GHLIN).method).toBe(RouteMatchMethod.NOT_FOUND);
    },
  );

  it("10. an alias never reaches another configured quay", () => {
    expect(matchRoad(delivery("Kaai"), [road("other", "Quay 170", "Ghlin")]).method).toBe(
      RouteMatchMethod.NOT_FOUND,
    );
  });

  it("11. an alias spelling at the CITY end is a city, not the terminal", () => {
    const routes = [road("lier", "Lier", QUAY)];

    // A delivery from Lier to a place called "Kaai": the terminal end is Lier.
    expect(matchRoad(delivery("Lier", "Kaai"), routes).method).toBe(RouteMatchMethod.NOT_FOUND);
  });

  it("12. two configurations that are one road through an alias are both returned, never one chosen", () => {
    const routes = [road("quay", QUAY, "Ghlin"), road("kaai", "Kaai", "Ghlin")];

    const match = matchRoad(delivery("PSA Quay"), routes);

    // The caller refuses to choose between them (resolver: AMBIGUOUS).
    expect(match.method).toBe(RouteMatchMethod.NORMALIZED);
    expect(ids(match).sort()).toEqual(["kaai", "quay"]);
  });

  /** `K869` (owner, October 2026): the same terminal, by the same rule as `Kaai`. */
  describe("K869", () => {
    it.each(["K869", "k869", " K869 "])("a delivery from %s matches Quay 869 → Ghlin", (terminal) => {
      const match = matchRoad(delivery(terminal), GHLIN);

      expect(match.method).toBe(RouteMatchMethod.NORMALIZED);
      expect(ids(match)).toEqual(["ghlin"]);
    });

    it("a Trip from Quay 869 matches a route configured as K869", () => {
      expect(ids(matchRoad(delivery("Quay 869"), [road("k869", "K869", "Ghlin")]))).toEqual(["k869"]);
    });

    it("a collection to K869 matches the configured return", () => {
      expect(ids(matchRoad(collection("Mons", "K869"), [road("mons-back", "Mons", QUAY)]))).toEqual([
        "mons-back",
      ]);
    });

    it("never matches the road the other way round", () => {
      expect(matchRoad(collection("Ghlin", "K869"), GHLIN).method).toBe(RouteMatchMethod.NOT_FOUND);
    });

    it("is a city, not the terminal, at the city end", () => {
      expect(matchRoad(delivery("Lier", "K869"), [road("lier", "Lier", QUAY)]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("never reaches Quay 170", () => {
      expect(matchRoad(delivery("K869"), [road("other", "Quay 170", "Ghlin")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it.each(["Quay 170", "K170", "K 869", "K8690"])("%s is no alias of Quay 869", (terminal) => {
      expect(matchRoad(delivery(terminal), GHLIN).method).toBe(RouteMatchMethod.NOT_FOUND);
    });
  });

  it("applies no alias when the terminal end is unknown", () => {
    expect(matchRoad({ departure: "Kaai", destination: "Ghlin" }, GHLIN).method).toBe(
      RouteMatchMethod.NOT_FOUND,
    );
  });

  describe("13. both legs of a Combination", () => {
    type Leg = Road & { readonly position: 1 | 2 };
    const leg = (id: string, position: 1 | 2, departure: string, destination: string): Leg => ({
      ...road(id, departure, destination),
      position,
    });

    it("identifies the pair through aliases at each leg's terminal", () => {
      const groups = [{ id: "ghlin-mons", legs: [leg("l1", 1, QUAY, "Ghlin"), leg("l2", 2, "Mons", QUAY)] }];

      expect(
        matchCombinationPair([delivery("Kaai"), collection("Mons", "PSA Quay")], groups),
      ).toMatchObject({ kind: "MATCHED", group: { id: "ghlin-mons" }, methods: ["NORMALIZED", "NORMALIZED"] });
    });

    /** An exact spelling in one Combination must not hide the aliased leg of the right one. */
    it("considers every configured spelling of a leg, so the pair can decide", () => {
      const groups = [
        { id: "charleroi", legs: [leg("c1", 1, QUAY, "Ghlin"), leg("c2", 2, "Charleroi", QUAY)] },
        { id: "mons", legs: [leg("m1", 1, "Kaai", "Ghlin"), leg("m2", 2, "Mons", "Kaai")] },
      ];

      expect(
        matchCombinationPair([delivery(QUAY), collection("Mons", QUAY)], groups),
      ).toMatchObject({ kind: "MATCHED", group: { id: "mons" } });
    });
  });
});

/**
 * ── CITY NAMES (OCTOBER 2026) ───────────────────────────────────────────────
 * At the CITY end of a Trip's road only: `Antwerp` = `Antwerpen`, `St` =
 * `Saint`, a qualifier in brackets optional unless it decides, and a typo
 * trusted only by the calibrated similarity scores.
 */
describe("city names", () => {
  const delivery = (city: string, terminal = QUAY) => ({
    id: "trip",
    departure: terminal,
    destination: city,
    terminalEnd: "departure" as const,
  });
  const collection = (city: string, terminal = QUAY) => ({
    id: "trip",
    departure: city,
    destination: terminal,
    terminalEnd: "destination" as const,
  });
  const to = (id: string, city: string, terminal = QUAY) => road(id, terminal, city);
  const from = (id: string, city: string, terminal = QUAY) => road(id, city, terminal);

  describe("confirmed equivalents", () => {
    it.each([
      ["Antwerp", "ANTWERPEN"],
      ["Antwerpen", "Antwerp"],
    ])("1. %s matches %s", (given, configured) => {
      expect(matchRoad(delivery(given), [to("a", configured)])).toMatchObject({
        method: RouteMatchMethod.NORMALIZED,
        matches: [{ id: "a" }],
      });
    });

    it.each([
      ["St Martin au Laert", "SAINT-MARTIN-AU-LAERT"],
      ["Saint Laurent Blangy", "ST LAURENT BLANGY"],
      ["St. Martin au Laert", "Saint Martin au Laert"],
    ])("2. %s matches %s", (given, configured) => {
      expect(ids(matchRoad(delivery(given), [to("a", configured)]))).toEqual(["a"]);
    });

    it("2. St is a word rule, not a licence to ignore the rest of the name", () => {
      expect(matchRoad(delivery("St Martin"), [to("a", "Saint Laurent Blangy")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
      /*
       * `Sint` is not `St`: no alias. `St Niklaas` reads `saint niklaas`, one
       * letter from `sint niklaas` (similarity 0.923), so it is a scored FUZZY
       * match — never NORMALIZED — and only while no other road competes.
       */
      expect(matchRoad(delivery("St Niklaas"), [to("a", "Sint-Niklaas")]).method).toBe(
        RouteMatchMethod.FUZZY,
      );
      // With its qualifier, as the price list writes it, it is not even close.
      expect(
        matchRoad(delivery("St Niklaas"), [to("a", "SINT-NIKLAAS (NIEUWKERKEN-WAAS)")]).method,
      ).toBe(RouteMatchMethod.NOT_FOUND);
    });

    it("7. letter case, spaces and punctuation", () => {
      expect(ids(matchRoad(delivery("  lanaken   veldwezelt "), [to("a", "Lanaken-Veldwezelt")]))).toEqual([
        "a",
      ]);
    });
  });

  describe("a qualifier in brackets", () => {
    it("3. Melsele is Melsele (Beveren) when that is the only candidate", () => {
      expect(matchRoad(delivery("Melsele"), [to("mb", "Melsele (Beveren)")])).toMatchObject({
        method: RouteMatchMethod.NORMALIZED,
        matches: [{ id: "mb" }],
      });
    });

    it("3. and the other way round", () => {
      expect(ids(matchRoad(collection("Kallo (Beveren)"), [from("k", "KALLO")]))).toEqual(["k"]);
    });

    it("4. Melsele against two different qualifiers is AMBIGUOUS", () => {
      const routes = [to("mb", "Melsele (Beveren)"), to("mx", "Melsele (X)")];

      expect(matchRoad(delivery("Melsele"), routes).method).toBe(RouteMatchMethod.AMBIGUOUS);
    });

    it("5. a given qualifier selects its own candidate among several", () => {
      const routes = [to("mb", "Melsele (Beveren)"), to("mx", "Melsele (X)"), to("m", "Melsele")];

      expect(ids(matchRoad(delivery("MELSELE (BEVEREN)"), routes))).toEqual(["mb"]);
    });

    it("6. two different qualifiers are never the same place", () => {
      expect(matchRoad(delivery("Melsele (X)"), [to("mb", "Melsele (Beveren)")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("prefers the whole name over the name before the brackets", () => {
      const routes = [to("m", "Mechelen"), to("mm", "Mechelen (Muizen)")];

      expect(ids(matchRoad(delivery("MECHELEN"), routes))).toEqual(["m"]);
    });

    /**
     * ── THE PLACE IN BRACKETS IS A NAME OF THE END (owner, 15 October 2026) ──
     * This REVERSES the rule of 11 October, under which `Muizen` was never
     * `Mechelen (Muizen)`: an explicitly bracketed place is now recognised as
     * the end it qualifies, exactly — never by a typo — and only when it is the
     * one configuration that names it.
     */
    it("takes the place in brackets as a name of the end it qualifies", () => {
      expect(matchRoad(delivery("Muizen"), [to("mm", "Mechelen (Muizen)")])).toMatchObject({
        method: RouteMatchMethod.NORMALIZED,
        matches: [{ id: "mm" }],
      });
    });

    it("ROESELARE (RUMBEKE) is Rumbeke", () => {
      expect(ids(matchRoad(delivery("Rumbeke"), [to("r", "ROESELARE (RUMBEKE)")]))).toEqual(["r"]);
    });

    it("ROESELARE (RUMBEKE) is Roeselare", () => {
      expect(ids(matchRoad(delivery("Roeselare"), [to("r", "ROESELARE (RUMBEKE)")]))).toEqual(["r"]);
    });

    it("Rumbeke is never Roeselare (Oekene): the bracket decides", () => {
      expect(matchRoad(delivery("Rumbeke"), [to("o", "Roeselare (Oekene)")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
      expect(matchRoad(delivery("Roeselare (Oekene)"), [to("r", "Roeselare (Rumbeke)")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("picks the configuration that names the bracketed place, not its sibling", () => {
      const routes = [to("r", "Roeselare (Rumbeke)"), to("o", "Roeselare (Oekene)")];

      expect(ids(matchRoad(delivery("Rumbeke"), routes))).toEqual(["r"]);
      // The town alone names both: neither.
      expect(matchRoad(delivery("Roeselare"), routes).method).toBe(RouteMatchMethod.AMBIGUOUS);
    });

    it("is AMBIGUOUS when two different towns bracket the same place", () => {
      const routes = [to("r", "Roeselare (Rumbeke)"), to("i", "Izegem (Rumbeke)")];

      expect(matchRoad(delivery("Rumbeke"), routes).method).toBe(RouteMatchMethod.AMBIGUOUS);
    });

    it("prefers a configuration of the whole name over one that brackets it", () => {
      const routes = [to("rb", "Rumbeke"), to("r", "Roeselare (Rumbeke)")];

      expect(ids(matchRoad(delivery("Rumbeke"), routes))).toEqual(["rb"]);
    });

    it("never by a typo of the bracketed place", () => {
      expect(matchRoad(delivery("Rumbeek"), [to("r", "Roeselare (Rumbeke)")]).method).not.toBe(
        RouteMatchMethod.NORMALIZED,
      );
    });

    it("never the road the other way round", () => {
      expect(matchRoad(collection("Rumbeke"), [to("r", "ROESELARE (RUMBEKE)")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("reads the place in brackets on the Trip's side too", () => {
      expect(ids(matchRoad(delivery("Roeselare (Rumbeke)"), [to("rb", "Rumbeke")]))).toEqual(["rb"]);
    });
  });

  describe("similarity", () => {
    it("8. a small typo with one clear best candidate", () => {
      expect(matchRoad(delivery("Lokren"), [to("l", "LOKEREN"), to("t", "TONGEREN")])).toMatchObject({
        method: RouteMatchMethod.FUZZY,
        matches: [{ id: "l" }],
      });
    });

    it.each([
      ["9. a low score", "Wevelgem", "Evergem"],
      ["9. a short name", "Gent", "Genk"],
      ["11. letters in the same order, but another place", "Beerse", "Beernem"],
      ["12. only part of the name", "Kallo", "Kalmthout"],
      ["12. a longer name containing it", "Zele", "Zeebrugge"],
    ])("%s never matches (%s / %s)", (_name, given, configured) => {
      expect(matchRoad(delivery(given), [to("x", configured)]).method).toBe(RouteMatchMethod.NOT_FOUND);
    });

    it("10. two nearly equal candidates are AMBIGUOUS", () => {
      const routes = [to("a", "Westerhoven"), to("b", "Westerhoeve")];

      expect(matchRoad(delivery("Westerhovem"), routes).method).toBe(RouteMatchMethod.AMBIGUOUS);
    });

    it("13. digits are never fuzzed away", () => {
      expect(matchRoad(delivery("Zone 12 Industrie"), [to("z", "Zone 13 Industrie")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });
  });

  describe("whole routes", () => {
    it("14. the right city at the wrong terminal is no match", () => {
      expect(matchRoad(delivery("Lokeren", "Quay 1742"), [to("l", "Lokeren")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("14. a city typo never makes up for a wrong terminal", () => {
      expect(matchRoad(delivery("Lokren", "Quay 1742"), [to("l", "Lokeren")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("15. the right terminal and the wrong city only through the safe rules", () => {
      expect(matchRoad(delivery("Tongeren"), [to("l", "Lokeren")]).method).toBe(RouteMatchMethod.NOT_FOUND);
    });

    it("16. never the road the other way round", () => {
      expect(matchRoad(collection("Antwerp"), [to("a", "Antwerpen")]).method).toBe(
        RouteMatchMethod.NOT_FOUND,
      );
    });

    it("17. delivery and collection each through the alias at their own city end", () => {
      const routes = [to("out", "Antwerpen"), from("back", "Antwerpen")];

      expect(ids(matchRoad(delivery("Antwerp"), routes))).toEqual(["out"]);
      expect(ids(matchRoad(collection("Antwerp"), routes))).toEqual(["back"]);
    });

    it("18. one city on several routes: the terminal decides", () => {
      const routes = [to("q869", "Lokeren"), to("q1742", "Lokeren", "Quay 1742")];

      expect(ids(matchRoad(delivery("Lokren", "Kaai"), routes))).toEqual(["q869"]);
    });
  });

  describe("Combinations", () => {
    type Leg = Road & { readonly position: 1 | 2 };
    const leg = (id: string, position: 1 | 2, departure: string, destination: string): Leg => ({
      ...road(id, departure, destination),
      position,
    });

    it("19. both legs through city equivalents", () => {
      const groups = [
        { id: "c", legs: [leg("l1", 1, QUAY, "Antwerpen"), leg("l2", 2, "Melsele (Beveren)", QUAY)] },
      ];

      expect(
        matchCombinationPair([delivery("Antwerp"), collection("Melsele")], groups),
      ).toMatchObject({ kind: "MATCHED", group: { id: "c" } });
    });

    /** The owner's Combination #213, as configured and as the Trips arrive. */
    describe("COMBINATION #213", () => {
      const groups = [
        { id: "c213", legs: [leg("l1", 1, QUAY, "ROESELARE (RUMBEKE)"), leg("l2", 2, "IEPER", QUAY)] },
      ];
      const rit1 = delivery("Rumbeke", "Quay 869");
      const rit2 = collection("Ieper", "PSA Quay 869");

      it("matches both legs together, each Trip on its own leg", () => {
        expect(matchCombinationPair([rit1, rit2], groups)).toMatchObject({
          kind: "MATCHED",
          group: { id: "c213" },
          legs: [{ id: "l1" }, { id: "l2" }],
        });
        expect(matchCombinationPair([rit2, rit1], groups)).toMatchObject({
          kind: "MATCHED",
          legs: [{ id: "l2" }, { id: "l1" }],
        });
      });

      it("is no Combination when only one leg matches", () => {
        expect(matchCombinationPair([rit1, collection("Poperinge", "PSA Quay 869")], groups).kind).toBe(
          "LEG_NOT_IDENTIFIED",
        );
        expect(matchCombinationPair([delivery("Oekene"), rit2], groups).kind).toBe("LEG_NOT_IDENTIFIED");
      });

      it("is no Combination when a leg runs the other way", () => {
        expect(matchCombinationPair([collection("Rumbeke"), rit2], groups).kind).toBe(
          "LEG_NOT_IDENTIFIED",
        );
      });
    });

    it("20. one ambiguous leg leaves the pair unidentified", () => {
      const groups = [
        { id: "b", legs: [leg("b1", 1, QUAY, "Antwerpen"), leg("b2", 2, "Melsele (Beveren)", QUAY)] },
        { id: "x", legs: [leg("x1", 1, QUAY, "Antwerpen"), leg("x2", 2, "Melsele (X)", QUAY)] },
      ];

      expect(
        matchCombinationPair([delivery("Antwerp"), collection("Melsele")], groups).kind,
      ).toBe("LEG_NOT_IDENTIFIED");
    });
  });
});
