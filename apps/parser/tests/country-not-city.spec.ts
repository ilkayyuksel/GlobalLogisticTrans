import { extractAddress } from "../src/fields/address";
import { isCountryName, splitTrailingCountry } from "../src/fields/country";
import { ExtractionError } from "../src/errors";
import { Fragment } from "../src/text/extract";

/**
 * ── A COUNTRY IS NEVER A CITY ───────────────────────────────────────────────
 * The five countries these documents name — France, Belgium, Netherlands,
 * Luxembourg, Germany — must never reach `destinationCity`. A Trip routed to
 * "Belgium" matches no configured route and tells an operator nothing about
 * where a truck is going, and the same value in an export is simply wrong.
 *
 * The vocabulary in `country.ts` is the single source of that list: the same
 * table that RECOGNISES a country is the one that FORBIDS it as a city, so the
 * two can never drift apart. Nothing else is a country as far as this parser is
 * concerned — Spain and Italy are not in the table and are not treated as
 * countries here.
 *
 * These tests exercise the field rules on positioned text rather than through a
 * PDF, in the same shape the fixtures print, so a layout the business has not
 * sent us yet can be covered without inventing a document to hold it.
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

function cityOf(lines: readonly string[]): string {
  return extractAddress(addressBlock(lines), header).destinationCity;
}

/** The five names, exactly as the documents print them in English. */
const FORBIDDEN = ["France", "Belgium", "Netherlands", "Luxembourg", "Germany"];

describe("the predicate that decides what a country is", () => {
  it.each(FORBIDDEN)("recognises %s", (name) => {
    expect(isCountryName(name)).toBe(true);
  });

  it.each(["belgium", " BELGIUM ", "france", "  Germany", "netherlands "])(
    "is case-insensitive and trimmed for %p",
    (value) => {
      expect(isCountryName(value)).toBe(true);
    },
  );

  /** Real destinations from the fixtures. None of them is a country. */
  it.each([
    "Kallo",
    "Beernem",
    "Avelgem",
    "Dourges",
    "Antwerpen",
    "Saint Laurent Blangy",
    "Raillencourt Ste Olle",
    "Wimille",
    "Bousbecque",
    "Tessenderlo",
    "Evergem",
    "Aubel",
  ])("does not claim %s is a country", (city) => {
    expect(isCountryName(city)).toBe(false);
  });

  /**
   * The list is exactly the countries these documents use. It is not quietly
   * wider: a country this parser has never seen is not a country here, and
   * treating one as such would start rejecting cities on no evidence.
   */
  it.each(["Spain", "Italy", "Austria", "Switzerland", "Poland"])(
    "does not treat %s as a known country",
    (name) => {
      expect(isCountryName(name)).toBe(false);
    },
  );
});

/**
 * The split is STRUCTURAL: the trailing words must be exactly a known country
 * name. It is not a substring cleanup, which is what keeps a real city intact.
 */
describe("splitting a country off the end of a line", () => {
  it.each([
    ["Kallo, Belgium", "Kallo", "Belgium"],
    ["Kallo Belgium", "Kallo", "Belgium"],
    ["Dourges, France", "Dourges", "France"],
    ["9940 Evergem, Belgium", "9940 Evergem", "Belgium"],
  ])("splits %p", (line, rest, country) => {
    expect(splitTrailingCountry(line)).toEqual({ rest, country });
  });

  /** Nothing precedes the country, so there is no city to be had. */
  it.each(["Belgium", " France ", "Germany"])(
    "refuses to split %p, which names no city",
    (line) => {
      expect(splitTrailingCountry(line)).toBeNull();
    },
  );

  it.each([
    "Kallo",
    "Saint Laurent Blangy",
    "Raillencourt Ste Olle",
    "Bergen Op Zoom",
  ])("leaves %p alone", (line) => {
    expect(splitTrailingCountry(line)).toBeNull();
  });
});

/**
 * A block whose only candidate is a country states no city at all. It is
 * REFUSED rather than guessed at — a wrong destination is worse than an address
 * reported as unreadable.
 */
