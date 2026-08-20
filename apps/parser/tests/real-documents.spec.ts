import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ParseResult, parse } from "../src/index";

/**
 * Every real transport order the business has, one case each.
 *
 * ── WHY EVERY DOCUMENT AND NOT A REPRESENTATIVE ONE ─────────────────────────
 * The documents differ from each other in ways no specification predicted: an
 * address that names its country instead of prefixing its postcode, a page with
 * no numbered section at all, a cancellation stamp in the page header. Each of
 * those was found by reading a document that looked like the others. So each
 * document is its own case, and a new one is added rather than folded into an
 * existing expectation.
 *
 * Every value below was read off the PDF text itself. Where a document states
 * nothing, the expectation is `null` — never a filled-in guess.
 *
 * The folder a fixture sits in (`NEW/`, `CANCEL/`, `UPDATE/`) records the kind
 * of email it arrived in. It is filing, and these tests never read it as
 * evidence: what a document says is decided from the document.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FIXTURES = join(__dirname, "..", "..", "..", "docs", "06-pdf");

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

function parseFixture(name: string): Promise<ParseResult> {
  return parse(load(name));
}

/** One trip's worth of expectations, exactly as the document prints them. */
interface ExpectedTrip {
  readonly bookingNumber: string;
  readonly direction: "COLLECTION" | "DELIVERY";
  readonly containerType: string;
  readonly containerNumber: string | null;
  readonly terminal: string | null;
  readonly destinationCity: string;
  readonly destinationCountry: string | null;
  readonly date: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly groupKey: string | null;
  readonly page: number;
  readonly addressSection: string | null;
}

interface ExpectedDocument {
  readonly file: string;
  readonly pageCount: number;
  readonly layout: "SINGLE_ONE_PAGE" | "SINGLE_TWO_PAGE" | "COMBINATION_TWO_PAGE";
  /** What the document states about itself, read from its page header. */
  readonly documentStatus: "PLANNED" | "CANCELLED";
  readonly trips: readonly ExpectedTrip[];
}

