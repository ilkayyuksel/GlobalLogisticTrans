import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ImportNotPersistedException,
  UnreadablePdfException,
} from "./exceptions/pdf-import.exceptions";
import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * A transport order counts as imported only once its Trips are in the database.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * A NEW order whose first Trip already existed was applied as a repeat of that
 * Trip — and its other Trip, never created, was reported as an outcome anyway.
 * The import returned normally, the mailbox marked the email processed, and
 * nobody was told. The import now checks its result with the Trip domain's own
 * document matcher, and a Trip that is missing makes the import fail like any
 * other — so the mailbox forwards it once and an upload shows it.
 *
 * Real documents through the real importer, matcher and verifier; only the
 * rows are in memory.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(120_000);

const NEW_ORDERS = resolve(__dirname, "../../../../docs/06-pdf/NEW");

/** One booking, ordered without a container, for 22 May 2025. */
const SINGLE = "1page.pdf";
/**
 * Two legs: DUBANR2598395 with container PVDU3013260, and ANRBEL2603249
 * without one — both for 22 May 2025.
 */
const COMBINATION = "combination.pdf";
const LEG_WITHOUT_CONTAINER = "ANRBEL2603249";

function document(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(NEW_ORDERS, name)));
}

describe("the import checks its result in the database", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-import-persistence-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  it("A. refuses a document the parser cannot read, before writing anything", async () => {
    await expect(
      harness.importer.import(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "broken.pdf"),
    ).rejects.toBeInstanceOf(UnreadablePdfException);

    expect(harness.trips).toHaveLength(0);
    expect(harness.pdfDocuments).toHaveLength(0);
  });

  it("C. accepts an order whose Trips are there after the write", async () => {
    const result = await harness.importer.import(document(COMBINATION), COMBINATION);

    expect(result.trips).toHaveLength(2);
    expect(harness.trips).toHaveLength(2);
  });

  describe("B. a document read, and its Trip not there", () => {
    /*
     * The real gap: the first leg exists, the second does not. The NEW is a
     * repeat for the first, and a repeat creates nothing.
     */
    function holdOnlyTheFirstLeg(): void {
      const missing = harness.trips.findIndex(
        (trip) => trip.bookingNumber === LEG_WITHOUT_CONTAINER,
      );
      harness.trips.splice(missing, 1);
    }

    it("fails the import instead of reporting the repeat as done", async () => {
      await harness.importer.import(document(COMBINATION), COMBINATION);
      holdOnlyTheFirstLeg();

      await expect(
        harness.importer.import(document(COMBINATION), COMBINATION),
      ).rejects.toThrow(
        expect.objectContaining({
          code: "IMPORT_NOT_PERSISTED",
          message: expect.stringContaining(LEG_WITHOUT_CONTAINER),
        }),
      );
    });

    it("writes nothing for it, so a retry on the next scan writes nothing either", async () => {
      await harness.importer.import(document(COMBINATION), COMBINATION);
      holdOnlyTheFirstLeg();
      const documents = harness.pdfDocuments.length;
      const history = harness.history.length;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(
          harness.importer.import(document(COMBINATION), COMBINATION),
        ).rejects.toBeInstanceOf(ImportNotPersistedException);
      }

      expect(harness.trips).toHaveLength(1);
      expect(harness.pdfDocuments).toHaveLength(documents);
      expect(harness.history).toHaveLength(history);
    });

    it("leaves the Trip that does exist exactly as it was", async () => {
      await harness.importer.import(document(COMBINATION), COMBINATION);
      holdOnlyTheFirstLeg();
      const before = { ...harness.trips[0] };

      await expect(
        harness.importer.import(document(COMBINATION), COMBINATION),
      ).rejects.toBeInstanceOf(ImportNotPersistedException);

      expect(harness.trips[0]).toEqual(before);
    });

    it("fails an import whose write reported success but left no Trip", async () => {
      jest.spyOn(harness.tripService, "importTrips").mockResolvedValue([]);

      await expect(
        harness.importer.import(document(SINGLE), SINGLE),
      ).rejects.toThrow(expect.objectContaining({ code: "IMPORT_NOT_PERSISTED" }));
    });
  });

  it("D. accepts a valid repeat of an order it holds, and creates nothing", async () => {
    await harness.importer.import(document(SINGLE), SINGLE);

    const repeat = await harness.importer.import(document(SINGLE), SINGLE);

    expect(repeat.trips).toHaveLength(0);
    expect(repeat.revisions).toHaveLength(1);
    expect(harness.trips).toHaveLength(1);
  });

  it("E. looks a Trip up by its normalised container", async () => {
    await harness.importer.import(document(COMBINATION), COMBINATION);

    expect(harness.tripRepository.findByIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          bookingNumber: "DUBANR2598395",
          containerNumber: "PVDU3013260",
        }),
      }),
    );
  });

  it("F/G. finds a container-less Trip by booking and the document's own date", async () => {
    await harness.importer.import(document(SINGLE), SINGLE);
    // The operator re-planned the truck: the document's date still decides.
    harness.trips[0].planningDate = new Date("2025-06-02T00:00:00.000Z");

    await expect(harness.importer.import(document(SINGLE), SINGLE)).resolves.toBeDefined();

    expect(harness.tripRepository.findManyByBookingNumberAndOriginalDate).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingNumber: "ANRDUB2602247",
        originalPlanningDate: new Date("2025-05-22T00:00:00.000Z"),
      }),
    );
  });
});
