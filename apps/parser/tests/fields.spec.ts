import { extractAddress } from "../src/fields/address";
import { extractBookingAndDirection } from "../src/fields/booking";
import {
  extractContainerNumber,
  extractContainerType,
} from "../src/fields/container";
import {
  COUNTRY_BY_POSTCODE_PREFIX,
  countryFromName,
} from "../src/fields/country";
import { extractDateTime } from "../src/fields/date-time";
import { extractTerminal } from "../src/fields/terminal";
import { ExtractionError } from "../src/errors";
import { Fragment } from "../src/text/extract";
import { toTitleCase } from "../src/text/normalize";

/**
 * Field rules tested on positioned text rather than through a PDF.
 *
 * The shapes below are copied from the fixtures — same labels, same columns —
 * so a rule can be exercised against a case the business has not sent us yet
 * without inventing a PDF to hold it. The full documents are covered by the
 * golden tests in `parser.spec.ts`.
 */

let nextY = 500;

/** A fragment at an explicit column; y descends automatically. */
function at(x: number, text: string, y?: number): Fragment {
  if (y === undefined) {
    nextY -= 12;
  }

  return { page: 1, x, y: y ?? nextY, text };
}

function row(y: number, ...parts: [number, string][]): Fragment[] {
  return parts.map(([x, text]) => ({ page: 1, x, y, text }));
}

beforeEach(() => {
  nextY = 500;
});

describe("booking number and direction", () => {
  it("takes the booking and discards the trip number after the slash", () => {
    const result = extractBookingAndDirection([
      at(304, "COLLECTION Bookings nr/Trip nr: ANRDUB2602247 /67036944"),
    ]);

    expect(result.bookingNumber).toBe("ANRDUB2602247");
    expect(result.direction).toBe("COLLECTION");
  });

  it("reads a delivery header", () => {
    const result = extractBookingAndDirection([
      at(316, "DELIVERY Bookings nr/Trip nr: DUBANR2598395 /66906824"),
    ]);

    expect(result.bookingNumber).toBe("DUBANR2598395");
    expect(result.direction).toBe("DELIVERY");
  });

  it("accepts a matching 'Booking no:' field", () => {
    const result = extractBookingAndDirection([
      ...row(500, [
        304,
        "COLLECTION Bookings nr/Trip nr: ANRDUB2602247 /67036944",
      ]),
      ...row(480, [31, "Booking no:"], [120, "ANRDUB2602247"]),
    ]);

    expect(result.bookingNumber).toBe("ANRDUB2602247");
    expect(result.matchedLabels).toContain("Booking no:");
  });

  /**
   * A wrong booking number attaches the trip to the wrong transport order, and
   * every later UPDATE and CANCEL matches on it. Guessing which half of a
   * self-contradicting document is right is not worth that risk.
   */
  it("refuses a document that states two different booking numbers", () => {
    expect(() =>
      extractBookingAndDirection([
        ...row(500, [
          304,
          "COLLECTION Bookings nr/Trip nr: ANRDUB2602247 /67036944",
        ]),
        ...row(480, [31, "Booking no:"], [120, "ANRDUB9999999"]),
      ]),
    ).toThrow(ExtractionError);
  });

  it("names the conflict when it refuses", () => {
    try {
      extractBookingAndDirection([
        ...row(500, [304, "DELIVERY Bookings nr/Trip nr: AAA111 /1"]),
        ...row(480, [31, "Booking no:"], [120, "BBB222"]),
      ]);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).reason).toBe(
        "INCONSISTENT_BOOKING_NUMBER",
      );
      expect((error as Error).message).toContain("AAA111");
      expect((error as Error).message).toContain("BBB222");
    }
  });

  it("fails when no booking line exists at all", () => {
    expect(() =>
      extractBookingAndDirection([at(31, "VOYAGE DETAILS:")]),
    ).toThrow(/Bookings nr\/Trip nr/);
  });

  /** `Trip type: Truck Standard` is a Eucon service level, not the direction. */
  it("ignores the document's own 'Trip type:' field", () => {
    const result = extractBookingAndDirection([
      ...row(500, [
        316,
        "DELIVERY Bookings nr/Trip nr: DUBANR2598395 /66906824",
      ]),
      ...row(480, [246, "Trip type:"], [298, "Truck Standard"]),
    ]);

    expect(result.direction).toBe("DELIVERY");
  });
});

