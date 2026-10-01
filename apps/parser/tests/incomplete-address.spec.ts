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

/**
 * ── THE SAME ABSENCE, WITH A COUNTRY UNDERNEATH ─────────────────────────────
 * Two real orders for one consignee, a week apart. They print the same address
 * and differ by a single line:
 *
 *   transportorder1385767           transportorder1385766
 *   [62137]                         [62137]
 *   Calais City Bond                Calais City Bond
 *   Chemin Departement No. 4        Chemin Departement No. 4,
 *   Le Grand Duc                    Le Grand Duc,
 *   COULOGNE          <- the city   62137,            <- the postcode instead
 *   France                          France
 *
 * The second names no commune. Where the first prints `COULOGNE` it repeats the
 * postcode from its own bracket, so this is the placeless block above with a
 * country line below it — and that country line is the only reason the original
 * test did not recognise it.
 *
 * `Le Grand Duc` is NOT the answer, and 1385767 is the proof: it prints that
 * line too, above its real city, so it belongs to the street address. Nor is
 * 62137 read as Coulogne — a postcode names no place in this parser.
 */
describe("the real order whose postcode stands where its city belongs", () => {
  const ABSENT = "BUG-CITY/transportorder1385766.pdf";
  const PRESENT = "BUG-CITY/transportorder1385767.pdf";

  async function tripOf(file: string) {
    const result = await parseFixture(file);

    if (!result.ok) {
      throw new Error(`expected a parse: ${result.reason} — ${result.message}`);
    }

    return result.trips[0];
  }

  it("is parsed rather than refused", async () => {
    expect((await parseFixture(ABSENT)).ok).toBe(true);
  });

  it("reports the city as absent and keeps the country the document states", async () => {
    const trip = await tripOf(ABSENT);

    expect(trip.destinationCity).toBeNull();
    expect(trip.destinationCountry).toBe("France");
  });

  /** Neither the street line nor the consignee becomes the destination. */
  it("never reads the locality or the company as the city", async () => {
    const trip = await tripOf(ABSENT);

    expect(trip.destinationCity).not.toBe("Le Grand Duc");
    expect(trip.destinationCity).not.toBe("Calais City Bond");
  });

  /** And the postcode is not resolved to the town it happens to belong to. */
  it("does not infer a city from the postcode", async () => {
    expect((await tripOf(ABSENT)).destinationCity).not.toBe("Coulogne");
  });

  /**
   * THE REGRESSION GUARD: the sibling order still reads its city. If the rule
   * above ever widens into "a line above a country may be skipped", this fails.
   */
  it("still reads the city of the order that prints one", async () => {
    const trip = await tripOf(PRESENT);

    expect(trip.destinationCity).toBe("Coulogne");
    expect(trip.destinationCountry).toBe("France");
  });

  /** Both orders are read, and only one of them states a place. */
  it("tells the two documents apart", async () => {
    expect([
      (await tripOf(ABSENT)).destinationCity,
      (await tripOf(PRESENT)).destinationCity,
    ]).toEqual([null, "Coulogne"]);
  });

  /*
   * ── AND THE NARROWNESS, LINE BY LINE ──────────────────────────────────────
   * Each of these is the same shape with one element changed, and every one of
   * them must still refuse — otherwise the rule has become "a city may be
   * missing whenever a country is printed".
   */

  /** A name in the city position is a city, and is read as one. */
  it("reads the city when the city line holds a name instead of the postcode", () => {
    expect(
      read([
        "[62137]",
        "Calais City Bond",
        "Chemin Departement No. 4,",
        "Le Grand Duc,",
        "be-62137 Somewhere,",
        "France",
      ]),
    ).toMatchObject({ destinationCity: "Somewhere", destinationCountry: "France" });
  });

  it("refuses when the line above the country is a different number", () => {
    expect(() =>
      read([
        "[62137]",
        "Calais City Bond",
        "Chemin Departement No. 4,",
        "Le Grand Duc,",
        "99999,",
        "France",
      ]),
    ).toThrow(ExtractionError);
  });

  it("refuses when the block does not open with its bracketed postcode", () => {
    expect(() =>
      read([
        "Calais City Bond",
        "Chemin Departement No. 4,",
        "Le Grand Duc,",
        "62137,",
        "France",
      ]),
    ).toThrow(ExtractionError);
  });

  /**
   * The last line must be a KNOWN country for the placeless reading to apply.
   * `Francia` is not one, so the rule declines and the existing bracketed
   * last-resort reads that line as the city — which is the behaviour this
   * change had to leave alone.
   */
  it("does not call the block placeless when the last line is not a known country", () => {
    expect(
      read([
        "[62137]",
        "Calais City Bond",
        "Chemin Departement No. 4,",
        "Le Grand Duc,",
        "62137,",
        "Francia",
      ]),
    ).toMatchObject({ destinationCity: "Francia" });
  });

  /** The postcode must stand where a city may stand, not where the street does. */
  it("refuses when the postcode sits too high to be the city line", () => {
    expect(() =>
      read(["[62137]", "Calais City Bond", "62137,", "France"]),
    ).toThrow(ExtractionError);
  });

  /** The placeless reading yields a NULL city — it never invents one. */
  it("yields a null city for the recognised shape", () => {
    expect(
      read([
        "[62137]",
        "Calais City Bond",
        "Chemin Departement No. 4,",
        "Le Grand Duc,",
        "62137,",
        "France",
      ]),
    ).toMatchObject({ destinationCity: null, destinationCountry: "France" });
  });
});