describe("a country standing alone", () => {
  it.each(FORBIDDEN)("refuses %s as the whole address", (country) => {
    expect(() => cityOf([country])).toThrow(ExtractionError);
  });

  it.each(["belgium", "BELGIUM", " Belgium ", "Belgium,"])(
    "refuses %p whatever its casing or padding",
    (printed) => {
      expect(() => cityOf([printed])).toThrow(ExtractionError);
    },
  );

  /** Even with a full block around it, a country is not promoted to a city. */
  it("refuses a country as the last line of a complete block", () => {
    expect(() =>
      cityOf(["[9130]", "DP World", "Ketenislaan 1", "Belgium"]),
    ).toThrow(ExtractionError);
  });
});

/**
 * ── THE CITY AND THE COUNTRY ON ONE LINE ────────────────────────────────────
 * Some orders print them together. Stored as read, the destination becomes
 * "Kallo, Belgium" and the route reads `Quay 869 -> Kallo, Belgium`.
 */
describe("a city and a country sharing one line", () => {
  it.each([
    ["Kallo, Belgium", "Kallo", "Belgium"],
    ["Kallo Belgium", "Kallo", "Belgium"],
    ["Dourges, France", "Dourges", "France"],
    ["Bousbecque France", "Bousbecque", "France"],
    ["Venlo, Netherlands", "Venlo", "Netherlands"],
    ["Aachen Germany", "Aachen", "Germany"],
  ])("reads %p as %s in %s", (printed, city, country) => {
    const result = extractAddress(
      addressBlock(["[9130]", "DP World", "Ketenislaan 1", printed]),
      header,
    );

    expect(result.destinationCity).toBe(city);
    expect(result.destinationCountry).toBe(country);
  });

  it("keeps the country when the city line carries a postcode too", () => {
    const result = extractAddress(
      addressBlock([
        "[9940]",
        "Stukwerkers",
        "Rigakaai 14",
        "9940 Evergem, Belgium",
      ]),
      header,
    );

    expect(result.destinationCity).toBe("Evergem");
    expect(result.destinationCountry).toBe("Belgium");
  });

  it("splits the prefixed form too", () => {
    const result = extractAddress(
      addressBlock([
        "[9130]",
        "DP World",
        "Ketenislaan 1",
        "BE-9130 Kallo, Belgium",
      ]),
      header,
    );

    expect(result.destinationCity).toBe("Kallo");
    expect(result.destinationCountry).toBe("Belgium");
  });

  /** The country on its own line is the layout that already worked. */
  it("still reads the city when the country is on the next line", () => {
    const result = extractAddress(
      addressBlock(["[9130]", "DP World", "Ketenislaan 1", "Kallo", "Belgium"]),
      header,
    );

    expect(result.destinationCity).toBe("Kallo");
    expect(result.destinationCountry).toBe("Belgium");
  });
});

/**
 * ── A REAL CITY IS NEVER TRUNCATED ──────────────────────────────────────────
 * The split fires only on an exact trailing country token. A city whose name
 * merely contains those letters keeps every one of them.
 */
describe("real city names survive intact", () => {
  it.each([
    "Saint Laurent Blangy",
    "Raillencourt Ste Olle",
    "Saint-Martin-Au-Laert",
  ])("keeps %s whole", (city) => {
    expect(cityOf(["[59554]", "LENGLET", "Avenue Des Deux Vallees", city])).toBe(
      city,
    );
  });

  /** Nothing is stripped when the trailing word is not a country. */
  it("does not strip a trailing word that is not a country", () => {
    expect(cityOf(["[2040]", "Depot", "Havenweg 3", "Kallo Noord"])).toBe(
      "Kallo Noord",
    );
  });
});

/**
 * ── THE POSTCODE / COUNTRY LINE ─────────────────────────────────────────────
 * `62110 France` is a postcode and a country, and holds no city at all. The
 * city comes from the line beside it; where there is none, nothing is invented.
 * This is the regression that once made the destination "France".
 */
describe("a postcode and a country sharing a line", () => {
  it("takes the city from the line above, never the country", () => {
    const result = extractAddress(
      addressBlock([
        "[62110]",
        "AMD",
        "416 Boulevard Ferdinand de Lesseps",
        "Heinin-Beaumont",
        "62110 France",
      ]),
      header,
    );

    expect(result.destinationCity).toBe("Heinin-Beaumont");
    expect(result.destinationCountry).toBe("France");
  });

  it("guesses no city when only a street stands above it", () => {
    expect(() =>
      cityOf([
        "[62110]",
        "AMD",
        "416 Boulevard Ferdinand de Lesseps",
        "62110 France",
      ]),
    ).toThrow(ExtractionError);
  });
});

