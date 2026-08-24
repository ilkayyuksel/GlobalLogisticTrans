import { parse } from "@tms/parser";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * The Flat rule against the real transport orders.
 *
 * ── WHAT THE FIXTURES ACTUALLY CONTAIN ──────────────────────────────────────
 * Every PDF in `docs/06-pdf` was parsed to find out. The container types are:
 *
 *   45PH  x19    45OS  x3    45RH  x2    20FL  x1    20ST  none
 *
 * So the rule can be checked against real documents on both sides — 19 orders
 * that must get nothing, and one that must get Flat — but there is no 20ST
 * document in existence here. That branch is covered by the domain tests
 * instead; inventing a PDF to claim parser coverage would prove nothing about
 * a real order.
 *
 * ── THE ONE 20FL DOCUMENT IS A CANCELLATION ─────────────────────────────────
 * `CANCEL/cancelled_transportorder1353889.pdf` is the only flat rack we have,
 * and a cancellation creates no Trip — so it cannot be run through
 * `importer.import` to produce one.
 *
 * What it can do, and does below, is supply its REAL parsed container type to
 * the real creation path. The document is genuine and the parser is genuine;
 * only the decision to import rather than cancel belongs to the test, which is
 * exactly the decision an operator's `NEW:` subject line makes.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(180_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");

/** The only flat rack among the real documents. */
const FLAT_RACK_DOCUMENT = "CANCEL/cancelled_transportorder1353889.pdf";

/** Real orders that must be left alone, one per container type we hold. */
const ORDINARY_DOCUMENTS: readonly { file: string; containerType: string }[] = [
  { file: "NEW/1page.pdf", containerType: "45PH" },
  { file: "NEW/2pages.pdf", containerType: "45PH" },
  // Both legs of the Combination, and neither is a flat rack.
  { file: "NEW/combination.pdf", containerType: "45RH" },
  { file: "UPDATE/transportorder1368223.pdf", containerType: "45OS" },
];

function readFixture(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, relativePath)));
}

describe("the automatic Flat property, against the real documents", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-flat-documents-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  describe("the real 20FL order", () => {
    /** The parser's own reading of the document, never a value typed here. */
    async function parsedFlatRack() {
      const result = await parse(readFixture(FLAT_RACK_DOCUMENT));

      if (!result.ok) {
        throw new Error(`expected a parse: ${result.reason}`);
      }

      return result.trips[0];
    }

    it("is read as a flat rack by the parser", async () => {
      expect((await parsedFlatRack()).containerType).toBe("20FL");
    });

    it("receives Flat when it goes through the real creation path", async () => {
      const parsed = await parsedFlatRack();

      const [trip] = await harness.tripService.importTrips({
        document: {
          kind: "new",
          data: {
            importSource: "MANUAL_UPLOAD",
            originalFilename: FLAT_RACK_DOCUMENT,
            storagePath: "flat.pdf",
            fileSizeBytes: BigInt(1),
            fileHash: "flat-rack",
            mimeType: "application/pdf",
          },
        },
        asCombination: false,
        trips: [
          {
            bookingNumber: parsed.bookingNumber,
            containerNumber: parsed.containerNumber,
            // The document's own value, straight from the parser.
            containerType: parsed.containerType,
            terminal: parsed.terminal,
            destinationCity: parsed.destinationCity,
            destinationCountry: parsed.destinationCountry,
            planningDate: parsed.date,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            direction: parsed.direction,
            parserMetadata: {},
          },
        ],
      });

      expect(harness.customProperties).toEqual([
        expect.objectContaining({ tripId: trip.id, isAutomatic: true }),
      ]);
    });

    it("names the property by its configured name, not by an id in the code", async () => {
      const parsed = await parsedFlatRack();

      await harness.tripService.importTrips({
        document: {
          kind: "new",
          data: {
            importSource: "MANUAL_UPLOAD",
            originalFilename: FLAT_RACK_DOCUMENT,
            storagePath: "flat-2.pdf",
            fileSizeBytes: BigInt(1),
            fileHash: "flat-rack-2",
            mimeType: "application/pdf",
          },
        },
        asCombination: false,
        trips: [
          {
            bookingNumber: parsed.bookingNumber,
            containerNumber: parsed.containerNumber,
            containerType: parsed.containerType,
            terminal: parsed.terminal,
            destinationCity: parsed.destinationCity,
            destinationCountry: parsed.destinationCountry,
            planningDate: parsed.date,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            direction: parsed.direction,
            parserMetadata: {},
          },
        ],
      });

      expect(harness.customProperties[0].customProperty).toMatchObject({
        name: "Flat",
      });
    });
  });

  /**
   * The far more common case, and the one a mistake would be expensive in: 19
   * of the 25 real orders are 45PH, and charging every one of them for
   * flat-rack handling would be a silent, systematic overcharge.
   */
  describe.each(ORDINARY_DOCUMENTS)("$file ($containerType)", (document) => {
    it("is imported with no automatic property at all", async () => {
      const result = await harness.importer.import(
        readFixture(document.file),
        document.file,
      );

      expect(result.trips.length).toBeGreaterThan(0);
      for (const trip of result.trips) {
        expect(trip.containerType).toBe(document.containerType);
      }
      expect(harness.customProperties).toEqual([]);
    });
  });

  /**
   * The parser is untouched by any of this. It reports the container type the
   * document prints, and what that obliges is decided afterwards, in the Trip
   * domain — which is why these assertions are about a value, not a property.
   */
  it("leaves the parser reporting exactly what each document prints", async () => {
    for (const document of ORDINARY_DOCUMENTS) {
      const result = await parse(readFixture(document.file));

      if (!result.ok) throw new Error(`expected a parse of ${document.file}`);
      expect(result.trips[0].containerType).toBe(document.containerType);
    }
  });
});
