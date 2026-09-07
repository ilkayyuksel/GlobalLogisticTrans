import { extractAddress } from "../src/fields/address";
import { ExtractionError } from "../src/errors";
import { Fragment } from "../src/text/extract";

/**
 * A postcode printed TWICE, immediately before the city.
 *
 * ── THE LAYOUT ──────────────────────────────────────────────────────────────
 * A real order (`BUG-CITY/transportorder1376481.pdf`) prints its loading
 * address like this:
 *
 *     [9160]
 *     Willems Biscuits
 *     Zoomstraat 2 AA
 *     9160 9160 Lokeren
 *     Belgium
 *
 * The form has put the customer's postcode field and the address line's own
 * postcode side by side. Every rule that reads a postcode expects exactly one,
 * and each requires a LETTER immediately after it — the guard that keeps a
 * house number out of the city field — so the second number stopped all of
 * them and the document was reported as having no readable city.
 *
 * ── AND WHAT MUST NOT FOLLOW FROM THE FIX ───────────────────────────────────
 * "Two numbers then a word" is NOT the rule. Only a genuine repeat is absorbed,
 * because the pattern matches the second occurrence against the first by
 * backreference. Two DIFFERENT numbers still read as nothing, which is what
 * keeps a street or a reference line out of the city field.
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

describe("a postcode printed twice before the city", () => {
  /** The document that produced this rule, line for line. */
  const REAL = [
    "[9160]",
    "Willems Biscuits",
    "Zoomstraat 2 AA",
    "9160 9160 Lokeren",
    "Belgium",
  ];

  it("reads the city from `9160 9160 Lokeren`", () => {
    expect(read(REAL).destinationCity).toBe("Lokeren");
  });

  it("keeps the country from the line below", () => {
    expect(read(REAL).destinationCountry).toBe("Belgium");
  });

  it("keeps the whole block for diagnostics", () => {
    expect(read(REAL).rawAddress).toContain("9160 9160 Lokeren");
  });

  /**
   * The same duplication with no country line at all. The city is still read;
   * the country is reported ABSENT rather than guessed from the digits, which
   * is what every bare postcode does.
   */
  it("reads the city when no country is stated", () => {
    const result = read([
      "[9160]",
      "Willems Biscuits",
      "Zoomstraat 2 AA",
      "9160 9160 Lokeren",
    ]);

    expect(result.destinationCity).toBe("Lokeren");
    expect(result.destinationCountry).toBeNull();
  });

  /** A multi-word city survives the duplication too. */
  it("keeps every word of a multi-word city", () => {
    const result = read([
      "[4612]",
      "Acme BV",
      "Havenweg 12",
      "4612 4612 Bergen op Zoom",
      "Netherlands",
    ]);

    expect(result.destinationCity).toBe("Bergen Op Zoom");
    expect(result.destinationCountry).toBe("Netherlands");
  });

  /** The Dutch letter pair is part of the postcode, so it repeats with it. */
  it("accepts a repeated Dutch postcode", () => {
    const result = read([
      "[4704]",
      "Acme BV",
      "Havenweg 12",
      "4704RG 4704RG Roosendaal",
      "Netherlands",
    ]);

    expect(result.destinationCity).toBe("Roosendaal");
  });

  describe("what stays refused", () => {
    /**
     * The guard that matters most. Two DIFFERENT numbers are not a postcode
     * printed twice, and the second must not be read as part of the city or
     * silently skipped.
     */
    it("refuses two different numbers before a word", () => {
      expect(() =>
        read([
          "[1234]",
          "Acme BV",
          "Havenweg 12",
          "1234 5678 Lokeren",
          "Belgium",
        ]),
      ).toThrow(ExtractionError);
    });

    /** A house number is not a postcode, however it is followed. */
    it("refuses a street that repeats its own number", () => {
      expect(() =>
        read(["[1234]", "Acme BV", "Havenweg 12 12 Zuid", "Belgium"]),
      ).toThrow(ExtractionError);
    });

    /** A repeat with nothing after it names no place. */
    it("refuses a duplicated postcode with no city", () => {
      expect(() =>
        read(["[9160]", "Acme BV", "Zoomstraat 2 AA", "9160 9160", "Belgium"]),
      ).toThrow(ExtractionError);
    });

    /** And a country still never becomes the city. */
    it("refuses to read the country as the city", () => {
      const result = read([
        "[9160]",
        "Willems Biscuits",
        "Zoomstraat 2 AA",
        "9160 9160 Lokeren",
        "Belgium",
      ]);

      expect(result.destinationCity).not.toBe("Belgium");
    });
  });

  /**
   * Every layout that already worked, asserted here beside the new one so a
   * change to the shared postcode pattern cannot quietly cost one of them.
   */
  describe("the formats that already worked", () => {
    it.each([
      [["[4704]", "Acme BV", "Havenweg 12", "4704RG Roosendaal"], "Roosendaal"],
      [["[4704]", "Acme BV", "Havenweg 12", "4704 RG Roosendaal"], "Roosendaal"],
      [
        ["[4612]", "Acme BV", "Havenweg 12", "NL-4612PS Bergen op Zoom"],
        "Bergen Op Zoom",
      ],
      [["[62119]", "Acme SA", "Rue Longue 3", "F-62119 DOURGES"], "Dourges"],
      [["[9130]", "Acme BV", "Ketenislaan 1", "BE-9130 Kallo"], "Kallo"],
      [["[2040]", "Acme BV", "Havenweg 12", "2040 Antwerpen"], "Antwerpen"],
    ])("reads %j as %s", (lines, expected) => {
      expect(read(lines as string[]).destinationCity).toBe(expected);
    });

    /** The bracketed layout, where the bracket is the only postcode. */
    it("still reads a bracketed block with no postcode beside the city", () => {
      const result = read([
        "[2070]",
        "BE01: Exxonmobil",
        "CANADASTRAAT 20",
        "ZWIJNDRECHT",
        "Gate 3",
      ]);

      expect(result.destinationCity).toBe("Zwijndrecht");
    });

    /** Postcode and city on separate lines, with the country below. */
    it("still reads a postcode-only line above the city", () => {
      const result = read([
        "[62110]",
        "AMD",
        "416 Boulevard Ferdinand de Lesseps",
        "Heinin-Beaumont",
        "62110 France",
      ]);

      expect(result.destinationCity).toBe("Heinin-Beaumont");
      expect(result.destinationCountry).toBe("France");
    });

    /** A city and country sharing one line is unchanged. */
    it("still reads `9940 Evergem, Belgium`", () => {
      const result = read([
        "[9940]",
        "Acme BV",
        "Havenweg 12",
        "9940 Evergem, Belgium",
      ]);

      expect(result.destinationCity).toBe("Evergem");
      expect(result.destinationCountry).toBe("Belgium");
    });
  });
});
