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
    ).toBe("PVDU 301326/0");
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

    it("refuses when no line states that postcode's country", () => {
      expect(() =>
        extractAddress(
          addressBlock(["[2040]", "Ineos Styrolution", "2040 Antwerpen"]),
          header,
        ),
      ).toThrow(ExtractionError);
    });

    it("refuses when a different postcode is the only prefixed one", () => {
      expect(() =>
        extractAddress(
          withDepotLine(
            ["[2040]", "Ineos Styrolution", "2040 Antwerpen"],
            "BE-9130 Kallo",
          ),
          header,
        ),
      ).toThrow(ExtractionError);
    });

    /*
     * A document contradicting itself is a document nobody can trust. It is
     * refused rather than resolved by preferring one of the two.
     */
    it("refuses when the document states two countries for that postcode", () => {
      const fragments = [
        ...withDepotLine(
          ["[2040]", "Ineos Styrolution", "2040 Antwerpen"],
          "BE-2040 Antwerp",
        ),
        { page: 1, x: 98, y: 100, text: "NL-2040 Zandvoort" },
      ];

      expect(() => extractAddress(fragments, header)).toThrow(ExtractionError);
    });
  });

  /**
   * The whole point of the two variations is that they are NARROW. A block
   * with nothing city-shaped in it must still be refused.
   */
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
