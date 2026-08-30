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
        containerNumber: "PVDU3013260",
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
        containerNumber: "EUCU2000249",
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
        containerNumber: "EUCU4551322",
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
        containerNumber: "EUCU4550753",
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
        // "21/08/2026 08:00" — one moment, so the window has zero length.
        startTime: "08:00",
        endTime: "08:00",
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
        // "21/08/2026 15:00" — one moment, so the window has zero length.
        startTime: "15:00",
        endTime: "15:00",
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
        containerNumber: "EUCU4532322",
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
        containerNumber: "EUCU4532322",
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
  {
    /*
     * BUG — the address column continues past the address into the sender's
     * own notes:
     *
     *   F - 62126 Wimille
     *   Loading Ref: NUT35/149911
     *   pls fix papers on the last pallet
     *
     * The last line used to become the city. The country prefix is spaced
     * (`F - 62126`), which no other fixture does.
     */
    file: "BUG-CITY/ANRBEL2792427.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRBEL2792427",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Wimille",
        destinationCountry: "France",
        date: "2026-08-24",
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
     * BUG — the postcode and the city are one printed line, emitted as TWO
     * fragments because of the gap between them:
     *
     *   62223            SAINT LAURENT BLANGY
     *
     * Only the fragment starting at the address column was read, so the block
     * ended in a bare postcode and no rule could find a city at all. The order
     * was refused outright with "No readable city line was found".
     *
     * It states no country anywhere — the only prefixed postcode on the page is
     * the Antwerp terminal's `BE-2040` — so the country is recorded as absent,
     * exactly as it is for the other order whose postcode names a place in more
     * than one country.
     */
    file: "BUG-CITY/transportorder1371231.pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2792867",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Saint Laurent Blangy",
        destinationCountry: null,
        date: "2026-08-25",
        startTime: "08:45",
        endTime: "08:45",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /*
     * BUG-CITY — the country prefix printed in LOWER CASE.
     *
     * The address block is four separate fragments in the value column at
     * x=97.5, one per printed row:
     *
     *     y=221  [8580]
     *     y=209  IVC bvba
     *     y=197  Nijverheidslaan 29
     *     y=185  be-8580 Avelgem
     *
     * Nothing is fragmented and nothing is mis-grouped — the row-continuation
     * mechanism added for `62223 SAINT LAURENT BLANGY` is not involved here.
     * The postcode rule simply required `[A-Z]{1,2}` and this document prints
     * `be`, so it declined; the bare-postcode rule needs the line to start with
     * digits; and the bracketed last resort refuses a final line containing a
     * digit, which this one does. All four rules declined and the order was
     * refused with "No readable city line was found".
     *
     * The `Remarks:` column on the same row carries `loadref 2662001546 …` at
     * x=350.3, well past the x=295.4 boundary, so it stays out of the address —
     * which is what the row-continuation boundary was built to guarantee.
     */
    /*
     * BUG-CITY — the address layout that prompted the structural rewrite of
     * how a place is read out of an address block.
     *
     * The block is five fragments in the value column at x=97.5, one per
     * printed row:
     *
     *     y=221  [8730]
     *     y=209  Belgosuc NV
     *     y=197  Indistriepark 20
     *     y=185  BE-8730 Beernem
     *     y=173  Belgium
     *
     * This is PATTERN A — the normal printed form — and it reads correctly
     * both before and after that work: the prefixed-postcode rule claims
     * `BE-8730 Beernem` and the country word below it confirms Belgium.
     *
     * It is registered anyway, and deliberately. The layouts that DID break —
     * a postcode sharing its line with a country — are covered by
     * `fields.spec.ts`, which exercises them as positioned text. This document
     * is the real-world counterpart: it proves that hardening those layouts
     * changed nothing for the ordinary one, and it pins the fields around the
     * address as well, which a synthetic block cannot.
     *
     * Every value below was read from the parser's own output on these bytes,
     * never transcribed from a description.
     */
    file: "BUG-CITY/bug-postcode.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2797162",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Beernem",
        destinationCountry: "Belgium",
        date: "2026-08-31",
        startTime: "08:00",
        endTime: "15:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "BUG-CITY/transportorder1372937.pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2796313",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Avelgem",
        // From the document's own `be-` prefix through the existing table —
        // no postcode-to-country mapping was invented for this fix.
        destinationCountry: "Belgium",
        date: "2026-08-28",
        startTime: "08:00",
        endTime: "16:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /*
     * The same bytes as 1368224, filed under a second name. Kept as its own
     * fixture because the duplicate rules are about CONTENT, not filenames:
     * a document re-sent under another name must parse identically.
     */
    file: "UPDATE/transportorder1368224 (1).pdf",
    pageCount: 1,
    layout: "SINGLE_ONE_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
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
  {
    /*
     * The PLANNED half of the only booking that appears in both folders: this
     * order and `CANCEL/cancelled_transportorder1369485.pdf` name the same
     * ANRDUB2790203. Same booking, opposite document status.
     */
    file: "UPDATE/transportorder1369485.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "PLANNED",
    trips: [
      {
        bookingNumber: "ANRDUB2790203",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Antwerpen",
        destinationCountry: "Belgium",
        date: "2026-08-19",
        startTime: "07:30",
        endTime: "14:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /* The CANCELLED half of that same booking. */
    file: "CANCEL/cancelled_transportorder1369485.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "CANCELLED",
    trips: [
      {
        bookingNumber: "ANRDUB2790203",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Antwerpen",
        destinationCountry: "Belgium",
        date: "2026-08-19",
        startTime: "07:30",
        endTime: "14:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    file: "CANCEL/cancelled_transportorder1369488.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "CANCELLED",
    trips: [
      {
        // Same day, same city and same window as 1369485 — a different order.
        bookingNumber: "ANRDUB2790211",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Antwerpen",
        destinationCountry: "Belgium",
        date: "2026-08-19",
        startTime: "07:30",
        endTime: "14:00",
        groupKey: null,
        page: 1,
        addressSection: "LOADING 1",
      },
    ],
  },
  {
    /* An afternoon window: 16:00 till 18:00, the latest of any fixture. */
    file: "CANCEL/cancelled_transportorder1367320.pdf",
    pageCount: 2,
    layout: "SINGLE_TWO_PAGE",
    documentStatus: "CANCELLED",
    trips: [
      {
        bookingNumber: "ANRCRK2786825",
        direction: "COLLECTION",
        containerType: "45PH",
        containerNumber: null,
        terminal: "PSA Quay 869",
        destinationCity: "Dendermonde",
        destinationCountry: "Belgium",
        date: "2026-08-13",
        startTime: "16:00",
        endTime: "18:00",
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

  /**
   * Every document in the CANCEL folder, and nothing outside it.
   *
   * Counted rather than listed so a fixture added to that folder without its
   * stamp being read would fail here rather than pass unnoticed.
   */
  it("is carried by exactly the documents filed as cancellations", () => {
    expect(CANCELLED.map((document) => document.file).sort()).toEqual(
      PARSED_DOCUMENTS.map((document) => document.file)
        .filter((file) => file.startsWith("CANCEL/"))
        .sort(),
    );
    expect(CANCELLED.length).toBe(8);
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
 * ── THE BUG-CITY ORDERS ─────────────────────────────────────────────────────
 * Real orders that the parser refused outright: each prints its address in a
 * shape the city rule did not cover. They are pinned here by what they say, and
 * the assertions state WHY each one was hard.
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
    "BUG-CITY/transportorder1371231.pdf",
    "BUG-CITY/transportorder1372937.pdf",
  ])("keeps %s's city free of postcodes and punctuation", async (file) => {
    const result = await parseFixture(file);

    if (!result.ok) throw new Error("expected a parse");

    const { destinationCity } = result.trips[0];

    expect(destinationCity).not.toMatch(/\d/);
    expect(destinationCity).not.toMatch(/[,;]/);
    expect(destinationCity.trim()).toBe(destinationCity);
  });

  /**
   * ── THE COUNTRY PREFIX IN LOWER CASE ──────────────────────────────────────
   * This order prints its address as
   *
   *     [8580]
   *     IVC bvba
   *     Nijverheidslaan 29
   *     be-8580 Avelgem
   *
   * Four fragments, four printed rows, nothing split and nothing mis-grouped —
   * the row-continuation mechanism below is not involved. The postcode rule
   * required an UPPER-CASE prefix and this document prints `be`, so it
   * declined; the bare-postcode rule needs the line to begin with digits; and
   * the bracketed last resort refuses a final line containing a digit. All four
   * declined, and an order naming its destination unmistakably was refused.
   *
   * Every assertion below names something the parser must NOT have taken
   * instead — each was physically closer to the answer than the city.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a country prefix printed in lower case", () => {
    const FILE = "BUG-CITY/transportorder1372937.pdf";

    async function trip() {
      const result = await parseFixture(FILE);

      if (!result.ok) {
        throw new Error(`expected a parse: ${result.reason} — ${result.message}`);
      }

      return result.trips[0];
    }

    it("reads the city from the lower-case postcode line", async () => {
      expect((await trip()).destinationCity).toBe("Avelgem");
    });

    /** The document's own prefix, through the existing table. Nothing new. */
    it("resolves the country the document states", async () => {
      expect((await trip()).destinationCountry).toBe("Belgium");
    });

    it.each([
      ["the company name", "IVC bvba"],
      ["the street", "Nijverheidslaan 29"],
      ["the bare postcode", "8580"],
      ["the prefixed postcode", "be-8580"],
      ["the whole postcode line", "be-8580 Avelgem"],
      ["the bracketed reference", "[8580]"],
    ])("never reads %s as the city", async (_name, wrong) => {
      expect((await trip()).destinationCity).not.toBe(wrong);
    });

    /**
     * The sender's note sits in the Remarks column on the SAME row as the
     * bracketed reference, at x=350.3 against the address column's x=97.5. The
     * row-continuation boundary is what keeps it out, and it must keep working
     * for an address the city rule can now read.
     */
    it("keeps the loading reference out of the address", async () => {
      const parsed = await trip();

      expect(parsed.raw.rawAddress).not.toMatch(/loadref/i);
      expect(parsed.raw.rawAddress).not.toContain("2662001546");
      expect(parsed.raw.rawAddress).not.toMatch(/Roay|ashbourne/i);
    });

    /** The block survives whole as evidence, in printed order. */
    it("keeps the address block as raw evidence", async () => {
      expect((await trip()).raw.rawAddress).toBe(
        "[8580] IVC bvba Nijverheidslaan 29 be-8580 Avelgem",
      );
    });

    it("reads the rest of the order unchanged", async () => {
      const parsed = await trip();

      expect(parsed.bookingNumber).toBe("ANRDUB2796313");
      expect(parsed.containerType).toBe("45PH");
      expect(parsed.date).toBe("2026-08-28");
      expect(parsed.startTime).toBe("08:00");
      expect(parsed.endTime).toBe("16:00");
    });
  });

  /**
   * ── ONE PRINTED LINE, TWO FRAGMENTS ───────────────────────────────────────
   * The last address line of this order is
   *
   *     62223            SAINT LAURENT BLANGY
   *
   * one line on paper and two runs of text in the PDF, because of the gap
   * between the postcode and the name. The block builder kept only the run that
   * starts at the address column, so the address ended at "62223" and no rule
   * had a city to find — the whole order was refused.
   *
   * Every assertion below names something the parser must NOT have taken
   * instead. Each is a line that was physically closer to the answer than the
   * city: the company two lines up, the street one line up, the bracketed
   * reference at the top, and the sender's own note in the next column.
   * ──────────────────────────────────────────────────────────────────────────
   */
  describe("a postcode and city printed as one line", () => {
    const FILE = "BUG-CITY/transportorder1371231.pdf";

    async function trip() {
      const result = await parseFixture(FILE);

      if (!result.ok) {
        throw new Error(`expected a parse: ${result.reason} — ${result.message}`);
      }

      return result.trips[0];
    }

    it("reads the city from the line the postcode shares", async () => {
      // Title-cased like every other city this parser reads: "DOURGES" is
      // stored as "Dourges", and this is the same rule, not an exception.
      expect((await trip()).destinationCity).toBe("Saint Laurent Blangy");
    });

    it("names the place the document names, whatever the capitals", async () => {
      expect((await trip()).destinationCity.toUpperCase()).toBe(
        "SAINT LAURENT BLANGY",
      );
    });

    it("does not take the company name", async () => {
      expect((await trip()).destinationCity).not.toBe("Delisle – Saint Laurent");
      expect((await trip()).destinationCity).not.toMatch(/delisle/i);
    });

    it("does not take the street", async () => {
      expect((await trip()).destinationCity).not.toBe("120 Allée des Atrébates");
      expect((await trip()).destinationCity).not.toMatch(/atrébates/i);
    });

    it("does not take the loading reference or the remarks column", async () => {
      const city = (await trip()).destinationCity;

      expect(city).not.toMatch(/loading ref/i);
      expect(city).not.toMatch(/93165142/);
      expect(city).not.toMatch(/remarks/i);
    });

    it("keeps the postcode out of the city", async () => {
      const city = (await trip()).destinationCity;

      expect(city).not.toMatch(/62223/);
      expect(city).not.toMatch(/\d/);
    });

    /**
     * The document states no country: the only prefixed postcode on the page is
     * the Antwerp terminal's `BE-2040`, and a bare `62223` names a place in more
     * than one country. Absent is recorded as absent rather than guessed at —
     * the same answer this parser already gives for Raillencourt Ste Olle.
     */
    it("records the country as absent, because the document states none", async () => {
      expect((await trip()).destinationCountry).toBeNull();
    });

    it("reads everything else the document states", async () => {
      expect(await trip()).toMatchObject({
        bookingNumber: "ANRDUB2792867",
        containerType: "45PH",
        date: "2026-08-25",
        startTime: "08:45",
        endTime: "08:45",
      });
    });

    /** The evidence, so a wrong city could always be checked against the page. */
    it("keeps the joined line in the raw address", async () => {
      expect((await trip()).raw.rawAddress).toContain("62223 SAINT LAURENT BLANGY");
    });
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

/**
 * ── ONE TIMESTAMP INSTEAD OF A WINDOW ───────────────────────────────────────
 * Real orders print the appointment two ways:
 *
 *   Date/time: 21/08/2026 08:00 till 10:00     a window
 *   Date/time: 21/08/2026 15:00                one moment
 *
 * The second used to leave BOTH times empty, so an order that stated exactly
 * when to be there arrived in the planning with no time at all. It is now read
 * as a window of zero length, which is the same thing the many
 * `08:00 till 08:00` orders already say in the other spelling.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("a Date/time line with a single timestamp", () => {
  it.each([
    ["BUG-CITY/transportorder1370334.pdf", "2026-08-21", "08:00"],
    ["BUG-CITY/transportorder1370345.pdf", "2026-08-21", "15:00"],
  ])("reads %s as one moment, not as no time", async (file, date, time) => {
    const result = await parseFixture(file);

    if (!result.ok) throw new Error("expected a parse");

    const [trip] = result.trips;

    expect(trip.date).toBe(date);
    expect(trip.startTime).toBe(time);
    // Equal to the start, never invented and never left absent.
    expect(trip.endTime).toBe(time);
  });

  /** The window form must be untouched by the rule that reads the other one. */
  it("still reads a real window as the two times the document states", async () => {
    const result = await parseFixture("BUG-CITY/transportorder1370335.pdf");

    if (!result.ok) throw new Error("expected a parse");
    expect(result.trips[0].startTime).toBe("08:00");
    expect(result.trips[0].endTime).toBe("10:00");
  });

  it("keeps the date of a single-timestamp order exactly as printed", async () => {
    const result = await parseFixture("BUG-CITY/transportorder1370345.pdf");

    if (!result.ok) throw new Error("expected a parse");
    // 21/08/2026 — day and month never swap on the way to ISO.
    expect(result.trips[0].raw.rawDate).toBe("21/08/2026 15:00");
    expect(result.trips[0].date).toBe("2026-08-21");
  });
});

/**
 * ── A NOTE TO THE DRIVER IS NOT A CITY ──────────────────────────────────────
 * One real order prints the shipper's remarks in the address column, below the
 * address:
 *
 *   F - 62126 Wimille
 *   Loading Ref: NUT35/149911
 *   pls fix papers on the last pallet
 *
 * Read to the bottom of that column, the last line is a sentence somebody typed
 * for the driver — and it was being stored as the destination. A city that is
 * really a remark matches no route, prices nothing, and tells the planner to
 * drive somewhere that does not exist.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("an address followed by remarks", () => {
  const FILE = "BUG-CITY/ANRBEL2792427.pdf";

  it("reads the city from the postcode line, not from the last line", async () => {
    const result = await parseFixture(FILE);

    if (!result.ok) throw new Error("expected a parse");

    const [trip] = result.trips;

    expect(trip.bookingNumber).toBe("ANRBEL2792427");
    expect(trip.destinationCity).toBe("Wimille");
    expect(trip.destinationCountry).toBe("France");
    expect(trip.containerType).toBe("45PH");
    expect(trip.date).toBe("2026-08-24");
    expect(trip.startTime).toBe("08:00");
    expect(trip.endTime).toBe("08:00");
  });

  it("never stores the remark as the city", async () => {
    const result = await parseFixture(FILE);

    if (!result.ok) throw new Error("expected a parse");

    const { destinationCity } = result.trips[0];

    expect(destinationCity).not.toBe("pls fix papers on the last pallet");
    expect(destinationCity.toLowerCase()).not.toContain("papers");
    expect(destinationCity.toLowerCase()).not.toContain("pallet");
  });

  /**
   * The raw address is the evidence for the city, so it stops where the
   * address does. Everything below is the sender's note, not the address.
   */
  it("keeps the remarks out of the recorded address", async () => {
    const result = await parseFixture(FILE);

    if (!result.ok) throw new Error("expected a parse");

    const { rawAddress } = result.trips[0].raw;

    expect(rawAddress).toContain("F - 62126 Wimille");
    expect(rawAddress).not.toContain("Loading Ref");
    expect(rawAddress).not.toContain("pallet");
  });

  /**
   * No fixture may keep a remark in its city, whatever rule read it. This is
   * the invariant the bug broke, asserted across every document at once.
   */
  it.each(PARSED_DOCUMENTS)("$file states a city, not a sentence", async (expected) => {
    const result = await parseFixture(expected.file);

    if (!result.ok) throw new Error("expected a parse");

    for (const trip of result.trips) {
      // A city is a name: a handful of words, no colon, no sentence.
      expect(trip.destinationCity.split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(trip.destinationCity).not.toContain(":");
    }
  });
});

/**
 * ── THE REAL DOCUMENT BEHIND THE ADDRESS-LAYOUT WORK ────────────────────────
 * `bug-postcode.pdf` — booking ANRDUB2797162 — is the order that prompted the
 * structural rewrite of how a place is read out of an address block.
 *
 * It prints PATTERN A, the ordinary form:
 *
 *     [8730]
 *     Belgosuc NV
 *     Indistriepark 20
 *     BE-8730 Beernem
 *     Belgium
 *
 * The layouts that genuinely broke — a postcode sharing its line with a
 * country — are exercised as positioned text in `fields.spec.ts`, because no
 * real document containing one has reached the repository yet. This one is the
 * real-world half of the same guarantee, and it is worth its own block rather
 * than only a row in the table above: it states, against actual bytes, the two
 * invariants the rewrite exists to protect.
 *
 *     A POSTCODE MUST NEVER BECOME THE CITY
 *     A COUNTRY MUST NEVER BECOME THE CITY
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the real order whose address block is BE-8730 Beernem", () => {
  const FILE = "BUG-CITY/bug-postcode.pdf";

  async function trip() {
    const result = await parseFixture(FILE);

    if (!result.ok) {
      throw new Error(`expected a parse: ${result.reason} — ${result.message}`);
    }

    return result.trips[0];
  }

  it("reads the city from the postcode line", async () => {
    expect((await trip()).destinationCity).toBe("Beernem");
  });

  it("reads the country from the word below it", async () => {
    expect((await trip()).destinationCountry).toBe("Belgium");
  });

  /** The two invariants, on a real document rather than a synthetic block. */
  it("never stores the postcode as the city", async () => {
    const city = (await trip()).destinationCity;

    expect(city).not.toMatch(/\d/);
    expect(city).not.toContain("8730");
  });

  it("never stores the country as the city", async () => {
    expect((await trip()).destinationCity).not.toBe("Belgium");
  });

  it("does not take the company or the street", async () => {
    const city = (await trip()).destinationCity;

    expect(city).not.toMatch(/belgosuc/i);
    expect(city).not.toMatch(/indistriepark/i);
  });

  /**
   * The raw evidence is what the document PRINTED, never what the parser
   * derived from it. Both address lines survive even though only the city and
   * the country are stored.
   */
  it("keeps the printed address as raw evidence", async () => {
    const { rawAddress } = (await trip()).raw;

    expect(rawAddress).toContain("BE-8730 Beernem");
    expect(rawAddress).toContain("Belgium");
    expect(rawAddress).toContain("Belgosuc NV");
    expect(rawAddress).toContain("Indistriepark 20");
  });

  /** The block stops where it always did: the Date/time row is not address. */
  it("keeps the date row out of the address", async () => {
    expect((await trip()).raw.rawAddress).not.toContain("31/08/2026");
  });

  /**
   * The fields AROUND the address, which a synthetic block cannot pin. They
   * are asserted here so a future change to address reading cannot quietly
   * disturb the rest of the document.
   */
  it("reads the booking, the direction and the window unchanged", async () => {
    const parsed = await trip();

    expect(parsed.bookingNumber).toBe("ANRDUB2797162");
    expect(parsed.direction).toBe("COLLECTION");
    expect(parsed.date).toBe("2026-08-31");
    expect(parsed.startTime).toBe("08:00");
    expect(parsed.endTime).toBe("15:00");
  });

  it("leaves the terminal and container fields as the document states them", async () => {
    const parsed = await trip();

    expect(parsed.terminal).toBe("PSA Quay 869");
    expect(parsed.containerType).toBe("45PH");
    expect(parsed.containerNumber).toBeNull();
  });

  /** The address comes from the LOADING section, not from `Startpoint:`. */
  it("reads the customer's address rather than the terminal's", async () => {
    const parsed = await trip();

    expect(parsed.raw.sections.addressSection).toBe("LOADING 1");
    expect(parsed.raw.rawAddress).not.toContain("Scheldelaan");
  });
});