describe("container", () => {
  it("reads the container type beside its label", () => {
    expect(
      extractContainerType(row(500, [163, "Cntr type:"], [219, "45PH"])),
    ).toBe("45PH");
  });

  /** The catalogue is open-ended; the documents say "etc.". */
  it.each(["45PH", "45RH", "20TK", "20RF", "40HC", "22G1"])(
    "accepts %s without a hardcoded list",
    (type) => {
      expect(
        extractContainerType(row(500, [163, "Cntr type:"], [219, type])),
      ).toBe(type);
    },
  );

  it("skips a label whose neighbour is not a container type", () => {
    const fragments = [
      ...row(500, [163, "Cntr type:"], [219, "Temp:"]),
      ...row(480, [163, "Cntr type:"], [219, "45RH"]),
    ];

    expect(extractContainerType(fragments)).toBe("45RH");
  });

  it("fails when no container type is present", () => {
    expect(() => extractContainerType([at(31, "Weight:")])).toThrow(
      /Cntr type/,
    );
  });

  it("returns the container number when the document states one", () => {
    expect(
      extractContainerNumber(
        row(500, [31, "Container:"], [134, "PVDU 301326/0"]),
      ),
    ).toBe("PVDU3013260");
  });

  /** A collection has no container yet; that is normal, not an error. */
  it("returns null when no container is stated", () => {
    expect(
      extractContainerNumber([at(31, "Weight:"), at(31, "Cargo (stc):")]),
    ).toBeNull();
  });

  it("never invents a container number", () => {
    expect(extractContainerNumber([])).toBeNull();
  });
});

