import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse, parseCostConfirmation } from "../src/index";
import { extractAddress } from "../src/fields/address";
import { ExtractionError } from "../src/errors";
import { Fragment } from "../src/text/extract";

/**
 * Three real documents that the parser refused, and the generic rules that now
 * read them.
 *
 * ── WHY THEY FAILED ─────────────────────────────────────────────────────────
 * Each exposed a different assumption, and none of them is about these
 * particular files:
 *
 *   1374605 / 1374603  a Netherlands postcode carries two letters —
 *                      `4704RG Roosendaal` — which no postcode pattern matched,
 *                      so the line was neither a postcode nor a city.
 *
 *   1374593            the city is not the last line of the address. A gate
 *                      follows it, and the company line `BE01: Exxonmobil`
 *                      looked like a form label, which truncated the block to
 *                      the bracketed postcode alone.
 *
 *   CC 4156173         parses correctly as a COST CONFIRMATION and always did.
 *                      It only fails when read as a TRANSPORT ORDER, which
 *                      requires the `Bookings nr/Trip nr:` line this document
 *                      does not print — and correctly so, because it is not a
 *                      transport order.
 *
 * Nothing here is keyed to a filename, a city, a postcode or a booking number.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FIXTURES = resolve(__dirname, "..", "..", "..", "docs", "06-pdf", "NEW-BUG");

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

/** The five country names the vocabulary knows, in every spelling it accepts. */
const NEVER_A_CITY = [
  "france",
  "belgium",
  "netherlands",
  "nederland",
  "germany",
  "luxembourg",
];

