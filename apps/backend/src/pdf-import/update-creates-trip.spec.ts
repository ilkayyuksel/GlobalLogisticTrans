import { TripStatus } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * An UPDATE document for a booking nobody holds.
 *
 * ── THE SCENARIO ────────────────────────────────────────────────────────────
 * The original order never reached us — it was never sent, or never imported —
 * and the first document we see for that booking is a revision of it. Refusing
 * it leaves transport that is genuinely planned missing from the planning, so
 * the revision CREATES the Trip from its own document.
 *
 * What the Trip must NOT be is a second-class one. It is an ordinary imported
 * Trip: OPEN, carrying the parser-controlled values the document states, with
 * that document as its source. Nothing marks it manual or unknown, because it
 * is neither — a PDF created it.
 *
 * And it must not pretend to be an update: there was no earlier state, so there
 * is no change set, and nothing may report `containerNumber: null → XYZ123`.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(180_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");

function readFixture(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, relativePath)));
}

/** Every UPDATE fixture, with what its document states. */
const UPDATE_DOCUMENTS: readonly {
  file: string;
  bookings: string[];
  combination: boolean;
  city: string;
  date: string;
}[] = [
  {
    file: "UPDATE/transportorder1347531.pdf",
    bookings: ["DUBANR2761223", "ANRDUB2763318"],
    combination: true,
    city: "Zemst",
    date: "2026-06-19",
  },
  {
    file: "UPDATE/transportorder1348827.pdf",
    bookings: ["ANRDUB2765105"],
    combination: false,
    city: "Dourges",
    date: "2026-06-23",
  },
  {
    file: "UPDATE/transportorder1353246.pdf",
    bookings: ["ANRDUB2770817"],
    combination: false,
    city: "Lessines",
    date: "2026-07-08",
  },
  {
    file: "UPDATE/transportorder1368223.pdf",
    bookings: ["ANRDUB2790449"],
    combination: false,
    city: "Gondecourt",
    date: "2026-08-19",
  },
  {
    file: "UPDATE/transportorder1368224.pdf",
    bookings: ["ANRDUB2790528"],
    combination: false,
    city: "Gondecourt",
    date: "2026-08-19",
  },
  {
    file: "UPDATE/transportorder1368224 (1).pdf",
    bookings: ["ANRDUB2790528"],
    combination: false,
    city: "Gondecourt",
    date: "2026-08-19",
  },
  {
    file: "UPDATE/transportorder1369485.pdf",
    bookings: ["ANRDUB2790203"],
    combination: false,
    city: "Antwerpen",
    date: "2026-08-19",
  },
];