describe("address", () => {
  /** Mirrors the fixtures: section header, then the value column at x98. */
  function addressBlock(lines: string[]): Fragment[] {
    const fragments: Fragment[] = [
      { page: 1, x: 26, y: 400, text: "LOADING 1:" },
    ];

    fragments.push({ page: 1, x: 30, y: 380, text: "Address:" });
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

  const header: Fragment = { page: 1, x: 26, y: 400, text: "LOADING 1:" };

  it("reads the city from the postcode line, not from a line position", () => {
    const result = extractAddress(
      addressBlock([
        "[62119]",
        "ONTEX Dourges",
        "Quai du Rivage",
        "F-62119 DOURGES",
      ]),
      header,
    );

    expect(result.destinationCity).toBe("Dourges");
    expect(result.destinationCountry).toBe("France");
  });

  it("prefers a stated country line over the postcode prefix", () => {
    const result = extractAddress(
      addressBlock([
        "[59166]",
        "WEPA France SAS",
        "FR-59166 Bousbecque",
        "France",
      ]),
      header,
    );

    expect(result.destinationCountry).toBe("France");
    expect(result.rawAddress).toContain("France");
  });

  it("ignores a remark sitting where the country would be", () => {
    const result = extractAddress(
      addressBlock([
        "[59166]",
        "WEPA France SAS",
        "FR-59166 Bousbecque",
        "Loading Ref: 11554650",
      ]),
      header,
    );

    expect(result.destinationCountry).toBe("France");
    expect(result.rawAddress).not.toContain("Loading Ref");
  });

  /**
   * ── THE LOWER-CASE PREFIX ────────────────────────────────────────────────
   * A real order (transportorder1372937.pdf) prints its address exactly like
   * this, in lower case:
   *
   *     [8580]
   *     IVC bvba
   *     Nijverheidslaan 29
   *     be-8580 Avelgem
   *
   * The postcode rule required `[A-Z]{1,2}` and declined it. So did every
   * other rule — the bare-postcode form needs the line to start with digits,
   * and the bracketed last resort refuses a final line containing a digit,
   * which this one does. All four declined and the parser reported that a
   * document naming its destination unmistakably had no readable city.
   *
   * Letter case is a typographical choice by whoever filled in the form. It
   * says nothing about what the line means.
   */
  describe("a postcode prefix printed in lower case", () => {
    const AVELGEM = [
      "[8580]",
      "IVC bvba",
      "Nijverheidslaan 29",
      "be-8580 Avelgem",
    ];

    it("reads the city", () => {
      const result = extractAddress(addressBlock(AVELGEM), header);

      expect(result.destinationCity).toBe("Avelgem");
    });

    /** The prefix is upper-cased before the country table is consulted. */
    it("resolves the country from the lower-case prefix", () => {
      const result = extractAddress(addressBlock(AVELGEM), header);

      expect(result.destinationCountry).toBe("Belgium");
    });

    /** Each of these was a plausible wrong answer while the rule declined. */
    it.each([
      "IVC bvba",
      "Nijverheidslaan 29",
      "8580",
      "be-8580",
      "be-8580 Avelgem",
      "[8580]",
    ])("never reads %s as the city", (wrong) => {
      expect(extractAddress(addressBlock(AVELGEM), header).destinationCity).not.toBe(
        wrong,
      );
    });

    /** The whole block survives as evidence, the reference line included. */
    it("keeps the address block as raw evidence", () => {
      const result = extractAddress(addressBlock(AVELGEM), header);

      expect(result.rawAddress).toBe(
        "[8580] IVC bvba Nijverheidslaan 29 be-8580 Avelgem",
      );
      expect(result.section).toBe("LOADING 1");
    });

    /** No remark may reach the address, whatever the prefix looks like. */
    it("still stops at a loading reference", () => {
      const result = extractAddress(
        addressBlock([...AVELGEM, "Loading Ref: NUT35/149911"]),
        header,
      );

      expect(result.destinationCity).toBe("Avelgem");
      expect(result.rawAddress).not.toContain("Loading Ref");
    });

    it.each([
      ["be-8580 Avelgem", "Avelgem", "Belgium"],
      ["Be-8580 Avelgem", "Avelgem", "Belgium"],
      ["BE-8580 Avelgem", "Avelgem", "Belgium"],
      ["f-62119 DOURGES", "Dourges", "France"],
      ["nl-1234 Bergen op Zoom", "Bergen Op Zoom", "Netherlands"],
    ])("reads %s whatever its case", (line, city, country) => {
      const result = extractAddress(
        addressBlock(["[1234]", "Somewhere BV", "Some Street 1", line]),
        header,
      );

      expect(result.destinationCity).toBe(city);
      expect(result.destinationCountry).toBe(country);
    });
  });

  /**
   * The PREVIOUS city fix, which split one printed line into two fragments.
   * That mechanism is untouched by the case change and must stay working.
   */
  it("still reads a city that the form split across two fragments", () => {
    const fragments: Fragment[] = [
      { page: 1, x: 26, y: 400, text: "LOADING 1:" },
      { page: 1, x: 30, y: 380, text: "Address:" },
      { page: 1, x: 98, y: 380, text: "[62223]" },
      { page: 1, x: 98, y: 368, text: "SOME COMPANY" },
      { page: 1, x: 98, y: 356, text: "RUE DU CHEMIN 4" },
      // One printed line, two positioned runs — the earlier regression.
      { page: 1, x: 97.5, y: 344, text: "62223" },
      { page: 1, x: 125.4, y: 344, text: "SAINT LAURENT BLANGY" },
      { page: 1, x: 32, y: 320, text: "Date/time:" },
    ];

    const result = extractAddress(fragments, header);

    expect(result.destinationCity).toBe("Saint Laurent Blangy");
  });

  it("handles a city of several words", () => {
    const result = extractAddress(
      addressBlock(["[1234]", "Somewhere BV", "NL-1234 Bergen op Zoom"]),
      header,
    );

    expect(result.destinationCity).toBe("Bergen Op Zoom");
    expect(result.destinationCountry).toBe("Netherlands");
  });

  it("refuses an address with no postcode line", () => {
    expect(() =>
      extractAddress(
        addressBlock(["[62119]", "ONTEX Dourges", "Quai du Rivage"]),
        header,
      ),
    ).toThrow(ExtractionError);
  });

  it("refuses an unknown postcode prefix with no country line", () => {
    expect(() =>
      extractAddress(
        addressBlock(["[999]", "Somewhere", "ZZ-9999 Nowhere"]),
        header,
      ),
    ).toThrow(/country mapping/);
  });

  /**
   * ── VARIATION 1 — the country spelled out ─────────────────────────────────
   * A real order prints its postcode only in the bracketed reference and ends
   * the address with the country as a word. The word is what the document
   * states, so it decides, and the line above it is the city.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("an address whose country is a word", () => {
    it("reads the city from the line above the country", () => {
      const result = extractAddress(
        addressBlock([
          "[9130]",
          "Kato KTN BHSA REPL",
          "Oudedijk 1 Blokveld 44",
          "Kallo",
          "Belgium",
        ]),
        header,
      );

      expect(result.destinationCity).toBe("Kallo");
      expect(result.destinationCountry).toBe("Belgium");
    });

    it("accepts the country in the languages the documents print", () => {
      for (const [word, country] of [
        ["Belgium", "Belgium"],
        ["België", "Belgium"],
        ["Frankrijk", "France"],
        ["Nederland", "Netherlands"],
      ] as const) {
        const result = extractAddress(
          addressBlock(["[1000]", "Somewhere BV", "Ergens", word]),
          header,
        );

        expect(result.destinationCountry).toBe(country);
      }
    });

    it("keeps the country word out of the city", () => {
      const result = extractAddress(
        addressBlock(["[9130]", "Kato KTN", "Kallo", "Belgium"]),
        header,
      );

      expect(result.destinationCity).not.toContain("Belgium");
    });

    /*
     * The normal form still wins. A block with both a prefixed postcode line
     * and a country word must read the postcode line, exactly as before.
     */
    it("never overrides a proper postcode line", () => {
      const result = extractAddress(
        addressBlock([
          "[59166]",
          "WEPA France SAS",
          "FR-59166 Bousbecque",
          "France",
        ]),
        header,
      );

      expect(result.destinationCity).toBe("Bousbecque");
    });

    it("refuses a country word with no city above it", () => {
      expect(() =>
        extractAddress(addressBlock(["Belgium"]), header),
      ).toThrow(ExtractionError);
    });
  });

  /**
   * ── VARIATION 2 — a bare postcode ─────────────────────────────────────────
   * `2040 Antwerpen` names no country. A four-digit postcode exists in many
   * countries, so it is resolved ONLY from an explicit `CC-<same postcode>`
   * printed elsewhere in the document — in the real order, the depot line
   * `BE-2040 Antwerp`. Never from the number itself.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("an address whose postcode has no country prefix", () => {
    /** The depot line the real document prints further down the page. */
    function withDepotLine(lines: string[], depot: string): Fragment[] {
      return [
        ...addressBlock(lines),
        { page: 1, x: 98, y: 120, text: depot },
      ];
    }

    it("takes the country from the same postcode stated elsewhere", () => {
      const result = extractAddress(
        withDepotLine(
          [
            "[2040]",
            "Ineos Styrolution gate 6",
            "scheldelaan 600 - tor 6",
            "2040 Antwerpen",
          ],
          "BE-2040 Antwerp",
        ),
        header,
      );

      expect(result.destinationCity).toBe("Antwerpen");
      expect(result.destinationCountry).toBe("Belgium");
    });

    /*
     * ── AN UNSTATED COUNTRY IS ABSENT, NOT A REFUSAL ────────────────────────
     * A real order prints "3980 Tessenderlo" and names no country anywhere. The
     * city is beyond doubt; the country is genuinely unknown, and the number
     * settles nothing — 59554 is Raillencourt-Sainte-Olle in France and
     * Lippstadt in Germany. Refusing the whole document over a field it never
     * claimed threw away a perfectly readable destination.
     * ────────────────────────────────────────────────────────────────────────
     */
    it("reads the city and reports no country when none is stated", () => {
      const result = extractAddress(
        addressBlock(["[2040]", "Ineos Styrolution", "2040 Antwerpen"]),
        header,
      );

      expect(result.destinationCity).toBe("Antwerpen");
      expect(result.destinationCountry).toBeNull();
    });

    it("does not borrow the country of a different postcode", () => {
      const result = extractAddress(
        withDepotLine(
          ["[2040]", "Ineos Styrolution", "2040 Antwerpen"],
          "BE-9130 Kallo",
        ),
        header,
      );

      expect(result.destinationCity).toBe("Antwerpen");
      // 9130 is not 2040, so it says nothing about this address.
      expect(result.destinationCountry).toBeNull();
    });

    /*
     * A document contradicting itself is a document nobody can trust on that
     * point. The city still reads; the country is left unstated rather than
     * resolved by preferring one of the two.
     */
    it("states no country when the document names two for that postcode", () => {
      const fragments = [
        ...withDepotLine(
          ["[2040]", "Ineos Styrolution", "2040 Antwerpen"],
          "BE-2040 Antwerp",
        ),
        { page: 1, x: 98, y: 100, text: "NL-2040 Zandvoort" },
      ];

      const result = extractAddress(fragments, header);

      expect(result.destinationCity).toBe("Antwerpen");
      expect(result.destinationCountry).toBeNull();
    });
  });

  /**
   * The whole point of the two variations is that they are NARROW. A block
   * with nothing city-shaped in it must still be refused.
   */
  describe("an address with remarks under it", () => {
    /**
     * The address column carries the sender's notes below the address. They are
     * introduced by a label, which is the form's own way of saying "this is no
     * longer the address" — so reading stops there rather than at the bottom of
     * the column.
     */
    it("stops at the first labelled line", () => {
      const result = extractAddress(
        addressBlock([
          "[62126]",
          "Continentale Wimille",
          "C&D Foods",
          "Zone Industrielle de la Tresorerie",
          "F - 62126 Wimille",
          "Loading Ref: NUT35/149911",
          "pls fix papers on the last pallet",
        ]),
        header,
      );

      expect(result.destinationCity).toBe("Wimille");
      expect(result.destinationCountry).toBe("France");
      expect(result.rawAddress).not.toContain("pallet");
    });

    /** The spaced hyphen is the same prefixed line as `BE-2040 Antwerpen`. */
    it("reads a country prefix written with spaces around the hyphen", () => {
      const result = extractAddress(
        addressBlock(["Acme", "Main Street 1", "F - 62126 Wimille"]),
        header,
      );

      expect(result.destinationCity).toBe("Wimille");
      expect(result.destinationCountry).toBe("France");
    });

    /**
     * Without the address line there is nothing left to read once the remarks
     * are set aside — which is a refusal, not a licence to use the remark.
     */
    it("refuses rather than falling back on a remark", () => {
      expect(() =>
        extractAddress(
          addressBlock([
            "[62126]",
            "Continentale Wimille",
            "Loading Ref: NUT35/149911",
            "pls fix papers on the last pallet",
          ]),
          header,
        ),
      ).toThrow(/No readable city line/);
    });
  });

  /**
   * ── A PRINTED LINE SPLIT ACROSS TWO FRAGMENTS ─────────────────────────────
   * A PDF stores positioned runs of text, not lines. A wide gap inside a line
   * ends one run and starts another, so
   *
   *     62223            SAINT LAURENT BLANGY
   *
   * reaches the parser as two fragments on one row. Reading only the run that
   * starts at the address column threw the city away and left the block ending
   * in a bare postcode, which no rule can read.
   *
   * The row is joined instead — geometry, not a guess about which fragment
   * looks like a city — and the boundary is the next COLUMN, so the sender's
   * remarks can never be joined onto the address.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a line the PDF split into two fragments", () => {
    /** The same block, with the last line broken in two at a wide gap. */
    function splitLastLine(
      lines: string[],
      tail: string,
      options: { remarks?: string } = {},
    ): Fragment[] {
      const fragments = addressBlock(lines);
      const lastY = 380 - (lines.length - 1) * 12;

      fragments.push({ page: 1, x: 126, y: lastY, text: tail });

      if (options.remarks !== undefined) {
        // The next column, on the label's own row, exactly as the form prints it.
        fragments.push({ page: 1, x: 295, y: 380, text: "Remarks:" });
        fragments.push({ page: 1, x: 350, y: lastY, text: options.remarks });
      }

      return fragments;
    }

    it("joins the row into one line and reads the city from it", () => {
      const result = extractAddress(
        splitLastLine(
          ["[62223]", "Delisle – Saint Laurent", "120 Allée des Atrébates", "62223"],
          "SAINT LAURENT BLANGY",
        ),
        header,
      );

      expect(result.destinationCity).toBe("Saint Laurent Blangy");
    });

    it("keeps the joined line in the raw address", () => {
      const result = extractAddress(
        splitLastLine(
          ["[62223]", "Delisle – Saint Laurent", "120 Allée des Atrébates", "62223"],
          "SAINT LAURENT BLANGY",
        ),
        header,
      );

      expect(result.rawAddress).toContain("62223 SAINT LAURENT BLANGY");
    });

    /** The whole point of the boundary: the next column is a different thing. */
    it("never joins the remarks column onto the address", () => {
      const result = extractAddress(
        splitLastLine(
          ["[62223]", "Delisle – Saint Laurent", "120 Allée des Atrébates", "62223"],
          "SAINT LAURENT BLANGY",
          { remarks: "Loading Ref: 93165142" },
        ),
        header,
      );

      expect(result.destinationCity).toBe("Saint Laurent Blangy");
      expect(result.rawAddress).not.toMatch(/93165142/);
      expect(result.rawAddress).not.toMatch(/Loading Ref/);
    });

    it("still reads a prefixed postcode that arrives split", () => {
      const result = extractAddress(
        splitLastLine(
          ["[62119]", "ONTEX Dourges", "Quai du Rivage", "F-62119"],
          "DOURGES",
        ),
        header,
      );

      expect(result).toMatchObject({
        destinationCity: "Dourges",
        destinationCountry: "France",
      });
    });

    /** A document whose rows are single fragments must read exactly as before. */
    it("changes nothing when every row is one fragment", () => {
      const result = extractAddress(
        addressBlock([
          "[62119]",
          "ONTEX Dourges",
          "Quai du Rivage",
          "F-62119 DOURGES",
        ]),
        header,
      );

      expect(result).toMatchObject({
        destinationCity: "Dourges",
        destinationCountry: "France",
      });
    });
  });

  describe("what is still refused", () => {
    it.each([
      ["only a company and a street", ["[62119]", "ONTEX", "Quai du Rivage"]],
      ["a reference that is not a place", ["[1] ", "Ref 12345", "ID = 8781"]],
      ["nothing at all", []],
    ])("refuses %s", (_what, lines) => {
      expect(() => extractAddress(addressBlock(lines), header)).toThrow(
        ExtractionError,
      );
    });
  });
});