/** Every real transport order, and exactly what it says. */
const PARSED_DOCUMENTS: readonly ExpectedDocument[] = [
  {
    file: "NEW/1page.pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
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
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "NEW/2pages.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
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
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "NEW/combination.pdf",
    pageCount: 2,
    layout: "COMBINATION_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
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
        groupKey: "combination:ANRBEL2603249+DUBANR2598395",
        page: 1,
        addressSection: "DELIVERY 1",
      },
      {
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
        groupKey: "combination:ANRBEL2603249+DUBANR2598395",
        page: 2,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "CANCEL/cancelled_transportorder1353889.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "CANCELLED",
    trips: [
      {
        bookingNumber: "ANRBEL2772352",
        direction: "COLLECTION",
        // The only fixture with a 20-foot flat container.
        containerType: "20FL",
        containerNumber: "EUCU 200024/9",
        terminal: "PSA Quay 869",
        destinationCity: "Bilzen",
        destinationCountry: "Belgium",
        date: "2026-07-06",
        startTime: "08:00",
        endTime: "15:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "CANCEL/cancelled_transportorder1354204.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "CANCELLED",
    trips: [
      {
        bookingNumber: "ANRDUB2767189",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Calais",
        destinationCountry: "France",
        date: "2026-07-07",
        startTime: "08:00",
        endTime: "08:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "CANCEL/cancelled_transportorder1367583.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "CANCELLED",
    trips: [
      {
        bookingNumber: "ANRCRK2786827",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Dendermonde",
        destinationCountry: "Belgium",
        date: "2026-08-14",
        startTime: "14:00",
        endTime: "16:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /*
     * VARIATION 1 — the address ends "Kallo / Belgium", with the postcode only
     * in the bracketed reference. The country word is what makes it readable.
     */
    file: "CANCEL/cancelled_transportorder1365387.pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "CANCELLED",
    trips: [
      {
        bookingNumber: "DUBANR2776470",
        direction: "DELIVERY",
        containerType: "45PH",
        containerNumber: "EUCU 455132/2",
        terminal: "Quay 869",
        destinationCity: "Kallo",
        destinationCountry: "Belgium",
        date: "2026-08-07",
        startTime: "09:00",
        endTime: "09:00",
        groupKey: null,
        page: 1,
        addressSection: "DELIVERY 1",
      },
    ],
  },
  {
    /*
     * VARIATION 2 — "2040 Antwerpen" with no country prefix. The country comes
     * from the depot line `BE-2040 Antwerp` further down the same page.
     */
    file: "CANCEL/cancelled_transportorder1367584.pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "CANCELLED",
    trips: [
      {
        bookingNumber: "ANRDUB2787843",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Antwerpen",
        destinationCountry: "Belgium",
        date: "2026-08-14",
        startTime: "08:00",
        endTime: "08:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /*
     * VARIATION 3 — page 1 carries the booking and the voyage block but no
     * numbered section; the LOADING 1 section, with the address AND the
     * Date/time, is on page 2.
     */
    file: "UPDATE/transportorder1353246.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2770817",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: "EUCU 455075/3",
        terminal: "PSA Quay 869",
        destinationCity: "Lessines",
        destinationCountry: "Belgium",
        date: "2026-07-08",
        startTime: "08:00",
        endTime: "08:00",
        groupKey: null,
        // The trip belongs to page 1; its address was read from page 2.
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /*
     * BUG-CITY — the postcode sits on the city line with no country prefix, and
     * the document names no country at all.
     */
    file: "BUG-CITY/transportorder1370334.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRBEL2792205",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Tessenderlo",
        destinationCountry: null,
        date: "2026-08-21",
        // The order prints a date with no time window.
        startTime: null,
        endTime: null,
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /* BUG-CITY — a comma-separated address: "9940 Evergem," then "Belgium". */
    file: "BUG-CITY/transportorder1370335.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2792951",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Evergem",
        destinationCountry: "Belgium",
        date: "2026-08-21",
        startTime: "08:00",
        endTime: "10:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /* BUG-CITY — "4880 Aubel" with the country on the following line. */
    file: "BUG-CITY/transportorder1370337.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2786809",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Aubel",
        destinationCountry: "Belgium",
        date: "2026-08-21",
        startTime: "09:00",
        endTime: "09:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /*
     * BUG-CITY — the postcode appears ONLY in the bracketed reference, and the
     * city is the last line of the block.
     */
    file: "BUG-CITY/transportorder1370345.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2792288",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Raillencourt Ste Olle",
        destinationCountry: null,
        date: "2026-08-21",
        startTime: null,
        endTime: null,
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "UPDATE/transportorder1347531.pdf",
    pageCount: 2,
    // Filed under UPDATE, but structurally a Combination. Nothing in the
    // document distinguishes it from a first issue.
    layout: "COMBINATION_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "DUBANR2761223",
        direction: "DELIVERY",
        containerType: "45PH",
        containerNumber: "EUCU 453232/2",
        terminal: "Quay 869",
        destinationCity: "Zemst",
        destinationCountry: "Belgium",
        date: "2026-06-19",
        startTime: "08:30",
        endTime: "08:30",
        groupKey: "combination:ANRDUB2763318+DUBANR2761223",
        page: 1,
        addressSection: "DELIVERY 1",
      },
      {
        bookingNumber: "ANRDUB2763318",
        direction: "COLLECTION",
        containerType: "45PH",
        // Both legs carry the SAME container: it is delivered, then taken back.
        containerNumber: "EUCU 453232/2",
        terminal: "PSA Quay 869",
        destinationCity: "Zemst",
        destinationCountry: "Belgium",
        date: "2026-06-19",
        startTime: "09:00",
        endTime: "09:00",
        groupKey: "combination:ANRDUB2763318+DUBANR2761223",
        page: 2,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "UPDATE/transportorder1348827.pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2765105",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Dourges",
        destinationCountry: "France",
        date: "2026-06-23",
        startTime: "06:00",
        endTime: "06:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "UPDATE/transportorder1368223.pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2790449",
        direction: "COLLECTION",
        // 45OS — an open-side container, a type no other fixture carries.
        containerType: "45OS",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Gondecourt",
        destinationCountry: "France",
        date: "2026-08-19",
        startTime: "08:00",
        endTime: "08:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "UPDATE/transportorder1368224.pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        // Same city, same date and same container type as 1368223, but its own
        // booking number. Two orders that look alike are still two orders.
        bookingNumber: "ANRDUB2790528",
        direction: "COLLECTION",
        containerType: "45OS",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Gondecourt",
        destinationCountry: "France",
        date: "2026-08-19",
        startTime: "08:00",
        endTime: "08:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
];

describe.each(PARSED_DOCUMENTS)("$file", (expected) => {
  let result: ParseResult;

  beforeAll(async () => {
    result = await parseFixture(expected.file);
  });

  it("parses", () => {
    if (!result.ok) {
      throw new Error(`${result.reason}: ${result.message}`);
    }

    expect(result.layout).toBe(expected.layout);
    expect(result.metadata.pageCount).toBe(expected.pageCount);
  });

  it(`produces ${expected.trips.length} trip(s)`, () => {
    if (!result.ok) throw new Error("did not parse");

    expect(result.trips).toHaveLength(expected.trips.length);
  });

  it("extracts every field as printed", () => {
    if (!result.ok) throw new Error("did not parse");

    expect(
      result.trips.map((trip) => ({
        bookingNumber: trip.bookingNumber,
        direction: trip.direction,
        containerType: trip.containerType,
        containerNumber: trip.containerNumber,
        terminal: trip.terminal,
        destinationCity: trip.destinationCity,
        destinationCountry: trip.destinationCountry,
        date: trip.date,
        startTime: trip.startTime,
        endTime: trip.endTime,
        groupKey: trip.groupKey,
        page: trip.raw.sections.page,
        addressSection: trip.raw.sections.addressSection,
      })),
    ).toEqual(expected.trips);
  });

  /**
   * The same bytes must always give the same answer — the parser reads no
   * clock, no random source and no environment. Every document is checked, not
   * a sample, because non-determinism would most likely arrive through a
   * document-specific path.
   */
  it("gives the identical result when parsed again", async () => {
    const again = await parseFixture(expected.file);

    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });

  it("reads the status the document prints on itself", () => {
    if (!result.ok) throw new Error("did not parse");

    expect(result.documentStatus).toBe(expected.documentStatus);
  });

  /**
   * The document status is a property of the DOCUMENT. Both legs of a
   * Combination share it, and no trip carries a status of its own — a trip's
   * status belongs to the Backend.
   */
  it("states no price or database identifier, and no per-trip status", () => {
    if (!result.ok) throw new Error("did not parse");

    const serialised = JSON.stringify(result.trips).toLowerCase();

    for (const forbidden of ["price", "amount", "total", "status", "tripid"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

/**
 * ── THE CANCELLED STAMP ─────────────────────────────────────────────────────
 * Every cancelled order prints `CANCELLED` in its page header, directly under
 * `Page n of m`, on EVERY page. No other document contains the word.
 *
 * The parser reports it and stops there. What should HAPPEN to a cancelled
 * order is the Backend's decision, and these tests exist to guarantee the
 * Backend is told.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the CANCELLED stamp", () => {
  const CANCELLED = PARSED_DOCUMENTS.filter(
    (document) => document.documentStatus === "CANCELLED",
  );
  const PLANNED = PARSED_DOCUMENTS.filter(
    (document) => document.documentStatus === "PLANNED",
  );

  it("is carried by five of the real orders", () => {
    expect(CANCELLED).toHaveLength(5);
    expect(PLANNED.length).toBeGreaterThan(0);
  });

  it.each(CANCELLED)("$file reports CANCELLED", async (expected) => {
    const result = await parseFixture(expected.file);

    if (!result.ok) throw new Error("expected a parse");
    expect(result.documentStatus).toBe("CANCELLED");
  });

  it.each(PLANNED)("$file reports PLANNED", async (expected) => {
    const result = await parseFixture(expected.file);

    if (!result.ok) throw new Error("expected a parse");
    expect(result.documentStatus).toBe("PLANNED");
  });

  /*
   * A stamp is a position as much as a word. The status must come from the
   * page header, so that a remark mentioning a cancellation somewhere in the
   * body of a live order can never cancel it.
   */
  it("comes from the page header and not from the filename", async () => {
    // Filed under CANCEL/, and the parser agrees — but only because the page
    // header says so. The same folder holds nothing PLANNED, so the negative
    // is proved the other way round: documents filed under UPDATE/ and NEW/
    // are PLANNED, and one of them is a Combination whose text is far longer.
    const planned = await parseFixture("UPDATE/transportorder1353246.pdf");

    if (!planned.ok) throw new Error("expected a parse");
    expect(planned.documentStatus).toBe("PLANNED");
  });

  it("applies to the whole document, not to one trip", async () => {
    const combination = await parseFixture("NEW/combination.pdf");

    if (!combination.ok) throw new Error("expected a parse");
    // One status for the document; neither leg carries one of its own.
    expect(combination.documentStatus).toBe("PLANNED");
    expect(combination.trips[0]).not.toHaveProperty("documentStatus");
  });

  it("is never UPDATE, because no document states one", async () => {
    for (const document of PARSED_DOCUMENTS) {
      const result = await parseFixture(document.file);

      if (!result.ok) throw new Error("expected a parse");
      expect(["PLANNED", "CANCELLED"]).toContain(result.documentStatus);
    }
  });
});

/**
 * ── THE THREE ADDRESS VARIATIONS ────────────────────────────────────────────
 * Each of these documents was refused before this phase. They are supported
 * now, narrowly, and these tests state what each one proves — including the
 * ordering guarantee that keeps the fallbacks from touching ordinary orders.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the address variations", () => {
  it("reads a country spelled out as a word", async () => {
    const result = await parseFixture(
      "CANCEL/cancelled_transportorder1365387.pdf",
    );

    if (!result.ok) throw new Error("expected a parse");
    // "Kallo" then "Belgium", with the postcode only in the "[9130]" reference.
    expect(result.trips[0].destinationCity).toBe("Kallo");
    expect(result.trips[0].destinationCountry).toBe("Belgium");
    expect(result.trips[0].raw.rawAddress).toContain("Belgium");
  });

  it("reads a bare postcode using a country stated elsewhere", async () => {
    const result = await parseFixture(
      "CANCEL/cancelled_transportorder1367584.pdf",
    );

    if (!result.ok) throw new Error("expected a parse");
    // "2040 Antwerpen" in the address; "BE-2040 Antwerp" on the depot line.
    expect(result.trips[0].destinationCity).toBe("Antwerpen");
    expect(result.trips[0].destinationCountry).toBe("Belgium");
  });

  it("reads a section printed on the document's other page", async () => {
    const result = await parseFixture("UPDATE/transportorder1353246.pdf");

    if (!result.ok) throw new Error("expected a parse");
    // Page 1 carries the booking and the voyage block; LOADING 1 with the
    // address AND the Date/time is on page 2. Both come from that same page.
    expect(result.trips[0].destinationCity).toBe("Lessines");
    expect(result.trips[0].date).toBe("2026-07-08");
    expect(result.trips[0].startTime).toBe("08:00");
  });

  /*
   * The ordering guarantee, and the reason it matters. `Startpoint:` on an
   * ordinary order names the TERMINAL — 1page.pdf prints
   * "Startpoint: PSA Quay 869 … BE-2040 Antwerp" — so a fallback consulted too
   * eagerly would replace real destinations with "Antwerp".
   */
  it("never lets a fallback override a real section", async () => {
    const result = await parseFixture("NEW/1page.pdf");

    if (!result.ok) throw new Error("expected a parse");
    expect(result.trips[0].destinationCity).toBe("Dourges");
    expect(result.trips[0].destinationCity).not.toBe("Antwerp");
    expect(result.trips[0].raw.sections.addressSection).toBe("LOADING 1");
  });

  /*
   * Support was widened for three named forms, not for "anything address-like".
   * A file that is not a transport order at all must still be refused.
   */
  it("still refuses a document that is not a transport order", async () => {
    const result = await parse(
      new Uint8Array(Buffer.from("this is plainly not a transport order")),
    );

    expect(result.ok).toBe(false);
  });
});

/**
 * ── AN UPDATE IS NOT VISIBLE IN THE DOCUMENT ────────────────────────────────
 * Every fixture filed under UPDATE is, in its own text, indistinguishable from
 * a first issue: no revision marker, no amended stamp, no reference to a
 * previous order. Only the email subject prefix says UPDATE.
 *
 * This is worth a test because it is the reason an update cannot be recognised
 * from a PDF alone, and because a future document that DOES carry a marker
 * should make this fail and be noticed.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("an update order", () => {
  const UPDATES = PARSED_DOCUMENTS.filter((doc) =>
    doc.file.startsWith("UPDATE/"),
  );

  it.each(UPDATES)("$file carries no revision marker", async (expected) => {
    const result = await parseFixture(expected.file);

    if (!result.ok) throw new Error("expected a parse");

    const serialised = JSON.stringify(result).toUpperCase();

    for (const marker of ["UPDATED", "REVISED", "AMEND", "REPLACES"]) {
      expect(serialised).not.toContain(marker);
    }
  });

  /**
   * Nor do the two orders that arrived together share anything an update rule
   * could key on: 1368223 and 1368224 have the same city, date and container
   * type, and different booking numbers. They are two orders, not one revised.
   */
  it("keeps look-alike orders apart by booking number", async () => {
    const first = await parseFixture("UPDATE/transportorder1368223.pdf");
    const second = await parseFixture("UPDATE/transportorder1368224.pdf");

    if (!first.ok || !second.ok) throw new Error("expected both to parse");

    expect(first.trips[0].destinationCity).toBe(second.trips[0].destinationCity);
    expect(first.trips[0].date).toBe(second.trips[0].date);
    expect(first.trips[0].bookingNumber).not.toBe(second.trips[0].bookingNumber);
  });
});

/**
 * ── DOCUMENTS THAT WERE UPLOADED RATHER THAN COMMITTED ──────────────────────
 * Real transport orders also arrive through the application and land in
 * `storage/pdf/`, which is deliberately outside git: uploaded PDFs are customer
 * documents and must never be committed. They are still real documents, so they
 * are still exercised — but by invariant rather than by pinned value, because a
 * checkout that does not have them must not fail.
 *
 * Absence is reported, never passed over in silence.
 * ────────────────────────────────────────────────────────────────────────────
 */
const UPLOAD_DIRECTORY = join(__dirname, "..", "..", "..", "storage", "pdf");

function uploadedDocuments(): string[] {
  if (!existsSync(UPLOAD_DIRECTORY)) {
    return [];
  }

  return readdirSync(UPLOAD_DIRECTORY)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort();
}

describe("an uploaded document in storage", () => {
  const uploads = uploadedDocuments();

  it("is reported when this checkout has none", () => {
    if (uploads.length === 0) {
      console.warn(
        `No uploaded PDFs in ${UPLOAD_DIRECTORY}; the committed fixtures above are the whole coverage for this checkout.`,
      );
    }

    expect(Array.isArray(uploads)).toBe(true);
  });

  it.each(uploads)("%s parses into at least one trip", async (name) => {
    const result = await parse(
      new Uint8Array(readFileSync(join(UPLOAD_DIRECTORY, name))),
    );

    if (!result.ok) {
      throw new Error(`${name}: ${result.reason} — ${result.message}`);
    }

    expect(result.trips.length).toBeGreaterThan(0);
    for (const trip of result.trips) {
      expect(trip.bookingNumber).toMatch(/^[A-Z]{6}\d+$/);
      expect(["COLLECTION", "DELIVERY"]).toContain(trip.direction);
      expect(trip.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(trip.destinationCity.length).toBeGreaterThan(0);
    }
  });

  it.each(uploads)("%s parses identically twice", async (name) => {
    const bytes = readFileSync(join(UPLOAD_DIRECTORY, name));
    const first = await parse(new Uint8Array(bytes));
    const second = await parse(new Uint8Array(bytes));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

/**
 * Variations found by reading the documents against each other. Each one is
 * here because it was a surprise, and each would otherwise be re-discovered the
 * hard way.
 */
describe("the variations these documents actually contain", () => {
  it("reads a container type no other fixture uses", async () => {
    const flat = await parseFixture(
      "CANCEL/cancelled_transportorder1353889.pdf",
    );
    const openSide = await parseFixture("UPDATE/transportorder1368223.pdf");

    if (!flat.ok || !openSide.ok) throw new Error("expected both to parse");
    expect(flat.trips[0].containerType).toBe("20FL");
    expect(openSide.trips[0].containerType).toBe("45OS");
  });

  it("reads both terminal spellings the documents use", async () => {
    const combination = await parseFixture("NEW/combination.pdf");

    if (!combination.ok) throw new Error("expected a parse");
    // One document, two spellings, neither rewritten.
    expect(combination.trips[0].terminal).toBe("Quay 869");
    expect(combination.trips[1].terminal).toBe("PSA Quay 869");
  });

  it("reads a Belgian and a French address form", async () => {
    const french = await parseFixture("NEW/1page.pdf");
    const belgian = await parseFixture(
      "CANCEL/cancelled_transportorder1367583.pdf",
    );

    if (!french.ok || !belgian.ok) throw new Error("expected both to parse");
    expect(french.trips[0].destinationCountry).toBe("France");
    expect(belgian.trips[0].destinationCountry).toBe("Belgium");
  });

  it("keeps a time window distinct from a single-moment time", async () => {
    const window = await parseFixture(
      "CANCEL/cancelled_transportorder1367583.pdf",
    );
    const moment = await parseFixture("UPDATE/transportorder1348827.pdf");

    if (!window.ok || !moment.ok) throw new Error("expected both to parse");
    // "14:00 till 16:00" is a window; "06:00 till 06:00" is one moment printed
    // twice. Both are stored as the document prints them.
    expect(window.trips[0].startTime).not.toBe(window.trips[0].endTime);
    expect(moment.trips[0].startTime).toBe(moment.trips[0].endTime);
  });

  it("reads a Combination whose legs share one container", async () => {
    const shared = await parseFixture("UPDATE/transportorder1347531.pdf");
    const separate = await parseFixture("NEW/combination.pdf");

    if (!shared.ok || !separate.ok) throw new Error("expected both to parse");
    // 1347531 delivers and collects the same box; combination.pdf does not.
    expect(shared.trips[0].containerNumber).toBe(shared.trips[1].containerNumber);
    expect(separate.trips[0].containerNumber).not.toBe(
      separate.trips[1].containerNumber,
    );
  });

  it("never invents a value a document does not state", async () => {
    const result = await parseFixture("NEW/1page.pdf");

    if (!result.ok) throw new Error("expected a parse");
    // The document prints no container number. Absence stays absence.
    expect(result.trips[0].containerNumber).toBeNull();
  });
});

/**
 * ── THE FOUR BUG-CITY ORDERS ────────────────────────────────────────────────
 * Four real orders that the parser refused outright: each prints its address in
 * a shape the city rule did not cover. They are pinned here by what they say,
 * and the assertions state WHY each one was hard.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the addresses that had no readable city line", () => {
  it("reads a bare postcode and city with no country stated anywhere", async () => {
    const result = await parseFixture("BUG-CITY/transportorder1370334.pdf");

    if (!result.ok) throw new Error("expected a parse");
    // "3980 Tessenderlo" — the postcode belongs to the address, not the name.
    expect(result.trips[0].destinationCity).toBe("Tessenderlo");
    expect(result.trips[0].destinationCountry).toBeNull();
  });

  it("reads a comma-separated address whose country is on its own line", async () => {
    const result = await parseFixture("BUG-CITY/transportorder1370335.pdf");

    if (!result.ok) throw new Error("expected a parse");
    // "9940 Evergem," then "Belgium": the comma is punctuation, not a name.
    expect(result.trips[0].destinationCity).toBe("Evergem");
    expect(result.trips[0].destinationCountry).toBe("Belgium");
  });

  it("reads a postcode-and-city line followed by a country", async () => {
    const result = await parseFixture("BUG-CITY/transportorder1370337.pdf");

    if (!result.ok) throw new Error("expected a parse");
    expect(result.trips[0].destinationCity).toBe("Aubel");
    expect(result.trips[0].destinationCountry).toBe("Belgium");
  });

  it("reads a city whose postcode exists only in the bracketed reference", async () => {
    const result = await parseFixture("BUG-CITY/transportorder1370345.pdf");

    if (!result.ok) throw new Error("expected a parse");
    expect(result.trips[0].destinationCity).toBe("Raillencourt Ste Olle");
    expect(result.trips[0].destinationCountry).toBeNull();
  });

  /**
   * The city must be a NAME. A postcode inside it would match no configured
   * route and would read as nonsense in an export, so this is asserted for all
   * four rather than left to the individual expectations above.
   */
  it.each([
    "BUG-CITY/transportorder1370334.pdf",
    "BUG-CITY/transportorder1370335.pdf",
    "BUG-CITY/transportorder1370337.pdf",
    "BUG-CITY/transportorder1370345.pdf",
  ])("keeps %s's city free of postcodes and punctuation", async (file) => {
    const result = await parseFixture(file);

    if (!result.ok) throw new Error("expected a parse");

    const { destinationCity } = result.trips[0];

    expect(destinationCity).not.toMatch(/\d/);
    expect(destinationCity).not.toMatch(/[,;]/);
    expect(destinationCity.trim()).toBe(destinationCity);
  });

  /**
   * The raw address keeps the whole block, so a city that ever comes out wrong
   * can be checked against what the document actually printed.
   */
  it("keeps the full address block as evidence", async () => {
    const result = await parseFixture("BUG-CITY/transportorder1370345.pdf");

    if (!result.ok) throw new Error("expected a parse");
    expect(result.trips[0].raw.rawAddress).toContain("[59554]");
    expect(result.trips[0].raw.rawAddress).toContain("RAILLENCOURT STE OLLE");
  });

  /**
   * The country is absent because the document never states it — not because
   * the parser gave up. Nothing may fill it in from the digits: 59554 is
   * Raillencourt-Sainte-Olle in France and Lippstadt in Germany.
   */
  it("invents no country for a document that states none", async () => {
    for (const file of [
      "BUG-CITY/transportorder1370334.pdf",
      "BUG-CITY/transportorder1370345.pdf",
    ]) {
      const result = await parseFixture(file);

      if (!result.ok) throw new Error("expected a parse");
      expect(result.trips[0].destinationCountry).toBeNull();
    }
  });
});
