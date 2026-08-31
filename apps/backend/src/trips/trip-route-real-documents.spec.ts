import { TripDirection } from "@prisma/client";

import { toTripRoute } from "./trip-route";

/**
 * The canonical route of Trips read from REAL transport orders.
 *
 * ── WHERE THESE VALUES COME FROM ────────────────────────────────────────────
 * Every direction, terminal and city below is a value the parser genuinely
 * produces from a real document. They are not invented: each is asserted
 * against the PDF itself in the parser's own `real-documents.spec.ts`, and the
 * same pairs appear on the imported Trips in the database. Nothing here parses
 * anything — it takes what the parser said and checks the route built from it.
 *
 * That split is deliberate. The route is a BACKEND rule and the parser is
 * unchanged by this phase, so the parser proves what a document says and this
 * proves what the route makes of it.
 *
 * ── THE PATTERN THE REAL DOCUMENTS SHOW ─────────────────────────────────────
 * The two spellings are not random: they follow the section a Trip was read
 * from. A `LOADING n:` section is a COLLECTION and names the terminal in a
 * `Return to Terminal:` address block as `PSA Quay 869`; a `DELIVERY n:`
 * section writes `Quay 869` beside `Terminal:`. Every one of the 26 imported
 * Trips in the database follows it — 22 COLLECTION with `PSA Quay 869`, 4
 * DELIVERY with `Quay 869` — which is precisely why one canonical terminal is
 * needed before routes can be compared.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * `NEW/combination.pdf` — a genuine two-leg Combination.
 *
 * One document, two Trips, and the two spellings of the same quay appear on
 * the two pages. This is the case the route must not get wrong.
 */
describe("the real two-page Combination document", () => {
  const deliveryLeg = {
    direction: TripDirection.DELIVERY,
    terminal: "Quay 869",
    destinationCity: "Kallo",
  };

  const collectionLeg = {
    direction: TripDirection.COLLECTION,
    terminal: "PSA Quay 869",
    destinationCity: "Warneton",
  };

  it("sends the DELIVERY leg out of the quay", () => {
    expect(toTripRoute(deliveryLeg)).toEqual({
      from: "Quay 869",
      to: "Kallo",
    });
  });

  it("brings the COLLECTION leg back to the quay", () => {
    expect(toTripRoute(collectionLeg)).toEqual({
      from: "Warneton",
      to: "Quay 869",
    });
  });

  /** Two Trips, two routes. Never one string shared by both legs. */
  it("gives the two legs different routes", () => {
    expect(toTripRoute(deliveryLeg)).not.toEqual(toTripRoute(collectionLeg));
  });

  /**
   * The legs are not swapped. Read together they describe one truck movement:
   * out of the quay to Kallo, then from Warneton back to the quay.
   */
  it("ends the delivery away from the quay and starts the collection away from it", () => {
    expect(toTripRoute(deliveryLeg)?.to).not.toBe("Quay 869");
    expect(toTripRoute(collectionLeg)?.from).not.toBe("Quay 869");
    expect(toTripRoute(deliveryLeg)?.from).toBe("Quay 869");
    expect(toTripRoute(collectionLeg)?.to).toBe("Quay 869");
  });

  /** Both legs name the SAME quay, despite the two spellings on the document. */
  it("resolves both spellings to one quay", () => {
    expect(toTripRoute(deliveryLeg)?.from).toBe(toTripRoute(collectionLeg)?.to);
  });
});

/**
 * Single-order documents, as they arrive.
 *
 * The cities are real values carried by imported Trips — including the awkward
 * ones, which must survive untouched: a hyphenated French name, a name with
 * internal spaces, and one the parser recorded with a trailing comma. The route
 * tidies spacing and nothing else; renaming or "cleaning" a city is not its
 * job, and the parser stays the source.
 */