describe("country mapping", () => {
  /** Both prefixes appear in the real orders for France. */
  it.each([
    ["F", "France"],
    ["FR", "France"],
    ["BE", "Belgium"],
    ["NL", "Netherlands"],
  ])("maps prefix %s to %s", (prefix, country) => {
    expect(COUNTRY_BY_POSTCODE_PREFIX[prefix]).toBe(country);
  });

  it.each([
    ["France", "France"],
    ["Belgium", "Belgium"],
    ["België", "Belgium"],
    ["Nederland", "Netherlands"],
  ])("maps the printed name %s to %s", (printed, country) => {
    expect(countryFromName(printed)).toBe(country);
  });

  it("treats anything unrecognised as not a country", () => {
    expect(countryFromName("Loading Ref: 11554650")).toBeNull();
    expect(countryFromName("pls fix papers on the last pallet")).toBeNull();
  });
});

describe("date and time", () => {
  const header: Fragment = { page: 1, x: 26, y: 400, text: "LOADING 1:" };

  function dateLine(value: string): Fragment[] {
    return [header, ...row(300, [32, "Date/time:"], [98, value])];
  }

  it("normalizes DD/MM/YYYY to an ISO date", () => {
    const result = extractDateTime(
      dateLine("22/05/2025 10:00 till 10:00"),
      header,
    );

    expect(result.date).toBe("2025-05-22");
    expect(result.startTime).toBe("10:00");
    expect(result.endTime).toBe("10:00");
  });

  it("keeps a window whose start and end differ", () => {
    const result = extractDateTime(
      dateLine("22/05/2025 08:00 till 12:00"),
      header,
    );

    expect(result.startTime).toBe("08:00");
    expect(result.endTime).toBe("12:00");
  });

  it("reads a date with no times at all", () => {
    const result = extractDateTime(dateLine("22/05/2025"), header);

    expect(result.date).toBe("2025-05-22");
    expect(result.startTime).toBeNull();
    expect(result.endTime).toBeNull();
  });

  /**
   * One timestamp is an appointment, and it becomes a window of zero length —
   * the same thing the many `08:00 till 08:00` orders state in the other
   * spelling. Leaving the end absent would leave the Trip unplannable.
   */
  it("reads a single timestamp as a window of zero length", () => {
    const result = extractDateTime(dateLine("21/08/2026 15:00"), header);

    expect(result.date).toBe("2026-08-21");
    expect(result.startTime).toBe("15:00");
    expect(result.endTime).toBe("15:00");
  });

  /**
   * Two times and no `till`: which one is the start is the document's to say.
   * Reading the first and dropping the second would discard half of what the
   * order stated, so it is refused rather than guessed at.
   */
  it("refuses two times that are not joined by 'till'", () => {
    expect(() =>
      extractDateTime(dateLine("21/08/2026 15:00 17:00"), header),
    ).toThrow(/more than one time/);
  });

  it("refuses a day that does not exist", () => {
    expect(() =>
      extractDateTime(dateLine("31/02/2025 08:00 till 09:00"), header),
    ).toThrow(/not a real calendar date/);
  });

  it("refuses an unrecognised shape", () => {
    expect(() => extractDateTime(dateLine("May 22nd 2025"), header)).toThrow(
      ExtractionError,
    );
  });

  it("fails when the section states no Date/time line", () => {
    expect(() => extractDateTime([header], header)).toThrow(/Date\/time/);
  });
});

