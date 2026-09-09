import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractAddress } from "../src/fields/address";
import { ExtractionError } from "../src/errors";
import { Fragment } from "../src/text/extract";
import { parse } from "../src/index";

/**
 * An order whose address states no city.
 *
 * ── THE DOCUMENT ────────────────────────────────────────────────────────────
 * `transportorder1377575.pdf` prints its loading address in full, and there is
 * simply no city in it:
 *
 *     LOADING 1:
 *     Address:  [8700]
 *               Novaya Handling
 *               Ten Hovestraat 32
 *               8700
 *
 * The last line is the postcode again. No city, no country, anywhere.
 *
 * ── WHAT CHANGED, AND WHY ───────────────────────────────────────────────────
 * The parser used to refuse it — and refusing was the wrong answer, because
 * nobody could act on it: the document is what it is, and the transport still
 * has to be planned. An ABSENT value is now reported absent, which is what this
 * project does with every other one, and an operator types the address into the
 * Ritten list afterwards.
 *
 * ── AND WHAT DELIBERATELY DID NOT CHANGE ────────────────────────────────────
 * A block whose city is PRESENT but unreadable still fails loudly. That signal
 * is what found the last three address bugs, and trading it away would make the
 * next one arrive as a silent Trip with no destination. `statesNoPlace` is
 * narrow on purpose, and the second half of this file is what holds it narrow.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FIXTURES = join(__dirname, "..", "..", "..", "docs", "06-pdf");

async function parseFixture(name: string) {
  return parse(new Uint8Array(readFileSync(join(FIXTURES, name))));
}

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

describe("the real order that names no city", () => {
  const FILE = "BUG-CITY/transportorder1377575.pdf";

  it("is parsed rather than refused", async () => {
    expect((await parseFixture(FILE)).ok).toBe(true);
  });

  it("reports the city and country as absent", async () => {
    const result = await parseFixture(FILE);

    if (!result.ok) {
      throw new Error(`expected a parse: ${result.reason}`);
    }

    expect(result.trips[0].destinationCity).toBeNull();
    expect(result.trips[0].destinationCountry).toBeNull();
  });

  /**
   * The three near-misses. The block holds a company, a street with a number
   * and the postcode on its own line, and none of them may ever become the
   * destination — a street stored as a city matches no route and misleads an
   * operator, which was true when this document was refused and is still true
   * now that it imports.
   */
  it("takes none of the block's lines as a city", async () => {
    const result = await parseFixture(FILE);

    if (!result.ok) {
      throw new Error(`expected a parse: ${result.reason}`);
    }

    const trip = result.trips[0];

    expect(trip.destinationCity).toBeNull();
    expect(trip.destinationCountry).toBeNull();
  });

  /** The terminal is named on this page and must not be borrowed as a city. */
  it("does not borrow the terminal's own city", async () => {
    const result = await parseFixture(FILE);

    if (!result.ok) {
      throw new Error(`expected a parse: ${result.reason}`);
    }

    expect(result.trips[0].destinationCity).not.toBe("Antwerp");
    expect(result.trips[0].terminal).toBe("PSA Quay 869");
  });

  /** Nothing is inferred from the bare postcode: there is no such source. */
  it("infers no city from the postcode", async () => {
    const result = await parseFixture(FILE);

    if (!result.ok) {
      throw new Error(`expected a parse: ${result.reason}`);
    }

    expect(JSON.stringify(result.trips[0])).not.toContain("Tielt");
  });

  /** The whole block survives for diagnostics, exactly as it was printed. */
  it("keeps the address it read", async () => {
    const result = await parseFixture(FILE);

    if (!result.ok) {
      throw new Error(`expected a parse: ${result.reason}`);
    }

    expect(result.trips[0].raw.rawAddress).toBe(
      "[8700] Novaya Handling Ten Hovestraat 32 8700",
    );
  });
});

describe("an absent city and an unreadable one are different answers", () => {
  /** The shape that yields null: every candidate line is only a postcode. */
  it("reports null when the block's last line is the postcode again", () => {
    const address = read(["[8700]", "Acme BV", "Ten Hovestraat 32", "8700"]);

    expect(address.destinationCity).toBeNull();
  });

  it("reports null when the block simply stops after the street", () => {
    const address = read(["[8700]", "Acme BV", "Ten Hovestraat 32", "   "]);

    expect(address.destinationCity).toBeNull();
  });

  /**
   * ── THE SIGNAL THAT MUST SURVIVE ──────────────────────────────────────────
   * Each of these blocks NAMES a place. If a future change stopped one of them
   * being read, it must fail loudly rather than import a Trip with no
   * destination — so each is asserted to produce a city, and the null answer is
   * asserted to be out of reach for a line that holds letters.
   */
  it.each([
    [["[8580]", "IVC bvba", "Nijverheidslaan 29", "be-8580 Avelgem"], "Avelgem"],
    [
      ["[9160]", "Willems Biscuits", "Zoomstraat 2 AA", "9160 9160 Lokeren"],
      "Lokeren",
    ],
    [["[2040]", "Acme BV", "Havenweg 12", "2040 Antwerpen"], "Antwerpen"],
    [
      ["[2070]", "BE01: Exxonmobil", "CANADASTRAAT 20", "ZWIJNDRECHT"],
      "Zwijndrecht",
    ],
  ])("still reads %j as %s", (lines, expected) => {
    expect(read(lines as string[]).destinationCity).toBe(expected);
  });

  /**
   * A block whose only candidate is a COUNTRY keeps its own, louder refusal —
   * that message says something more specific than "no place stated", and the
   * country rule is older than this one.
   */
  it("still refuses a block whose city position holds a country", () => {
    expect(() =>
      read(["[9130]", "Acme BV", "Ketenislaan 1", "Belgium"]),
    ).toThrow(ExtractionError);
  });

  /**
   * And the narrowness itself: a block that does NOT open with the bracketed
   * postcode is outside the shape this rule recognises, so it refuses as
   * before rather than quietly yielding a null city.
   */
  it("refuses an unbracketed block rather than calling it placeless", () => {
    expect(() =>
      read(["Acme BV", "Ten Hovestraat 32", "8700", "8700"]),
    ).toThrow(ExtractionError);
  });

  /** A truncated block is still a truncated block, not a placeless one. */
  it("refuses a block with too few lines", () => {
    expect(() => read(["[8700]", "Acme BV", "8700"])).toThrow(ExtractionError);
  });
});