describe("an UPDATE document with no Trip to revise", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-update-creates-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  function tripFor(booking: string) {
    return harness.trips.find((trip) => trip.bookingNumber === booking) as
      | Record<string, unknown>
      | undefined;
  }

  function historyOf(tripId: string) {
    return harness.history.filter((entry) => entry.tripId === tripId);
  }

  it("covers every UPDATE document on disk", () => {
    expect(UPDATE_DOCUMENTS.map((entry) => entry.file).sort()).toEqual(
      readdirSync(join(FIXTURES, "UPDATE"))
        .filter((name) => name.endsWith(".pdf"))
        .map((name) => `UPDATE/${name}`)
        .sort(),
    );
  });

  describe.each(UPDATE_DOCUMENTS)("$file", (expected) => {
    it("creates a Trip for every booking it names", async () => {
      const result = await harness.importer.revise(
        readFixture(expected.file),
        expected.file,
      );

      expect(harness.trips).toHaveLength(expected.bookings.length);
      expect(result.revisions.map((entry) => entry.bookingNumber).sort()).toEqual(
        [...expected.bookings].sort(),
      );
      expect(
        result.revisions.every((entry) => entry.action === "CREATED_FROM_UPDATE"),
      ).toBe(true);
    });

    it("creates it OPEN", async () => {
      await harness.importer.revise(readFixture(expected.file), expected.file);

      for (const booking of expected.bookings) {
        expect(tripFor(booking)?.status).toBe(TripStatus.OPEN);
      }
    });

    it("fills the parser-controlled fields from the document", async () => {
      await harness.importer.revise(readFixture(expected.file), expected.file);

      const trip = tripFor(expected.bookings[0]) as Record<string, unknown>;

      expect(trip.destinationCity).toBe(expected.city);
      expect(trip.containerType).toEqual(expect.any(String));
      expect(trip.terminal).toEqual(expect.any(String));
      expect(trip.direction).toEqual(expect.any(String));
      expect(trip.parserMetadata).not.toBeNull();
    });

    /** The document's own date, and the same date as the original planning. */
    it("takes its date from the document, never from today", async () => {
      await harness.importer.revise(readFixture(expected.file), expected.file);

      const trip = tripFor(expected.bookings[0]) as Record<string, Date>;

      expect(trip.planningDate.toISOString().slice(0, 10)).toBe(expected.date);
      expect(trip.originalPlanningDate.toISOString().slice(0, 10)).toBe(
        expected.date,
      );
    });

    /** A document cannot know which truck, which driver, or how long we waited. */
    it("leaves every operator-controlled field empty", async () => {
      await harness.importer.revise(readFixture(expected.file), expected.file);

      for (const booking of expected.bookings) {
        expect(tripFor(booking)).toMatchObject({
          vehicleId: null,
          driverId: null,
          waitingTimeMinutes: null,
          distanceKm: null,
          executionDatetime: null,
          internalNotes: null,
        });
      }
    });

    it("keeps the document and makes it the Trip's source", async () => {
      await harness.importer.revise(readFixture(expected.file), expected.file);

      const document = harness.pdfDocuments[0] as { id: string };

      expect(harness.pdfDocuments).toHaveLength(1);
      expect(readdirSync(storageDirectory)).toHaveLength(1);

      for (const booking of expected.bookings) {
        expect(tripFor(booking)?.pdfDocumentId).toBe(document.id);
      }
    });

    /**
     * There was nothing to compare against, so there is no change set. A row
     * saying `containerNumber: null → …` would report a revision nobody made.
     */
    it("records that it created the Trip, with no invented change set", async () => {
      await harness.importer.revise(readFixture(expected.file), expected.file);

      for (const booking of expected.bookings) {
        const trip = tripFor(booking) as { id: string };
        const events = historyOf(trip.id);

        expect(events).toHaveLength(1);
        expect(events[0].eventType).toBe("UPDATE_CREATED_TRIP");
        expect(events[0].newValue).toBeUndefined();
        expect(events[0].previousValue).toBeUndefined();
      }

      expect(
        harness.history.some((entry) => entry.eventType === "UPDATE_APPLIED"),
      ).toBe(false);
    });

    it("shows the document as an UPDATE that created the Trip", async () => {
      await harness.importer.revise(readFixture(expected.file), expected.file);

      const trip = tripFor(expected.bookings[0]) as { id: string };
      const { items } = await harness.documents.findForTrip(trip.id);

      // One document: the update, which is also the source document.
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        action: "UPDATE",
        createdTrip: true,
        changedFields: [],
      });
    });

    /**
     * `latestUpdate` drives the "Bijgewerkt" marker, and this Trip was created
     * rather than revised — so it must report nothing.
     */
    it("is not reported as an updated Trip", async () => {
      await harness.importer.revise(readFixture(expected.file), expected.file);

      const trip = tripFor(expected.bookings[0]) as { id: string };

      expect(await harness.latestUpdateOf(trip.id)).toBeNull();
    });
  });

  describe("a combination whose legs are both missing", () => {
    const FILE = "UPDATE/transportorder1347531.pdf";

    it("creates both legs as one Combination", async () => {
      await harness.importer.revise(readFixture(FILE), FILE);

      expect(harness.trips).toHaveLength(2);
      expect(harness.tripGroups).toHaveLength(1);
      expect(
        harness.trips.every((trip) => trip.tripGroupId === harness.tripGroups[0]),
      ).toBe(true);
    });

    /**
     * With one leg already planned, the new Trip is created on its own: putting
     * it into a group would rearrange work somebody is already doing, which no
     * document asked for.
     */
    it("creates only the missing leg, ungrouped, when the other exists", async () => {
      await harness.importer.revise(readFixture(FILE), FILE);
      const [first] = harness.trips;

      // Start again with only one of the two legs present.
      harness.trips.length = 0;
      harness.tripGroups.length = 0;
      harness.history.length = 0;
      harness.trips.push({ ...first, tripGroupId: null });

      const result = await harness.importer.revise(readFixture(FILE), "again.pdf");

      expect(harness.trips).toHaveLength(2);
      expect(harness.tripGroups).toHaveLength(0);
      expect(result.revisions.map((entry) => entry.action).sort()).toEqual([
        "CREATED_FROM_UPDATE",
        "UPDATED",
      ]);
    });
  });

  describe("an update that follows one", () => {
    const FILE = "UPDATE/transportorder1368223.pdf";
    const BOOKING = "ANRDUB2790449";

    it("revises the Trip the first update created", async () => {
      await harness.importer.revise(readFixture(FILE), "update-1.pdf");
      const trip = tripFor(BOOKING) as Record<string, unknown>;
      const createdId = trip.id;

      // Move the Trip away from the document, so the next one is a real change.
      trip.containerNumber = "ABC123";

      const second = await harness.importer.revise(
        readFixture(FILE),
        "update-2.pdf",
      );

      expect(harness.trips).toHaveLength(1);
      expect(second.revisions[0]).toMatchObject({
        tripId: createdId,
        action: "UPDATED",
        changedFields: ["containerNumber"],
      });
    });

    it("keeps both documents and both events", async () => {
      await harness.importer.revise(readFixture(FILE), "update-1.pdf");
      (tripFor(BOOKING) as Record<string, unknown>).containerNumber = "ABC123";
      await harness.importer.revise(readFixture(FILE), "update-2.pdf");

      const trip = tripFor(BOOKING) as { id: string };
      const events = historyOf(trip.id).map((entry) => entry.eventType);

      expect(events).toEqual(["UPDATE_CREATED_TRIP", "UPDATE_APPLIED"]);
      expect(harness.pdfDocuments).toHaveLength(2);
    });

    it("reports the second update as the latest, and the first as none", async () => {
      await harness.importer.revise(readFixture(FILE), "update-1.pdf");
      const trip = tripFor(BOOKING) as { id: string };

      expect(await harness.latestUpdateOf(trip.id)).toBeNull();

      (tripFor(BOOKING) as Record<string, unknown>).terminal = "Quay 869";
      await harness.importer.revise(readFixture(FILE), "update-2.pdf");

      expect(await harness.latestUpdateOf(trip.id)).toMatchObject({
        changedFields: ["terminal"],
      });
    });

    it("revises again on a third document", async () => {
      await harness.importer.revise(readFixture(FILE), "update-1.pdf");
      (tripFor(BOOKING) as Record<string, unknown>).containerNumber = "ABC123";
      await harness.importer.revise(readFixture(FILE), "update-2.pdf");
      (tripFor(BOOKING) as Record<string, unknown>).terminal = "Quay 869";
      const third = await harness.importer.revise(
        readFixture(FILE),
        "update-3.pdf",
      );

      expect(third.revisions[0].changedFields).toEqual(["terminal"]);
      expect(harness.trips).toHaveLength(1);
    });
  });

  describe("the same update twice", () => {
    const FILE = "UPDATE/transportorder1368224.pdf";
    const COPY = "UPDATE/transportorder1368224 (1).pdf";

    it("creates one Trip, then revises it", async () => {
      const first = await harness.importer.revise(readFixture(FILE), FILE);
      const second = await harness.importer.revise(readFixture(COPY), COPY);

      expect(first.revisions[0].action).toBe("CREATED_FROM_UPDATE");
      expect(second.revisions[0].action).toBe("UPDATED");
      // One Trip, and the identical repeat changed nothing.
      expect(harness.trips).toHaveLength(1);
      expect(second.revisions[0].changedFields).toEqual([]);
    });

    /** Content-addressed storage: identical bytes are written once. */
    it("keeps one file for both arrivals", async () => {
      await harness.importer.revise(readFixture(FILE), FILE);
      await harness.importer.revise(readFixture(COPY), COPY);

      expect(readdirSync(storageDirectory)).toHaveLength(1);
      expect(harness.pdfDocuments).toHaveLength(2);
    });
  });

  describe("the lifecycle after a Trip is created this way", () => {
    const FILE = "UPDATE/transportorder1369485.pdf";
    const CANCELLED = "CANCEL/cancelled_transportorder1369485.pdf";
    const BOOKING = "ANRDUB2790203";

    it("can then be cancelled: UPDATE → CANCEL", async () => {
      await harness.importer.revise(readFixture(FILE), "update.pdf");

      const result = await harness.importer.cancel(
        readFixture(CANCELLED),
        "cancel.pdf",
      );

      expect(result.cancellations[0].outcome).toBe("CANCELLED");
      expect(tripFor(BOOKING)?.status).toBe(TripStatus.CANCELLED);
      // Both documents remain.
      expect(harness.pdfDocuments).toHaveLength(2);
    });

    it("refuses a NEW order for the booking it now holds: UPDATE → NEW", async () => {
      await harness.importer.revise(readFixture(FILE), "update.pdf");

      await expect(
        harness.importer.import(readFixture(FILE), "order.pdf"),
      ).rejects.toThrow();

      expect(harness.trips).toHaveLength(1);
    });

    it("does not create a second Trip after cancellation", async () => {
      await harness.importer.revise(readFixture(FILE), "update.pdf");
      await harness.importer.cancel(readFixture(CANCELLED), "cancel.pdf");

      await expect(
        harness.importer.revise(readFixture(FILE), "late-update.pdf"),
      ).rejects.toThrow();

      expect(harness.trips).toHaveLength(1);
      expect(tripFor(BOOKING)?.status).toBe(TripStatus.CANCELLED);
    });

    it("does not create a second Trip when the existing one is CLOSED", async () => {
      await harness.importer.revise(readFixture(FILE), "update.pdf");
      (tripFor(BOOKING) as Record<string, unknown>).status = TripStatus.CLOSED;

      await expect(
        harness.importer.revise(readFixture(FILE), "late-update.pdf"),
      ).rejects.toThrow(/CLOSED/);

      expect(harness.trips).toHaveLength(1);
      expect(tripFor(BOOKING)?.status).toBe(TripStatus.CLOSED);
    });
  });

  describe("atomicity", () => {
    /**
     * The Trip write fails, so nothing may survive it: no Trip, no document
     * row, and no file left on disk referencing nothing.
     */
    it("leaves nothing behind when the Trip cannot be written", async () => {
      // The row write fails, the way a database error would.
      const failing = harness.trips as unknown as Record<string, unknown>;
      failing.push = () => {
        throw new Error("write failed");
      };

      await expect(
        harness.importer.revise(
          readFixture("UPDATE/transportorder1348827.pdf"),
          "doomed.pdf",
        ),
      ).rejects.toThrow();

      // Restored to the real Array.prototype.push, not a copy of it.
      delete failing.push;

      expect(harness.trips).toHaveLength(0);
      expect(harness.pdfDocuments).toEqual([]);
      expect(readdirSync(storageDirectory)).toEqual([]);
    });
  });
});