describe("terminal", () => {
  it("reads the block under 'Return to Terminal:'", () => {
    const fragments = [
      { page: 1, x: 332, y: 500, text: "Return to Terminal:" },
      { page: 1, x: 332, y: 486, text: "PSA Quay 869" },
      { page: 1, x: 332, y: 474, text: "Europaterminal" },
      { page: 1, x: 332, y: 462, text: "Scheldelaan 495" },
      { page: 1, x: 332, y: 450, text: "BE-2040 Antwerp" },
    ];

    const result = extractTerminal(fragments);

    expect(result?.terminalKey).toBe("PSA Quay 869");
    expect(result?.rawTerminal).toBe(
      "PSA Quay 869 Europaterminal Scheldelaan 495 BE-2040 Antwerp",
    );
    expect(result?.matchedLabel).toBe("Return to Terminal:");
  });

  /**
   * On a delivery the terminal is a bare name, and the column beneath it holds
   * other fields' values.
   */
  it("reads a short terminal beside its label without absorbing the column", () => {
    const fragments = [
      { page: 1, x: 384, y: 500, text: "Terminal:" },
      { page: 1, x: 450, y: 500, text: "Quay 869" },
      { page: 1, x: 384, y: 486, text: "Booking no:" },
      { page: 1, x: 450, y: 484, text: "DUBANR2598395" },
      { page: 1, x: 450, y: 470, text: "P0883 85968" },
    ];

    const result = extractTerminal(fragments);

    expect(result?.terminalKey).toBe("Quay 869");
    expect(result?.rawTerminal).toBe("Quay 869");
  });

  it("follows the documented label priority", () => {
    const fragments = [
      { page: 1, x: 31, y: 500, text: "Startpoint:" },
      { page: 1, x: 120, y: 500, text: "Ignored Startpoint" },
      { page: 1, x: 332, y: 480, text: "Return to Terminal:" },
      { page: 1, x: 332, y: 466, text: "PSA Quay 869" },
      { page: 1, x: 332, y: 454, text: "BE-2040 Antwerp" },
    ];

    expect(extractTerminal(fragments)?.terminalKey).toBe("PSA Quay 869");
  });

  it("falls back to Startpoint when nothing else names a terminal", () => {
    const fragments = [
      { page: 1, x: 31, y: 500, text: "Startpoint:" },
      { page: 1, x: 120, y: 500, text: "PSA Quay 869" },
      { page: 1, x: 120, y: 488, text: "BE-2040 Antwerp" },
    ];

    const result = extractTerminal(fragments);

    expect(result?.terminalKey).toBe("PSA Quay 869");
    expect(result?.matchedLabel).toBe("Startpoint:");
  });

  it("returns null when the document names no terminal", () => {
    expect(
      extractTerminal([{ page: 1, x: 31, y: 500, text: "Weight:" }]),
    ).toBeNull();
  });
});

describe("terminal naming", () => {
  /**
   * The parser reports the document's own words and renames nothing. Deciding
   * what a document's terminal is called in the operator's route configuration
   * is a business decision that lives in the Backend's import layer — the only
   * side that knows the configured names. A rename here would attach a Trip to
   * the wrong route, and therefore to the wrong price, without anything saying
   * so.
   */
  it.each([
    ["PSA Quay 869", "COLLECTION"],
    ["Quay 869", "DELIVERY"],
  ])("returns %s exactly as the document writes it", (terminalName) => {
    const extracted = extractTerminal([
      { page: 1, x: 31, y: 500, text: "Terminal:" },
      { page: 1, x: 120, y: 500, text: terminalName },
    ]);

    expect(extracted?.terminalKey).toBe(terminalName);
  });
});

describe("title casing", () => {
  it.each([
    ["DOURGES", "Dourges"],
    ["Bousbecque", "Bousbecque"],
    ["KALLO", "Kallo"],
    ["SAINT-OMER", "Saint-Omer"],
    ["bergen op zoom", "Bergen Op Zoom"],
  ])("%s becomes %s", (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });
});
