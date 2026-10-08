import { readFileSync } from "node:fs";
import { join } from "node:path";

import { extractAddress } from "../src/fields/address";
import { ExtractionError } from "../src/errors";
import { Fragment } from "../src/text/extract";
import { parse } from "../src/index";

/**
 * A country prefix written straight against the postcode: `B2030 Antwerp`.
 *
 * ── THE DOCUMENT ────────────────────────────────────────────────────────────
 * `transportorder1389100.pdf` prints its loading address as:
 *
 *     LOADING 1:
 *     Address:  [2030]
 *               Zuidnatie Breakbulk Nv
 *               Quay 468-484
 *               Muisbroeklaan
 *               B2030 Antwerp
 *               Belgium
 *
 * and was refused with "No readable city line". The prefixed rules demanded a
 * dash (`BE-2040`), the bare ones a leading digit (`2030`), and the bracketed
 * last resort met `Belgium` and refused. The prefix is now one shared fragment
 * that also knows the glued form — but only for prefixes the country table
 * knows, so an arbitrary "letters then digits" token is still not a postcode.
 *
 * The parser stores a city and a country; the postcode stays in `rawAddress`
 * as printed, since there is no separate postcode field.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FIXTURES = join(__dirname, "..", "..", "..", "docs", "06-pdf");
const FILE = "BUG-CITY/transportorder1389100.pdf";

async function parseFixture(name: string) {
  return parse(new Uint8Array(readFileSync(join(FIXTURES, name))));
}

const header: Fragment = { page: 1, x: 26, y: 400, text: "LOADING 1:" };

/** Mirrors the fixtures: section header, then the value column at x98. */
function addressBlock(lines: readonly string[]): Fragment[] {
  const fragments: Fragment[] = [
    header,
    { page: 1, x: 30, y: 380, text: "Address:" },
  ];

  lines.forEach((text, index) =>
    fragments.push({ page: 1, x: 98, y: 380 - index * 12, text }),
  );
  fragments.push({ page: 1, x: 32, y: 380 - lines.length * 12, text: "Date/time:" });

  return fragments;
}

function read(lines: readonly string[]) {
  return extractAddress(addressBlock(lines), header);
}

/** The block 1389100 prints, with its city line swapped for another form. */
function zuidnatieWith(cityLine: string, countryLine: string | null = "Belgium") {
  return read([
    "[2030]",
    "Zuidnatie Breakbulk Nv",
    "Quay 468-484",
    "Muisbroeklaan",
    cityLine,
    ...(countryLine ? [countryLine] : []),
  ]);
}

describe("the real order printing B2030 Antwerp", () => {
  async function trip() {
    const result = await parseFixture(FILE);

    if (!result.ok) throw new Error(`expected a parse: ${result.message}`);
    expect(result.trips).toHaveLength(1);

    return result.trips[0];
  }

  it("reads Antwerp in Belgium from LOADING 1", async () => {
    const loading = await trip();

    expect(loading.destinationCity).toBe("Antwerp");
    expect(loading.destinationCountry).toBe("Belgium");
    expect(loading.raw.sections.addressSection).toBe("LOADING 1");
  });

  it("takes neither the company, the street nor the country as the city", async () => {
    const { destinationCity } = await trip();

    expect(destinationCity).not.toBe("Zuidnatie Breakbulk Nv");
    expect(destinationCity).not.toBe("Muisbroeklaan");
    expect(destinationCity).not.toBe("Belgium");
  });

  it("keeps the whole address, postcode included, as printed", async () => {
    expect((await trip()).raw.rawAddress).toBe(
      "[2030] Zuidnatie Breakbulk Nv Quay 468-484 Muisbroeklaan B2030 Antwerp Belgium",
    );
  });
});

describe("every prefix form reads the same city", () => {
  it.each([
    ["glued one-letter", "B2030 Antwerp"],
    ["glued, lower case", "b2030 Antwerp"],
    ["glued two-letter", "BE2030 Antwerp"],
    ["dashed one-letter", "B-2030 Antwerp"],
    ["dashed two-letter", "BE-2030 Antwerp"],
    ["dashed, spaced", "BE - 2030 Antwerp"],
    ["no prefix", "2030 Antwerp"],
  ])("%s: %s", (_, cityLine) => {
    expect(zuidnatieWith(cityLine)).toMatchObject({
      destinationCity: "Antwerp",
      destinationCountry: "Belgium",
    });
  });

  it("names the country from a glued prefix when no country line follows", () => {
    expect(zuidnatieWith("B2030 Antwerp", null)).toMatchObject({
      destinationCity: "Antwerp",
      destinationCountry: "Belgium",
    });
  });

  it("reads a glued Dutch postcode with its letter pair", () => {
    expect(zuidnatieWith("NL4612PS Bergen op Zoom", "Netherlands")).toMatchObject({
      destinationCity: "Bergen Op Zoom",
      destinationCountry: "Netherlands",
    });
  });
});

describe("what a glued prefix does NOT open up", () => {
  /*
   * Letters the country table does not know are not a postcode prefix. The
   * line is refused loudly, as before, rather than read by its shape.
   */
  it("refuses letters glued to digits that are no known prefix", () => {
    expect(() => zuidnatieWith("XY2030 Antwerp")).toThrow(ExtractionError);
  });

  it("still reports a real city ahead of the city-absent branch", () => {
    expect(zuidnatieWith("B2030 Antwerp").destinationCity).toBe("Antwerp");
    expect(zuidnatieWith("2030,", "Belgium").destinationCity).toBeNull();
  });
});
