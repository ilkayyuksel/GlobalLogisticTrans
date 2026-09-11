import { extractAddress } from "../src/fields/address";
import { ExtractionError } from "../src/errors";
import { Fragment } from "../src/text/extract";

/**
 * The city first, a subdivision code, then the block's own postcode.
 *
 * ── THE LAYOUT ──────────────────────────────────────────────────────────────
 * A real order (`BUG-CITY/transportorder1378572.pdf`) prints its loading
 * address like this:
 *
 *     [2920]
 *     VERMEIREN NV
 *     VERMEIRENPLEIN 1-15
 *     KALMTHOUT VAN 2920       <- city, province code, postcode
 *     BELGIUM
 *
 * `VAN` is the ISO 3166-2 code of the province of Antwerp. The city-first form
 * the parser already read needs a comma (`Moerdijk, 4782 PP ,`), so this line
 * kept its digits, the digit guard refused it as a possible street, and the
 * order was reported as having no readable city.
 *
 * ── WHAT MUST NOT FOLLOW FROM THE FIX ───────────────────────────────────────
 * "Words then four digits" is also a street with a long house number, and a
 * real order prints one (`Kruipin Harbour 1145`). So the number must BE the
 * postcode the block opens with in brackets. And a short capitalised word is
 * set aside only when it is a code of the country the block states — otherwise
 * `KAPELLE OP DEN BOS` would lose the last word of its name. Anything the rule
 * cannot decide on that evidence is refused, never guessed.
 * ────────────────────────────────────────────────────────────────────────────
 */

const header: Fragment = { page: 1, x: 26, y: 400, text: "LOADING 1:" };

/** Mirrors the fixtures: section header, then the value column at x98. */
function addressBlock(lines: readonly string[]): Fragment[] {
  const fragments: Fragment[] = [
    { page: 1, x: 26, y: 400, text: "LOADING 1:" },
    { page: 1, x: 30, y: 380, text: "Address:" },
  ];

  lines.forEach((text, index) =>
    fragments.push({ page: 1, x: 98, y: 380 - index * 12, text }),
  );
  fragments.push({
    page: 1,
    x: 32,
    y: 380 - lines.length * 12,
    text: "Date/time:",
  });

  return fragments;
}

function read(lines: readonly string[]) {
  return extractAddress(addressBlock(lines), header);
}

