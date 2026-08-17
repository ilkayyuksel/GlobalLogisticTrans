import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PARSER_VERSION, ParseResult, ParseSuccess, parse } from "../src/index";

/**
 * Golden-file regression against the three real NEW transport orders.
 *
 * These are the documents the business actually receives, so they — not the
 * specification — decide what correct means. Every expected value below was
 * read off the PDF itself.
 *
 * Fixture names include their folder (`NEW/`, `CANCEL/`, `UPDATE/`), which is
 * how the business files them: by the kind of email they arrived in. That
 * folder is filing, not evidence — what a document IS gets decided from its own
 * text, in `real-documents.spec.ts`, which covers all of them.
 */

const FIXTURES = join(__dirname, "..", "..", "..", "docs", "06-pdf");

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

async function parseFixture(name: string): Promise<ParseSuccess> {
  const result = await parse(load(name));

  if (!result.ok) {
    throw new Error(
      `${name} failed to parse: ${result.reason} ${result.message}`,
    );
  }

  return result;
}

describe("parse — 1page.pdf (Layout 1: single collection, one page)", () => {
  let result: ParseSuccess;

  beforeAll(async () => {
    result = await parseFixture("NEW/1page.pdf");
  });

  it("detects the one-page single layout", () => {
    expect(result.layout).toBe("SINGLE_ONE_PAGE");
    expect(result.metadata.pageCount).toBe(1);
  });

  it("produces exactly one trip", () => {
    expect(result.trips).toHaveLength(1);
  });

  it("extracts every field as printed", () => {
    expect(result.trips[0]).toMatchObject({
      bookingNumber: "ANRDUB2602247",
      direction: "COLLECTION",
      containerType: "45PH",
      containerNumber: null,
      terminal: "PSA Quay 869",
      destinationCity: "Dourges",
      destinationCountry: "France",
      date: "2025-05-22",
      startTime: "10:00",
      endTime: "10:00",
      groupKey: null,
    });
  });

  /** The document prints `F-62119 DOURGES` and states no country line. */
  it("derives France from the single-letter postcode prefix", () => {
    expect(result.trips[0].destinationCountry).toBe("France");
    expect(result.trips[0].raw.rawAddress).toContain("F-62119 DOURGES");
    expect(result.trips[0].raw.rawAddress).not.toContain("France");
  });

  it("title-cases a city the document shouts", () => {
    expect(result.trips[0].destinationCity).toBe("Dourges");
  });

  it("keeps the raw values it normalized", () => {
    expect(result.trips[0].raw).toMatchObject({
      rawAddress: "[62119] ONTEX Dourges Quai du Rivage F-62119 DOURGES",
      rawTerminal:
        "PSA Quay 869 Europaterminal Scheldelaan 495 BE-2040 Antwerp",
      rawDate: "22/05/2025 10:00 till 10:00",
      rawBooking: "COLLECTION Bookings nr/Trip nr: ANRDUB2602247 /67036944",
    });
    expect(result.trips[0].raw.sections.addressSection).toBe("LOADING 1");
    expect(result.trips[0].raw.matchedLabels).toContain("Return to Terminal:");
  });
});

describe("parse — 2pages.pdf (Layout 2: single collection, two pages)", () => {
  let result: ParseSuccess;

  beforeAll(async () => {
    result = await parseFixture("NEW/2pages.pdf");
  });

  it("detects the two-page single layout", () => {
    expect(result.layout).toBe("SINGLE_TWO_PAGE");
    expect(result.metadata.pageCount).toBe(2);
  });

  it("produces one trip, not one per page", () => {
    expect(result.trips).toHaveLength(1);
  });

  it("extracts every field as printed", () => {
    expect(result.trips[0]).toMatchObject({
      bookingNumber: "ANRBEL2768902",
      direction: "COLLECTION",
      containerType: "45PH",
      containerNumber: null,
      terminal: "PSA Quay 869",
      destinationCity: "Bousbecque",
      destinationCountry: "France",
      date: "2026-07-02",
      startTime: "06:00",
      endTime: "06:00",
      groupKey: null,
    });
  });

  /** Here the document does print a country line, and it is preferred. */
  it("uses the stated country line", () => {
    expect(result.trips[0].raw.rawAddress).toContain(
      "FR-59166 Bousbecque France",
    );
    expect(result.trips[0].destinationCountry).toBe("France");
  });

  /**
   * The address column continues past the country with `Loading Ref: …` and a
   * packing instruction. Those are remarks, not the address.
   */
  it("stops the raw address at the country, not at the remarks below it", () => {
    expect(result.trips[0].raw.rawAddress).not.toContain("Loading Ref");
    expect(result.trips[0].raw.rawAddress).not.toContain("pls fix papers");
  });
});