/**
 * ── A POSTCODE IS NEVER PART OF THE CITY EITHER ─────────────────────────────
 * A real uploaded order prints `FR-6212603 Wimille` — the postcode with a
 * three-digit suffix run onto it. No rule recognised that as a postcode line,
 * so the whole string became the destination, and a Trip in the database still
 * records the city as `Fr-6212603 Wimille`.
 *
 * The number is dropped and the name after it is the city, whatever the digit
 * run's length. That is the same rule `readBarePostcode` applies to
 * `9940 Evergem`; only the malformed length made this line escape it.
 */
describe("a malformed postcode in front of the city", () => {
  const WIMILLE = [
    "[62126]",
    "Continentale Wimille",
    "C&D Foods",
    "Zone Industrielle de la Tresorerie",
    "FR-6212603 Wimille",
    "France",
  ];

  it("reads the city after the postcode, not the whole line", () => {
    const result = extractAddress(addressBlock(WIMILLE), header);

    expect(result.destinationCity).toBe("Wimille");
    expect(result.destinationCountry).toBe("France");
  });

  it("keeps no digit in the city", () => {
    expect(cityOf(WIMILLE)).not.toMatch(/\d/);
  });

  /** A house number is not a postcode: a street must still not become a city. */
  it("refuses a street where the city should be", () => {
    expect(() =>
      cityOf([
        "[62110]",
        "AMD",
        "Zone Industrielle",
        "416 Boulevard Ferdinand de Lesseps",
        "France",
      ]),
    ).toThrow(ExtractionError);
  });
});

/**
 * ── THE NEGATIVE ASSERTION, STATED DIRECTLY ─────────────────────────────────
 * Whatever the block contains, the city that comes out is never one of the
 * five — across every layout the parser knows.
 */
describe("no layout ever yields a country as the city", () => {
  it.each([
    [["[9130]", "DP World", "Ketenislaan 1", "Kallo, Belgium"]],
    [["[9130]", "DP World", "Ketenislaan 1", "BE-9130 Kallo"]],
    [["[62110]", "AMD", "Boulevard Ferdinand", "Heinin-Beaumont", "62110 France"]],
    [["[8730]", "Company", "Street 1", "BE-8730 Beernem", "Belgium"]],
    [["[2040]", "Company", "Street 1", "2040 Antwerpen", "Belgium"]],
    [["[9940]", "Company", "Street 1", "9940 Evergem,", "Belgium"]],
  ])("never yields a country from %p", (lines) => {
    const city = cityOf(lines);

    expect(isCountryName(city)).toBe(false);
    expect(FORBIDDEN.map((name) => name.toLowerCase())).not.toContain(
      city.trim().toLowerCase(),
    );
  });
});

/**
 * ── AN INSTRUCTION IS NOT AN ADDRESS ────────────────────────────────────────
 * A real order printed an operational instruction inside the address column:
 *
 *   Ks Project Logistics
 *   Graanweg 17,
 *   Moerdijk, 4782 PP ,
 *   Netherlands
 *   ADD DELIVERY TO REMARKS
 *
 * It carries no label, so the rule that ends an address at the sender's notes
 * did not see it, and it is printed at the SAME column as the company and the
 * country, so no boundary excluded it. It became the destination city.
 *
 * The shape below is the real one: the value column at x98, which is where
 * `addressBlock` puts every line.
 */
