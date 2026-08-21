import { TripStatus } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * EVERY real Cost Confirmation, through the real workflow.
 *
 * ── WHAT A CONFIRMATION IS ALLOWED TO DO ────────────────────────────────────
 * Add an amount and its document to a Trip that already exists. That is all.
 * It creates no Trip, changes no status, moves no planning and touches no
 * waiting time — the minutes an operator entered and the money Eucon confirms
 * are different facts about the same delay, and neither may overwrite the
 * other.
 *
 * These documents carry a COMPLETE transport order inside them, so the mistake
 * this guards against is a real one: read as an order, each would create a
 * second Trip for a booking that already has one.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(120_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");
const CONFIRMATIONS = join(FIXTURES, "Cost-Combination");

interface ExpectedConfirmation {
  readonly file: string;
  readonly ccNumber: string;
  readonly bookingNumber: string;
  readonly amount: string;
}

/** Pinned from the documents, not from their filenames. */
const EXPECTED: readonly ExpectedConfirmation[] = [
  {
    file: "COST_CONFIRMATION_NR_4132482__ANRDUB2789089__EUCU4530818.pdf",
    ccNumber: "4132482",
    bookingNumber: "ANRDUB2789089",
    amount: "25.00",
  },
  {
    file: "COST_CONFIRMATION_NR_4133634__ANRDUB2791468__PVDU1139156.pdf",
    ccNumber: "4133634",
    bookingNumber: "ANRDUB2791468",
    amount: "41.25",
  },
  {
    file: "COST_CONFIRMATION_NR_4139509__ANRDUB2792284__EUCU4583166.pdf",
    ccNumber: "4139509",
    bookingNumber: "ANRDUB2792284",
    amount: "55.00",
  },
  {
    file: "COST_CONFIRMATION_NR_4139511__ANRDUB2790211__XXXXXXXXXXXX.pdf",
    ccNumber: "4139511",
    bookingNumber: "ANRDUB2790211",
    amount: "96.25",
  },
];

function readConfirmation(file: string): Uint8Array {
  return new Uint8Array(readFileSync(join(CONFIRMATIONS, file)));
}

describe("every real Cost Confirmation, through the real workflow", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-cost-confirmation-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  /** A Trip the confirmation can name, carrying operator work to protect. */
  function seedTrip(bookingNumber: string) {
    const trip = {
      id: `trip-${harness.trips.length + 1}`,
      bookingNumber,
      status: TripStatus.OPEN,
      containerNumber: "EUCU 453081/8",
      containerType: "45PH",
      terminal: "PSA Quay 869",
      destinationCity: "Aalter",
      destinationCountry: "Belgium",
      planningDate: new Date("2026-08-14T00:00:00.000Z"),
      originalPlanningDate: new Date("2026-08-14T00:00:00.000Z"),
      vehicleId: "vehicle-1",
      driverId: null,
      waitingTimeMinutes: 150,
      internalNotes: "Bel de klant",
      tripGroupId: null,
      pdfDocumentId: null,
    };

    harness.trips.push(trip);

    return trip;
  }

  it("covers every document in the folder", () => {
    expect(EXPECTED.map((entry) => entry.file).sort()).toEqual(
      readdirSync(CONFIRMATIONS)
        .filter((name) => name.endsWith(".pdf"))
        .sort(),
    );
  });

  describe.each(EXPECTED)("$file", (expected) => {
    it("records the confirmed amount against the Trip it names", async () => {
      const trip = seedTrip(expected.bookingNumber);

      const result = await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      expect(result.costConfirmations).toEqual([
        {
          ccNumber: expected.ccNumber,
          bookingNumber: expected.bookingNumber,
          tripId: trip.id,
          amount: expected.amount,
          currency: "EUR",
          outcome: "RECORDED",
        },
      ]);
    });

    it("creates no Trip", async () => {
      seedTrip(expected.bookingNumber);

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      // One Trip: the one that was already there.
      expect(harness.trips).toHaveLength(1);
      expect(result_trips(harness)).toEqual([expected.bookingNumber]);
    });

    it("stores the document and links it to the confirmation", async () => {
      seedTrip(expected.bookingNumber);

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      expect(harness.pdfDocuments).toHaveLength(1);
      expect(harness.pdfDocuments[0].originalFilename).toBe(expected.file);
      expect(harness.costConfirmations[0].pdfDocumentId).toBe(
        harness.pdfDocuments[0].id,
      );
      expect(readdirSync(storageDirectory)).toHaveLength(1);
    });

    it("changes nothing about the Trip itself", async () => {
      const trip = seedTrip(expected.bookingNumber);
      const before = { ...trip };

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      // Not the status, not the planning, and above all not the waiting time.
      expect(trip).toEqual(before);
      expect(trip.waitingTimeMinutes).toBe(150);
    });

    it("appears in the Trip's document history", async () => {
      const trip = seedTrip(expected.bookingNumber);

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      const { items } = await harness.documents.findForTrip(trip.id);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        action: "COST_CONFIRMATION",
        originalFilename: expected.file,
        applied: true,
      });
      expect(items[0].outcome).toContain(`CC${expected.ccNumber}`);
    });

    it("keeps the document readable afterwards", async () => {
      seedTrip(expected.bookingNumber);

      await harness.importer.confirmCost(
        readConfirmation(expected.file),
        expected.file,
      );

      const content = await harness.pdfDocumentService.readContent(
        harness.pdfDocuments[0].id as string,
      );

      expect(content.originalFilename).toBe(expected.file);
      expect(content.content.byteLength).toBe(
        readConfirmation(expected.file).byteLength,
      );
    });
  });

  describe("the amounts", () => {
    it("are the four different amounts the documents state", async () => {
      const recorded: string[] = [];

      for (const expected of EXPECTED) {
        const trip = seedTrip(expected.bookingNumber);
        const result = await harness.importer.confirmCost(
          readConfirmation(expected.file),
          expected.file,
        );

        recorded.push(result.costConfirmations[0].amount);
        expect(result.costConfirmations[0].tripId).toBe(trip.id);
      }

      expect(recorded).toEqual(["25.00", "41.25", "55.00", "96.25"]);
    });

    /** Money is a fixed-2 string from the page to the row. Never a float. */
    it("are stored as fixed-2 strings", async () => {
      seedTrip(EXPECTED[1].bookingNumber);

      const result = await harness.importer.confirmCost(
        readConfirmation(EXPECTED[1].file),
        EXPECTED[1].file,
      );

      expect(result.costConfirmations[0].amount).toBe("41.25");
      expect(typeof result.costConfirmations[0].amount).toBe("string");
    });
  });

  describe("a booking nobody holds", () => {
    it("is refused, and writes nothing at all", async () => {
      await expect(
        harness.importer.confirmCost(
          readConfirmation(EXPECTED[0].file),
          EXPECTED[0].file,
        ),
      ).rejects.toThrow(/was not recorded/);

      expect(harness.trips).toEqual([]);
      expect(harness.costConfirmations).toEqual([]);
      // Nothing stored either: the message is retried, and a document per
      // attempt would pile up rows referencing nothing.
      expect(harness.pdfDocuments).toEqual([]);
      expect(readdirSync(storageDirectory)).toEqual([]);
    });
  });

  describe("the same confirmation twice", () => {
    const { file, bookingNumber, ccNumber } = EXPECTED[0];

    it("records it once, under any filename", async () => {
      const trip = seedTrip(bookingNumber);

      await harness.importer.confirmCost(readConfirmation(file), file);
      const second = await harness.importer.confirmCost(
        readConfirmation(file),
        "a-different-name.pdf",
      );

      expect(second.costConfirmations[0].outcome).toBe("ALREADY_RECORDED");
      // One confirmed amount, whatever the document was called.
      expect(harness.costConfirmations).toHaveLength(1);
      expect(harness.costConfirmations[0].ccNumber).toBe(ccNumber);
      expect(trip.status).toBe(TripStatus.OPEN);
    });

    /** Content-addressed storage keeps one file for identical bytes. */
    it("writes one file for both arrivals", async () => {
      seedTrip(bookingNumber);

      await harness.importer.confirmCost(readConfirmation(file), file);
      await harness.importer.confirmCost(
        readConfirmation(file),
        "a-different-name.pdf",
      );

      expect(readdirSync(storageDirectory)).toHaveLength(1);
    });
  });

  describe("a second, DIFFERENT confirmation for one Trip", () => {
    /**
     * A Trip has exactly one confirmed cost. Eucon confirms the waiting time
     * once, and the first confirmation is the authoritative one — so a second
     * with another number is refused rather than added, overwritten or summed.
     */
    it("is refused, and the first one stands", async () => {
      const trip = seedTrip(EXPECTED[0].bookingNumber);

      await harness.importer.confirmCost(
        readConfirmation(EXPECTED[0].file),
        EXPECTED[0].file,
      );

      // The second document names another booking, so the Trip is given that
      // booking number: the workflow that follows is exactly the same.
      trip.bookingNumber = EXPECTED[2].bookingNumber;

      await expect(
        harness.importer.confirmCost(
          readConfirmation(EXPECTED[2].file),
          EXPECTED[2].file,
        ),
      ).rejects.toThrow(/already has cost confirmation CC4132482/);

      expect(harness.costConfirmations).toHaveLength(1);
      expect(harness.costConfirmations[0].ccNumber).toBe("4132482");
      expect(String(harness.costConfirmations[0].amount)).toBe("25.00");
    });

    it("changes nothing at all about the Trip", async () => {
      const trip = seedTrip(EXPECTED[0].bookingNumber);

      await harness.importer.confirmCost(
        readConfirmation(EXPECTED[0].file),
        EXPECTED[0].file,
      );

      trip.bookingNumber = EXPECTED[2].bookingNumber;
      const before = { ...trip };

      await expect(
        harness.importer.confirmCost(
          readConfirmation(EXPECTED[2].file),
          EXPECTED[2].file,
        ),
      ).rejects.toThrow();

      expect(trip).toEqual(before);
      expect(trip.waitingTimeMinutes).toBe(150);
      expect(trip.status).toBe(TripStatus.OPEN);
    });

    /**
     * The arrival is still a fact. Its document stays as the evidence for the
     * refusal, exactly as a refused revision's does — the record and the
     * document belong together.
     */
    it("records the refusal against the Trip and keeps the document", async () => {
      const trip = seedTrip(EXPECTED[0].bookingNumber);

      await harness.importer.confirmCost(
        readConfirmation(EXPECTED[0].file),
        EXPECTED[0].file,
      );

      trip.bookingNumber = EXPECTED[2].bookingNumber;

      await expect(
        harness.importer.confirmCost(
          readConfirmation(EXPECTED[2].file),
          EXPECTED[2].file,
        ),
      ).rejects.toThrow();

      const refusal = harness.history.filter(
        (entry) => entry.eventType === "COST_CONFIRMATION_REFUSED",
      );

      expect(refusal).toHaveLength(1);
      expect(refusal[0].description).toContain("CC4139509");
      expect(refusal[0].description).toContain("CC4132482");
      // Two documents: the confirmation that counted, and the one that did not.
      expect(harness.pdfDocuments).toHaveLength(2);
      expect(refusal[0].pdfDocumentId).toBe(harness.pdfDocuments[1].id);
    });

    it("shows both documents in the history, one of them not applied", async () => {
      const trip = seedTrip(EXPECTED[0].bookingNumber);

      await harness.importer.confirmCost(
        readConfirmation(EXPECTED[0].file),
        EXPECTED[0].file,
      );

      trip.bookingNumber = EXPECTED[2].bookingNumber;
      await expect(
        harness.importer.confirmCost(
          readConfirmation(EXPECTED[2].file),
          EXPECTED[2].file,
        ),
      ).rejects.toThrow();

      const { items } = await harness.documents.findForTrip(trip.id);

      expect(items).toHaveLength(2);
      expect(items.every((item) => item.action === "COST_CONFIRMATION")).toBe(
        true,
      );
      expect(items.filter((item) => item.applied)).toHaveLength(1);
    });
  });

  describe("what is refused", () => {
    it("refuses a transport order sent as a confirmation", async () => {
      seedTrip("ANRDUB2602247");

      await expect(
        harness.importer.confirmCost(
          new Uint8Array(readFileSync(join(FIXTURES, "NEW/1page.pdf"))),
          "1page.pdf",
        ),
      ).rejects.toThrow();

      expect(harness.costConfirmations).toEqual([]);
    });

    it("refuses a subject that contradicts its document", async () => {
      seedTrip(EXPECTED[0].bookingNumber);

      await expect(
        harness.importer.confirmCost(
          readConfirmation(EXPECTED[0].file),
          EXPECTED[0].file,
          { subject: "COST CONFIRMATION NR 9999999 ANRDUB9999999" },
        ),
      ).rejects.toThrow(/subject names/);

      expect(harness.costConfirmations).toEqual([]);
      expect(harness.pdfDocuments).toEqual([]);
    });

    it("accepts a subject that agrees with its document", async () => {
      seedTrip(EXPECTED[0].bookingNumber);

      const result = await harness.importer.confirmCost(
        readConfirmation(EXPECTED[0].file),
        EXPECTED[0].file,
        {
          subject: `COST CONFIRMATION NR ${EXPECTED[0].ccNumber} ${EXPECTED[0].bookingNumber}`,
        },
      );

      expect(result.costConfirmations[0].outcome).toBe("RECORDED");
    });
  });
});

/** The booking numbers currently in the harness, for a short assertion. */
function result_trips(harness: RealDocumentHarness): string[] {
  return harness.trips.map((trip) => trip.bookingNumber as string);
}