describe("parse — combination.pdf (Layout 3: combination, two pages)", () => {
  let result: ParseSuccess;

  beforeAll(async () => {
    result = await parseFixture("NEW/combination.pdf");
  });

  it("detects the combination layout", () => {
    expect(result.layout).toBe("COMBINATION_TWO_PAGE");
  });

  it("produces exactly two trips", () => {
    expect(result.trips).toHaveLength(2);
  });

  it("reads the delivery from page 1", () => {
    expect(result.trips[0]).toMatchObject({
      bookingNumber: "DUBANR2598395",
      direction: "DELIVERY",
      containerType: "45RH",
      containerNumber: "PVDU 301326/0",
      terminal: "Quay 869",
      destinationCity: "Kallo",
      destinationCountry: "Belgium",
      date: "2025-05-22",
      startTime: "08:00",
      endTime: "12:00",
    });
  });

  it("reads the collection from page 2", () => {
    expect(result.trips[1]).toMatchObject({
      bookingNumber: "ANRBEL2603249",
      direction: "COLLECTION",
      containerType: "45RH",
      containerNumber: null,
      terminal: "PSA Quay 869",
      destinationCity: "Warneton",
      destinationCountry: "Belgium",
      date: "2025-05-22",
      startTime: "07:00",
      endTime: "15:00",
    });
  });

  /**
   * A combination pairs an inbound booking with an outbound one, so the two
   * trips carry DIFFERENT numbers and are related only by their group. The
   * documentation once claimed they shared a number; the real document
   * disproved it, and the rule has since been corrected everywhere.
   */
  it("accepts two DIFFERENT booking numbers", () => {
    expect(result.trips[0].bookingNumber).not.toBe(
      result.trips[1].bookingNumber,
    );
  });

  it("ties the two trips together with one shared group key", () => {
    expect(result.trips[0].groupKey).toBe(result.trips[1].groupKey);
    expect(result.trips[0].groupKey).toBe(
      "combination:ANRBEL2603249+DUBANR2598395",
    );
  });

  it("carries the container only on the delivery", () => {
    expect(result.trips[0].containerNumber).toBe("PVDU 301326/0");
    expect(result.trips[1].containerNumber).toBeNull();
  });

  /**
   * `Terminal: Quay 869` sits above the values of `Booking no:` and
   * `Customer ref:` in the same column. They are not part of the terminal.
   */
  it("does not absorb neighbouring column values into the terminal", () => {
    expect(result.trips[0].raw.rawTerminal).toBe("Quay 869");
  });

  it("records which page each trip came from", () => {
    expect(result.trips[0].raw.sections).toMatchObject({
      page: 1,
      addressSection: "DELIVERY 1",
    });
    expect(result.trips[1].raw.sections).toMatchObject({
      page: 2,
      addressSection: "LOADING 1",
    });
  });
});

describe("determinism", () => {
  it.each(["NEW/1page.pdf", "NEW/2pages.pdf", "NEW/combination.pdf"])(
    "%s parsed twice produces an identical result",
    async (name) => {
      const first = await parse(load(name));
      const second = await parse(load(name));

      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    },
  );

  it("stamps the parser version on every success", async () => {
    const result = await parseFixture("NEW/1page.pdf");

    expect(result.parserVersion).toBe(PARSER_VERSION);
  });

  /**
   * Reading a document must not destroy it.
   *
   * pdfjs takes ownership of the buffer it is handed and detaches it, so
   * passing the caller's array straight through would leave that caller with an
   * unusable Uint8Array. The Backend reads exactly these bytes AFTER parsing —
   * to hash the PDF and write it to storage — so a detached input breaks every
   * import of a real document.
   */
  it("leaves the caller's bytes intact and usable", async () => {
    const source = load("NEW/1page.pdf");
    const byteLength = source.byteLength;

    await parse(source);

    expect(source.byteLength).toBe(byteLength);
    // Constructing from the array is what a caller writing the file does, and
    // it is the operation that throws once the buffer has been detached.
    expect(() => new Uint8Array(source)).not.toThrow();
  });

  it("can parse the same array twice", async () => {
    const source = load("NEW/combination.pdf");

    const first = await parse(source);
    const second = await parse(source);

    expect(second.ok).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

/**
 * A parser fed by email must never throw: an unusable document is an ordinary
 * outcome, and an import that crashes loses the diagnosis with it.
 */
describe("malformed input returns a structured failure", () => {
  async function expectFailure(source: Uint8Array): Promise<ParseResult> {
    const result = await parse(source);

    expect(result.ok).toBe(false);

    return result;
  }

  it("reports a file that is not a PDF at all", async () => {
    const result = await expectFailure(
      new Uint8Array(Buffer.from("this is plainly not a pdf")),
    );

    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("INVALID_PDF");
    expect(result.message).toContain("could not be read as a PDF");
  });

  it("reports an empty file", async () => {
    const result = await expectFailure(new Uint8Array());

    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("INVALID_PDF");
  });

  it("reports a truncated PDF", async () => {
    const truncated = load("NEW/1page.pdf").slice(0, 400);

    const result = await expectFailure(truncated);

    if (result.ok) throw new Error("expected a failure");
    expect(["INVALID_PDF", "UNREADABLE_PDF"]).toContain(result.reason);
  });

  it("never throws, whatever the bytes", async () => {
    const garbage = new Uint8Array(256);
    for (let i = 0; i < garbage.length; i += 1) garbage[i] = i;

    await expect(parse(garbage)).resolves.toBeDefined();
  });

  it("carries diagnostics rather than a stack trace", async () => {
    const result = await expectFailure(
      new Uint8Array(Buffer.from("not a pdf")),
    );

    if (result.ok) throw new Error("expected a failure");
    expect(result).toHaveProperty("missingFields");
    expect(result).toHaveProperty("detectedLabels");
    expect(result).toHaveProperty("metadata");
    expect(JSON.stringify(result)).not.toContain("    at ");
  });
});

describe("what the parser refuses to do", () => {
  it("returns plain data with no class instances", async () => {
    const result = await parseFixture("NEW/1page.pdf");

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("produces no pricing or database field", async () => {
    const result = await parseFixture("NEW/combination.pdf");
    const serialised = JSON.stringify(result);

    for (const forbidden of ["price", "amount", "total", "tripId", 'id":']) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  /**
   * `documentStatus` is the one status the parser states, and it is a statement
   * about the DOCUMENT — the stamp printed on the order. A Trip's status is the
   * Backend's, and no trip may carry one.
   */
  it("gives no trip a status of its own", async () => {
    const result = await parseFixture("NEW/combination.pdf");

    expect(JSON.stringify(result.trips).toLowerCase()).not.toContain("status");
    expect(result.documentStatus).toBe("PLANNED");
  });
});