describe("the real documents that were refused", () => {
  /**
   * ── A NETHERLANDS POSTCODE ────────────────────────────────────────────────
   * The address block reads:
   *
   *     [4704]
   *     Loendersloot
   *     Borchwerf 25
   *     4704RG Roosendaal
   *     Nederland
   *
   * The country line names the country and the line above it names the city —
   * once the postcode in front of that city can be recognised.
   */
  describe.each(["transportorder1374605.pdf", "transportorder1374603.pdf"])(
    "%s",
    (file) => {
      it("parses", async () => {
        const result = await parse(load(file));

        if (!result.ok) {
          throw new Error(`${result.reason}: ${result.message}`);
        }

        expect(result.trips.length).toBeGreaterThan(0);
      });

      it("reads the city from beside its postcode", async () => {
        const result = await parse(load(file));

        if (!result.ok) throw new Error(result.message);

        expect(result.trips[0].destinationCity).toBe("Roosendaal");
      });

      /**
       * `Nederland` is what the document prints; `Netherlands` is what the
       * system stores. The vocabulary has always mapped the two, and this
       * asserts the stored form rather than the printed one.
       */
      it("reads the country the document states", async () => {
        const result = await parse(load(file));

        if (!result.ok) throw new Error(result.message);

        expect(result.trips[0].destinationCountry).toBe("Netherlands");
      });

      it.each([
        ["the bracketed code", /^\[?\d/],
        ["the company", /Loendersloot/i],
        ["the street", /Borchwerf/i],
      ])("never reads %s as the city", async (_label, pattern) => {
        const result = await parse(load(file));

        if (!result.ok) throw new Error(result.message);

        expect(result.trips[0].destinationCity).not.toMatch(pattern);
      });

      it("never reads the country as the city", async () => {
        const result = await parse(load(file));

        if (!result.ok) throw new Error(result.message);

        expect(NEVER_A_CITY).not.toContain(
          result.trips[0].destinationCity.toLowerCase(),
        );
      });
    },
  );

  /**
   * ── THE CITY IS NOT THE LAST LINE ─────────────────────────────────────────
   *     [2070]
   *     BE01: Exxonmobil
   *     CANADASTRAAT 20
   *     ZWIJNDRECHT
   *     Gate 3
   */
  describe("transportorder1374593.pdf", () => {
    it("parses", async () => {
      const result = await parse(load("transportorder1374593.pdf"));

      if (!result.ok) {
        throw new Error(`${result.reason}: ${result.message}`);
      }

      expect(result.trips.length).toBeGreaterThan(0);
    });

    /**
     * The document prints `ZWIJNDRECHT`; every city this parser produces is
     * title-cased, exactly as `DOURGES` becomes `Dourges`. The casing rule is
     * unchanged — only the fact that the city is found at all is new.
     */
    it("reads the city that sits above the gate", async () => {
      const result = await parse(load("transportorder1374593.pdf"));

      if (!result.ok) throw new Error(result.message);

      expect(result.trips[0].destinationCity).toBe("Zwijndrecht");
    });

    it.each([
      ["the bracketed code", "2070"],
      ["the gate", "Gate"],
      ["the company", "Exxonmobil"],
      ["the street", "CANADASTRAAT"],
    ])("never reads %s as the city", async (_label, text) => {
      const result = await parse(load("transportorder1374593.pdf"));

      if (!result.ok) throw new Error(result.message);

      expect(result.trips[0].destinationCity.toLowerCase()).not.toContain(
        text.toLowerCase(),
      );
    });

    /** No digit belongs in a city name, whichever line it came from. */
    it("reads a city carrying no digit", async () => {
      const result = await parse(load("transportorder1374593.pdf"));

      if (!result.ok) throw new Error(result.message);

      expect(result.trips[0].destinationCity).not.toMatch(/\d/);
    });
  });

  /**
   * ── THE COST CONFIRMATION ─────────────────────────────────────────────────
   * This document parses, and always did, through the Cost Confirmation
   * entry point. The reported failure comes from reading it as a TRANSPORT
   * ORDER, which is a different document family with a different required
   * layout — and the assertion below that it is refused there is deliberate:
   * a confirmation read as an order would create a Trip that nobody ordered.
   */
  describe("COST CONFIRMATION NR 4156173", () => {
    const FILE = "COST_CONFIRMATION_NR_4156173__ANRDUB2794719__CNEU4597558.pdf";

    it("parses as a Cost Confirmation", async () => {
      const result = await parseCostConfirmation(load(FILE));

      if (!result.ok) {
        throw new Error(`${result.reason}: ${result.message}`);
      }

      expect(result.confirmation).toBeDefined();
    });

    it.each([
      ["the confirmation number", "ccNumber", "4156173"],
      ["the booking number", "bookingNumber", "ANRDUB2794719"],
      ["the amount", "amount", "68.75"],
      ["the currency", "currency", "EUR"],
      ["the cost code", "costCode", "WAIT"],
      ["the container reference", "containerReference", "CNEU4597558"],
    ])("reads %s", async (_label, field, expected) => {
      const result = await parseCostConfirmation(load(FILE));

      if (!result.ok) throw new Error(result.message);

      expect(
        (result.confirmation as unknown as Record<string, string>)[field],
      ).toBe(expected);
    });

    it("reads the cost description beside the code", async () => {
      const result = await parseCostConfirmation(load(FILE));

      if (!result.ok) throw new Error(result.message);

      expect(result.confirmation.costDescription).toBe("Waiting Time");
    });

    /**
     * It states no `Bookings nr/Trip nr:` line, and does not need one: that
     * label belongs to a transport order. The confirmation names its booking in
     * its own header block.
     */
    it("needs no transport-order booking line", async () => {
      const result = await parseCostConfirmation(load(FILE));

      if (!result.ok) throw new Error(result.message);

      expect(result.confirmation.raw).not.toContain("Bookings nr/Trip nr");
      expect(result.confirmation.raw).toContain("COST CONFIRMATION NR");
    });

    /**
     * And it is REFUSED as a transport order. This is the behaviour that
     * produced the reported error, and it is correct: the document carries a
     * complete order inside it, which read as one would create a second Trip
     * for a booking that already has one.
     */
    it("is refused when read as a transport order", async () => {
      const result = await parse(load(FILE));

      expect(result.ok).toBe(false);
    });
  });
});

/**
 * ── THE GENERIC RULES, ON SYNTHETIC BLOCKS ──────────────────────────────────
 * The documents above prove the rules work on real layouts. These prove the
 * rules are general: same shapes, different words, no fixture involved.
 */
describe("the address patterns these documents needed", () => {
  const header: Fragment = { page: 1, x: 26, y: 400, text: "LOADING 1:" };

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

  const cityOf = (lines: readonly string[]) =>
    extractAddress(addressBlock(lines), header).destinationCity;

  /** A postcode with letters, in both printings, in either country. */
  describe("a postcode carrying letters", () => {
    it.each([
      ["1234AB Someplace", "Someplace"],
      ["1234 AB Someplace", "Someplace"],
      ["9999ZZ Other Town", "Other Town"],
    ])("reads %p as %p", (line, city) => {
      expect(cityOf(["[1234]", "A Company", "A Street 1", line, "Nederland"])).toBe(
        city,
      );
    });

    it("keeps the country the document states", () => {
      const result = extractAddress(
        addressBlock(["[1234]", "A Company", "A Street 1", "1234AB Someplace", "Nederland"]),
        header,
      );

      expect(result.destinationCountry).toBe("Netherlands");
    });

    /** The two letters must be capitals, so a city's first word survives. */
    it("does not eat the first word of a city", () => {
      expect(
        cityOf(["[2040]", "A Company", "A Street 1", "2040 An Twerpen", "Belgium"]),
      ).toBe("An Twerpen");
    });

    /** The forms that already worked keep working. */
    it.each([
      [["[8730]", "A Company", "A Street 1", "BE-8730 Beernem", "Belgium"], "Beernem"],
      [["[9940]", "A Company", "A Street 1", "9940 Evergem,", "Belgium"], "Evergem"],
    ])("still reads %p", (lines, city) => {
      expect(cityOf(lines)).toBe(city);
    });
  });

  /** A bracketed postcode with the city somewhere above the last line. */
  describe("a city that is not the last line", () => {
    it("steps over a trailing gate", () => {
      expect(
        cityOf(["[2070]", "XX01: A Company", "A Street 20", "Someplace", "Gate 3"]),
      ).toBe("Someplace");
    });

    it("steps over several trailing lines carrying digits", () => {
      expect(
        cityOf([
          "[2070]",
          "XX01: A Company",
          "A Street 20",
          "Someplace",
          "Gate 3",
          "Dock 12",
        ]),
      ).toBe("Someplace");
    });

    /**
     * And it still refuses a truncated block. A city may not sit where the
     * company does, so `Acme BV` is never promoted to a destination.
     */
    it("refuses when only a company stands above the street", () => {
      expect(() => cityOf(["[1234]", "Acme BV", "Somestreet 5"])).toThrow(
        ExtractionError,
      );
    });

    it("refuses when every candidate line carries a digit", () => {
      expect(() =>
        cityOf(["[1234]", "Acme BV", "Somestreet 5", "Gate 3"]),
      ).toThrow(ExtractionError);
    });

    /** A country on the final line is still never the city. */
    it("refuses rather than reading a country", () => {
      expect(() =>
        cityOf(["[1234]", "Acme BV", "Somestreet 5", "Belgium"]),
      ).toThrow(ExtractionError);
    });
  });

  /**
   * A company line that opens with a site code is address text, not a form
   * label — which is what kept the block from being truncated.
   */
  describe("a company line that looks like a label", () => {
    it.each(["BE01: Exxonmobil", "NL42: Some Company", "X1: Another"])(
      "keeps reading the address past %p",
      (company) => {
        expect(cityOf(["[2070]", company, "A Street 20", "Someplace"])).toBe(
          "Someplace",
        );
      },
    );

    /** A real form label still ends the address, exactly as before. */
    it.each(["Loading Ref: NUT35/149911", "Opening times: 08:00", "Remarks: none"])(
      "still stops at %p",
      (label) => {
        expect(() =>
          cityOf(["[1234]", "Acme BV", "Somestreet 5", label, "Someplace"]),
        ).toThrow(ExtractionError);
      },
    );
  });
});