describe("real single-order documents", () => {
  it.each([
    ["Dourges", { from: "Dourges", to: "Quay 869" }],
    ["Saint-Martin-Au-Laert", { from: "Saint-Martin-Au-Laert", to: "Quay 869" }],
    ["Raillencourt Ste Olle", { from: "Raillencourt Ste Olle", to: "Quay 869" }],
    ["Fr-6212603 Wimille", { from: "Fr-6212603 Wimille", to: "Quay 869" }],
    ["Kallo,", { from: "Kallo,", to: "Quay 869" }],
    ["De Weert", { from: "De Weert", to: "Quay 869" }],
  ])("routes a COLLECTION from %j to the quay", (city, expected) => {
    expect(
      toTripRoute({
        direction: TripDirection.COLLECTION,
        terminal: "PSA Quay 869",
        destinationCity: city,
      }),
    ).toEqual(expected);
  });

  it.each([
    ["Lessines", { from: "Quay 869", to: "Lessines" }],
    ["Kallo", { from: "Quay 869", to: "Kallo" }],
    ["Melsele", { from: "Quay 869", to: "Melsele" }],
    ["Mouscron", { from: "Quay 869", to: "Mouscron" }],
  ])("routes a DELIVERY from the quay to %j", (city, expected) => {
    expect(
      toTripRoute({
        direction: TripDirection.DELIVERY,
        terminal: "Quay 869",
        destinationCity: city,
      }),
    ).toEqual(expected);
  });

  /**
   * Every real COLLECTION carries the prefixed spelling, so this is the
   * transformation the whole imported history goes through.
   */
  it("strips the prefix on every real collection terminal", () => {
    expect(
      toTripRoute({
        direction: TripDirection.COLLECTION,
        terminal: "PSA Quay 869",
        destinationCity: "Grobbendonk",
      })?.to,
    ).toBe("Quay 869");
  });
});

/**
 * ── NO ROUTE END IS EVER A COUNTRY ──────────────────────────────────────────
 * A route reading `Quay 869 -> Belgium` names no destination: it matches no
 * configured route and tells an operator nothing about where a truck is going.
 *
 * The route is built from the Trip's stored `destinationCity`, so the guarantee
 * is really the parser's — a country can no longer become a city, and a city
 * printed beside its country is separated structurally. What this asserts is
 * the CONSEQUENCE: given the cities the parser actually produces, neither end
 * of a route is ever one of the five country names.
 */
describe("a route never names a country", () => {
  const FORBIDDEN = ["France", "Belgium", "Netherlands", "Luxembourg", "Germany"];

  /** Every city the real fixtures produce, across both directions. */
  const REAL_CITIES = [
    "Avelgem",
    "Beernem",
    "Kallo",
    "Saint Laurent Blangy",
    "Tessenderlo",
    "Evergem",
    "Aubel",
    "Raillencourt Ste Olle",
    "Wimille",
    "Bousbecque",
    "Dourges",
    "Antwerpen",
    "Gondecourt",
    "Lessines",
    "Zemst",
    "Warneton",
    "Bilzen",
    "Calais",
    "Dendermonde",
  ];

  it.each(REAL_CITIES)("keeps %s intact as the destination", (city) => {
    expect(
      toTripRoute({
        direction: TripDirection.DELIVERY,
        terminal: "PSA Quay 869",
        destinationCity: city,
      }),
    ).toEqual({ from: "Quay 869", to: city });
  });

  it.each(REAL_CITIES)("puts %s at the start of a collection", (city) => {
    expect(
      toTripRoute({
        direction: TripDirection.COLLECTION,
        terminal: "PSA Quay 869",
        destinationCity: city,
      }),
    ).toEqual({ from: city, to: "Quay 869" });
  });

  it.each(REAL_CITIES)("never yields a country for %s", (city) => {
    for (const direction of [
      TripDirection.DELIVERY,
      TripDirection.COLLECTION,
    ]) {
      const route = toTripRoute({
        direction,
        terminal: "PSA Quay 869",
        destinationCity: city,
      });

      for (const end of [route?.from, route?.to]) {
        expect(FORBIDDEN.map((name) => name.toLowerCase())).not.toContain(
          String(end).trim().toLowerCase(),
        );
      }
    }
  });

  /**
   * The route layer does NOT repair a bad city, and must not be mistaken for
   * the place that guarantees this. It renders what it is given; the guarantee
   * is upstream, where the address is read. Asserted so nobody later removes
   * the parser rule believing this layer covers it.
   */
  it("does not sanitise a city it is handed", () => {
    expect(
      toTripRoute({
        direction: TripDirection.DELIVERY,
        terminal: "Quay 869",
        destinationCity: "Belgium",
      }),
    ).toEqual({ from: "Quay 869", to: "Belgium" });
  });
});