describe("an operational instruction inside the address column", () => {
  const REAL_BLOCK = [
    "[4782]",
    "Ks Project Logistics",
    "Graanweg 17,",
    "Moerdijk, 4782 PP ,",
    "Netherlands",
    "ADD DELIVERY TO REMARKS",
  ];

  it("does not become the city", () => {
    expect(cityOf(REAL_BLOCK)).toBe("Moerdijk");
  });

  it("does not prevent the country from being read", () => {
    expect(extractAddress(addressBlock(REAL_BLOCK), header).destinationCountry).toBe(
      "Netherlands",
    );
  });

  /** Not in the city, not in the country, not in the raw address text. */
  it("appears in no address field at all", () => {
    const address = extractAddress(addressBlock(REAL_BLOCK), header);

    for (const value of [
      address.destinationCity,
      address.destinationCountry ?? "",
      address.rawAddress,
    ]) {
      expect(value.toUpperCase()).not.toContain("ADD DELIVERY TO REMARKS");
      expect(value.toUpperCase()).not.toContain("REMARKS");
    }
  });

  /** The same instruction about the other leg is the same instruction. */
  it("is excluded for the collection leg too", () => {
    expect(
      cityOf([
        "[4782]",
        "Ks Project Logistics",
        "Graanweg 17,",
        "Moerdijk, 4782 PP ,",
        "Netherlands",
        "ADD COLLECTION TO REMARKS",
      ]),
    ).toBe("Moerdijk");
  });

  /** Case and spacing are the printer's business, not the rule's. */
  it("is recognised however it is spaced or cased", () => {
    expect(
      cityOf([
        "[4782]",
        "Ks Project Logistics",
        "Graanweg 17,",
        "Moerdijk, 4782 PP ,",
        "Netherlands",
        "  Add   Delivery   To   Remarks  ",
      ]),
    ).toBe("Moerdijk");
  });

  /**
   * Dropped rather than treated as the end of the address: an instruction
   * printed above the city must not truncate the block.
   */
  it("does not truncate the address when it comes first", () => {
    expect(
      cityOf([
        "[4782]",
        "ADD DELIVERY TO REMARKS",
        "Ks Project Logistics",
        "Graanweg 17,",
        "Moerdijk, 4782 PP ,",
        "Netherlands",
      ]),
    ).toBe("Moerdijk");
  });
});

/**
 * ── THE CITY MAY CARRY ITS POSTCODE ON EITHER SIDE ──────────────────────────
 * `9940 Evergem,` was already read. `Moerdijk, 4782 PP ,` is the same two facts
 * in the other order, and matched no rule at all — the digit guard that keeps a
 * street out refused it, and it fell through to the last resort.
 */
describe("a city line carrying its own postcode", () => {
  it.each([
    [["[4782]", "Company", "Street 1", "Moerdijk, 4782 PP ,", "Netherlands"], "Moerdijk"],
    [["[9940]", "Company", "Street 1", "Evergem, 9940,", "Belgium"], "Evergem"],
    [["[9940]", "Company", "Street 1", "9940 Evergem,", "Belgium"], "Evergem"],
    [["[2040]", "Company", "Street 1", "2040 Antwerpen", "Belgium"], "Antwerpen"],
    [
      ["[4782]", "Company", "Street 1", "Saint Laurent Blangy, 62223", "France"],
      "Saint Laurent Blangy",
    ],
  ])("reads %p as %s", (lines, expected) => {
    expect(cityOf(lines)).toBe(expected);
  });

  /**
   * The guard that keeps a street out must survive the new form. A house number
   * is not a postcode, so the line is still refused and the address with it.
   */
  it("still refuses a street above the country", () => {
    expect(() =>
      cityOf(["[62110]", "AMD", "Zone Industrielle", "Rue de Kan 7,", "France"]),
    ).toThrow(ExtractionError);
  });

  it("still refuses a city line that is only a country", () => {
    expect(() =>
      cityOf(["[9130]", "DP World", "Ketenislaan 1", "Belgium", "Netherlands"]),
    ).toThrow(ExtractionError);
  });
});

/**
 * ── A COUNTRY-PREFIXED POSTCODE WITH THE CITY BESIDE IT ─────────────────────
 * The prefixed form and the Dutch letter pair, on one line:
 *
 *   NL-4612PS Bergen op Zoom
 *
 * Each half was already understood, by a different rule. The prefixed rule
 * required whitespace straight after the digits, so `PS` stopped it; the bare
 * rule required the line to begin with a digit, so `NL-` stopped it. Both now
 * build their pattern from the same postcode fragment.
 *
 * The country comes from the PREFIX, which is what makes this line sufficient
 * on its own — no country line follows it in the real document.
 */