describe("a city, a subdivision code and the block's own postcode", () => {
  /** The document that produced this rule, line for line. */
  const REAL = [
    "[2920]",
    "VERMEIREN NV",
    "VERMEIRENPLEIN 1-15",
    "KALMTHOUT VAN 2920",
    "BELGIUM",
  ];

  it("reads the city from `KALMTHOUT VAN 2920`", () => {
    expect(read(REAL).destinationCity).toBe("Kalmthout");
  });

  it("keeps the country from the line below", () => {
    expect(read(REAL).destinationCountry).toBe("Belgium");
  });

  /** The company, the street and the city line survive verbatim. */
  it("keeps the whole block for diagnostics", () => {
    const { rawAddress } = read(REAL);

    expect(rawAddress).toContain("VERMEIREN NV");
    expect(rawAddress).toContain("VERMEIRENPLEIN 1-15");
    expect(rawAddress).toContain("KALMTHOUT VAN 2920");
  });

  it("never reads the code as part of the city", () => {
    expect(read(REAL).destinationCity).not.toMatch(/van/i);
  });

  /** The code is optional: the same line without it reads the same city. */
  it("reads the line without a code", () => {
    const result = read([
      "[2920]",
      "VERMEIREN NV",
      "VERMEIRENPLEIN 1-15",
      "KALMTHOUT 2920",
      "BELGIUM",
    ]);

    expect(result.destinationCity).toBe("Kalmthout");
    expect(result.destinationCountry).toBe("Belgium");
  });

  it.each([
    ["GENT VOV 9000", "9000", "Gent"],
    ["LIEGE WLG 4000", "4000", "Liege"],
    ["SINT-KATELIJNE-WAVER VAN 2860", "2860", "Sint-Katelijne-Waver"],
    ["HEIST OP DEN BERG VAN 2220", "2220", "Heist Op Den Berg"],
  ])("reads %s", (cityLine, postcode, expected) => {
    const result = read([
      `[${postcode}]`,
      "Acme NV",
      "Stationsstraat 1",
      cityLine,
      "BELGIUM",
    ]);

    expect(result.destinationCity).toBe(expected);
  });

  /** A lower-case word is part of a name, never a code. */
  it("keeps a lower-case `van` that belongs to the name", () => {
    const result = read([
      "[3151]",
      "Acme BV",
      "Havenweg 12",
      "Hoek van Holland 3151",
      "Netherlands",
    ]);

    expect(result.destinationCity).toBe("Hoek Van Holland");
  });

  describe("what stays refused", () => {
    it("refuses a number that is not the block's own postcode", () => {
      expect(() =>
        read([
          "[2920]",
          "VERMEIREN NV",
          "VERMEIRENPLEIN 1-15",
          "KALMTHOUT VAN 2930",
          "BELGIUM",
        ]),
      ).toThrow(ExtractionError);
    });

    /** The street a real order prints, with a four-digit number. */
    it("refuses a street whose house number has four digits", () => {
      expect(() =>
        read(["[9130]", "Acme NV", "Kruipin Harbour 1145", "Belgium"]),
      ).toThrow(ExtractionError);
    });

    it("refuses the layout when the block opens with no bracketed postcode", () => {
      expect(() =>
        read([
          "VERMEIREN NV",
          "Stationsstraat 1",
          "VERMEIRENPLEIN 1-15",
          "KALMTHOUT VAN 2920",
          "BELGIUM",
        ]),
      ).toThrow(ExtractionError);
    });

    /**
     * `BOS` is shaped like a code but Belgium has none by that name: it is the
     * end of `Kapelle-op-den-Bos`. Cutting it off would store a wrong city, and
     * keeping it would be a guess the other way — so the line is refused.
     */
    it("refuses a capitalised last word that is not a code of the stated country", () => {
      expect(() =>
        read([
          "[1880]",
          "Acme NV",
          "Stationsstraat 1",
          "KAPELLE OP DEN BOS 1880",
          "BELGIUM",
        ]),
      ).toThrow(ExtractionError);
    });

    /** Only countries whose documents have printed codes are known. */
    it("refuses a code of a country the table does not list", () => {
      expect(() =>
        read([
          "[4704]",
          "Acme BV",
          "Havenweg 12",
          "ROOSENDAAL NB 4704",
          "Netherlands",
        ]),
      ).toThrow(ExtractionError);
    });

    /** A code means nothing without the country it belongs to. */
    it("refuses the line when the block states no country", () => {
      expect(() =>
        read([
          "[2920]",
          "VERMEIREN NV",
          "VERMEIRENPLEIN 1-15",
          "KALMTHOUT VAN 2920",
        ]),
      ).toThrow(ExtractionError);
    });
  });

  /**
   * Every layout that already worked, asserted beside the new one so the
   * extension cannot quietly cost one of them.
   */
  describe("the formats that already worked", () => {
    it.each([
      [["[9130]", "Acme NV", "Ketenislaan 1", "Kallo", "Belgium"], "Kallo", "Belgium"],
      [["[4880]", "Acme NV", "Rue 3", "4880 Aubel", "Belgium"], "Aubel", "Belgium"],
      [["[9940]", "Acme NV", "Havenweg 12", "9940 Evergem,", "Belgium"], "Evergem", "Belgium"],
      [["[9160]", "Acme NV", "Zoomstraat 2 AA", "9160 9160 Lokeren", "Belgium"], "Lokeren", "Belgium"],
      [["[4782]", "Ks Project Logistics", "Graanweg 17,", "Moerdijk, 4782 PP ,", "Netherlands"], "Moerdijk", "Netherlands"],
      [["[62110]", "AMD", "416 Boulevard Ferdinand de Lesseps", "Heinin-Beaumont", "62110 France"], "Heinin-Beaumont", "France"],
      [["[9130]", "Acme NV", "Ketenislaan 1", "BE-9130 Kallo"], "Kallo", "Belgium"],
    ])("reads %j", (lines, city, country) => {
      const result = read(lines as string[]);

      expect(result.destinationCity).toBe(city);
      expect(result.destinationCountry).toBe(country);
    });

    it("still reads a bracketed block with no postcode beside the city", () => {
      expect(
        read(["[2070]", "BE01: Exxonmobil", "CANADASTRAAT 20", "ZWIJNDRECHT", "Gate 3"])
          .destinationCity,
      ).toBe("Zwijndrecht");
    });
  });
});