describe("a country-prefixed postcode followed by the city", () => {
  const block = (line: string) => [
    "[4612]",
    "Sabic IP - BoZ site",
    "C/O DSV - DSV Logistics",
    line,
  ];

  it.each([
    ["NL-4612PS Bergen op Zoom", "Bergen Op Zoom"],
    ["NL-4704RG Roosendaal", "Roosendaal"],
    ["NL-4704 RG Roosendaal", "Roosendaal"],
    // Multi-word, and the separators a real form prints.
    ["NL-1011AB Den Haag", "Den Haag"],
    ["NL-2596 HV 's-Gravenhage Zuid", "'S-Gravenhage Zuid"],
  ])("reads %p as %p", (line, expected) => {
    expect(cityOf(block(line))).toBe(expected);
  });

  it("takes the country from the prefix, not from a country line", () => {
    const address = extractAddress(
      addressBlock(block("NL-4612PS Bergen op Zoom")),
      header,
    );

    expect(address.destinationCountry).toBe("Netherlands");
  });

  it.each([
    ["BE-8730AB Beernem", "Belgium"],
    ["F-62119 DOURGES", "France"],
  ])("still resolves %p to %s", (line, country) => {
    expect(
      extractAddress(addressBlock(block(line)), header).destinationCountry,
    ).toBe(country);
  });

  /**
   * The letter pair is optional, so the forms that never carried one must read
   * exactly as they did before. `62119 DO` in `F-62119 DOURGES` looks like a
   * postcode suffix until the separator that must follow is missing, and the
   * regex backtracks out of it.
   */
  it.each([
    ["F-62119 DOURGES", "Dourges"],
    ["FR-59166 Bousbecque", "Bousbecque"],
    ["BE-9130 Kallo", "Kallo"],
    ["be-8580 Avelgem", "Avelgem"],
    ["BE-8730 Beernem", "Beernem"],
    ["F - 62126 Wimille", "Wimille"],
  ])("leaves the un-suffixed form %p reading as %p", (line, expected) => {
    expect(cityOf(block(line))).toBe(expected);
  });

  /** A city of exactly two capitals is a city, not a postcode suffix. */
  it("does not swallow a two-letter city", () => {
    expect(cityOf(block("BE-9130 KA"))).toBe("Ka");
  });

  /**
   * The forbidden-country validation is untouched by the wider postcode.
   *
   * `NL-4612PS Netherlands` is a postcode and a COUNTRY, not a postcode and a
   * city, so the prefixed rule declines it and its sibling reads the city from
   * the line above — the pre-existing behaviour for `62110 France`, unchanged
   * here. What matters either way is that the country never becomes the city.
   */
  it("reads a postcode-and-country line as the country, city above", () => {
    const address = extractAddress(
      addressBlock([
        "[4612]",
        "Sabic IP - BoZ site",
        "Lelyweg 30",
        "Bergen op Zoom",
        "NL-4612PS Netherlands",
      ]),
      header,
    );

    expect(address.destinationCity).toBe("Bergen Op Zoom");
    expect(address.destinationCountry).toBe("Netherlands");
  });

  it("never yields the country as the city on this layout", () => {
    for (const line of ["NL-4612PS Netherlands", "BE-8730 Belgium"]) {
      const city = cityOf([
        "[4612]",
        "Company",
        "Street 1",
        "Bergen op Zoom",
        line,
      ]);

      expect(isCountryName(city)).toBe(false);
    }
  });
});

/**
 * The layouts that do NOT put the postcode and the city on one line keep
 * working: the widened pattern must not start claiming lines it never read.
 */
describe("the separate postcode and city layouts are unchanged", () => {
  it.each([
    [["[9130]", "DP World", "Ketenislaan 1", "Kallo", "Belgium"], "Kallo"],
    [["[4704]", "Company", "Street 1", "4704RG Roosendaal", "Netherlands"], "Roosendaal"],
    [["[4704]", "Company", "Street 1", "4704 RG Roosendaal", "Netherlands"], "Roosendaal"],
    [["[2040]", "Company", "Street 1", "2040 Antwerpen", "Belgium"], "Antwerpen"],
    [["[2070]", "Company", "Street 1", "Zwijndrecht"], "Zwijndrecht"],
  ])("reads %p as %p", (lines, expected) => {
    expect(cityOf(lines)).toBe(expected);
  });
});
