import { TripStatus } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * EVERY real UPDATE and CANCEL document, through the real workflow.
 *
 * ── WHY THESE DOCUMENTS AND NOT INVENTED ONES ───────────────────────────────
 * A revision is only interesting against a Trip that already exists, and the
 * fixtures are the only place where a real document and a real booking number
 * meet. Two of them share a booking — `UPDATE/transportorder1369485.pdf` and
 * `CANCEL/cancelled_transportorder1369485.pdf` both name ANRDUB2790203 — which
 * is the one case where a cancelled Trip can be offered a genuine later
 * document, and it is the case the terminal-cancellation rule exists for.
 *
 * Nothing is mocked but the database. The parser reads the real bytes, the
 * importer stores real files, and the change sets are computed by the real
 * comparison against whatever the Trip held a moment earlier.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(180_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");

function readFixture(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, relativePath)));
}

function listFixtures(folder: string): string[] {
  return readdirSync(join(FIXTURES, folder))
    .filter((name) => name.endsWith(".pdf"))
    .sort()
    .map((name) => `${folder}/${name}`);
}

/** Every UPDATE fixture, with the bookings its document names. */
const UPDATE_DOCUMENTS: readonly { file: string; bookings: string[] }[] = [
  { file: "UPDATE/transportorder1347531.pdf", bookings: ["DUBANR2761223", "ANRDUB2763318"] },
  { file: "UPDATE/transportorder1348827.pdf", bookings: ["ANRDUB2765105"] },
  { file: "UPDATE/transportorder1353246.pdf", bookings: ["ANRDUB2770817"] },
  { file: "UPDATE/transportorder1368223.pdf", bookings: ["ANRDUB2790449"] },
  { file: "UPDATE/transportorder1368224.pdf", bookings: ["ANRDUB2790528"] },
  { file: "UPDATE/transportorder1368224 (1).pdf", bookings: ["ANRDUB2790528"] },
  { file: "UPDATE/transportorder1369485.pdf", bookings: ["ANRDUB2790203"] },
];

/** Every CANCEL fixture, with the booking its document names. */
const CANCEL_DOCUMENTS: readonly { file: string; booking: string }[] = [
  { file: "CANCEL/cancelled_transportorder1353889.pdf", booking: "ANRBEL2772352" },
  { file: "CANCEL/cancelled_transportorder1354204.pdf", booking: "ANRDUB2767189" },
  { file: "CANCEL/cancelled_transportorder1365387.pdf", booking: "DUBANR2776470" },
  { file: "CANCEL/cancelled_transportorder1367320.pdf", booking: "ANRCRK2786825" },
  { file: "CANCEL/cancelled_transportorder1367583.pdf", booking: "ANRCRK2786827" },
  { file: "CANCEL/cancelled_transportorder1367584.pdf", booking: "ANRDUB2787843" },
  { file: "CANCEL/cancelled_transportorder1369485.pdf", booking: "ANRDUB2790203" },
  { file: "CANCEL/cancelled_transportorder1369488.pdf", booking: "ANRDUB2790211" },
];

/** The booking both folders name, which is what makes the pair testable. */
const SHARED_BOOKING = "ANRDUB2790203";
const PLANNED_1369485 = "UPDATE/transportorder1369485.pdf";
const CANCELLED_1369485 = "CANCEL/cancelled_transportorder1369485.pdf";

describe("every real UPDATE and CANCEL document, through the real workflow", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-real-workflow-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  /**
   * A Trip for every booking the document names, created from that same
   * document.
   *
   * Importing it as NEW first is what gives the revision something real to
   * match: the booking numbers, the dates and the container all come from the
   * document itself, so nothing about the pairing is invented.
   */
  async function importAsNew(file: string) {
    return harness.importer.import(readFixture(file), file.split("/")[1]);
  }

  function tripFor(booking: string) {
    return harness.trips.find((trip) => trip.bookingNumber === booking) as
      | Record<string, unknown>
      | undefined;
  }

  function historyOf(tripId: string) {
    return harness.history.filter((entry) => entry.tripId === tripId);
  }

  function changedFieldsOf(tripId: string, pdfDocumentId: string): string[] {
    return historyOf(tripId)
      .filter(
        (entry) =>
          entry.pdfDocumentId === pdfDocumentId &&
          entry.eventType === "UPDATE_APPLIED",
      )
      .flatMap((entry) =>
        entry.newValue && typeof entry.newValue === "object"
          ? Object.keys(entry.newValue as Record<string, unknown>)
          : [],
      );
  }

  describe("the inventory", () => {
    /** A fixture added to the folder must not be silently skipped. */
    it("covers every UPDATE document on disk", () => {
      expect(UPDATE_DOCUMENTS.map((entry) => entry.file).sort()).toEqual(
        listFixtures("UPDATE"),
      );
    });

    it("covers every CANCEL document on disk", () => {
      expect(CANCEL_DOCUMENTS.map((entry) => entry.file).sort()).toEqual(
        listFixtures("CANCEL"),
      );
    });
  });

  describe.each(UPDATE_DOCUMENTS)("$file as a revision", ({ file, bookings }) => {
    it("stores the document and updates the Trips it names", async () => {
      await importAsNew(file);
      const documentsAfterImport = harness.pdfDocuments.length;

      const result = await harness.importer.revise(readFixture(file), file);

      // The revision is a document of its own, kept beside the original.
      expect(harness.pdfDocuments).toHaveLength(documentsAfterImport + 1);
      expect(result.revisions.map((entry) => entry.bookingNumber).sort()).toEqual(
        [...bookings].sort(),
      );
      // No Trip was created by the revision, whatever it changed.
      expect(harness.trips).toHaveLength(bookings.length);
    });

    it("records one history event per Trip, pointing at that document", async () => {
      await importAsNew(file);

      await harness.importer.revise(readFixture(file), file);

      const revisionDocument = harness.pdfDocuments.at(-1) as { id: string };

      for (const booking of bookings) {
        const trip = tripFor(booking) as { id: string };
        const events = historyOf(trip.id).filter(
          (entry) => entry.pdfDocumentId === revisionDocument.id,
        );

        expect(events.length).toBeGreaterThan(0);
        expect(events[0].eventType).toBe("UPDATE_APPLIED");
      }
    });

    /**
     * The same document applied to the Trip it created states exactly what the
     * Trip already holds, so the honest change set is empty. Anything else
     * would mean the comparison invents differences.
     */
    it("reports no changed field when it repeats what the Trip holds", async () => {
      await importAsNew(file);

      const result = await harness.importer.revise(readFixture(file), file);

      for (const revision of result.revisions) {
        expect(revision.changedFields).toEqual([]);
      }
    });

    it("leaves every operator-controlled field untouched", async () => {
      await importAsNew(file);

      for (const booking of bookings) {
        Object.assign(tripFor(booking) as Record<string, unknown>, {
          vehicleId: "vehicle-1",
          waitingTimeMinutes: 45,
          internalNotes: "Bel de klant",
        });
      }

      await harness.importer.revise(readFixture(file), file);

      for (const booking of bookings) {
        expect(tripFor(booking)).toMatchObject({
          vehicleId: "vehicle-1",
          waitingTimeMinutes: 45,
          internalNotes: "Bel de klant",
          status: TripStatus.OPEN,
        });
      }
    });

    it("keeps the revision document readable afterwards", async () => {
      await importAsNew(file);
      await harness.importer.revise(readFixture(file), file);

      const stored = harness.pdfDocuments.at(-1) as { id: string };
      const content = await harness.pdfDocumentService.readContent(stored.id);

      // The same bytes the sender sent, under the name they sent them with.
      expect(content.content.byteLength).toBe(readFixture(file).byteLength);
      expect(content.originalFilename).toBe(file);
    });
  });

  describe.each(CANCEL_DOCUMENTS)("$file as a cancellation", ({ file, booking }) => {
    it("cancels the Trip it names and keeps everything", async () => {
      const created = await importAsNew(file.replace("CANCEL/", "CANCEL/"));

      /*
       * A CANCELLED document creates nothing, so the Trip has to come from
       * somewhere else. The planned twin exists for one booking only; for the
       * rest the Trip is created from the same document with the stamp ignored,
       * which is what `importAsNew` cannot do — so it is built directly here,
       * carrying the booking number the document names and nothing invented.
       */
      expect(created.trips).toEqual([]);

      const trip = {
        id: `trip-${harness.trips.length + 1}`,
        bookingNumber: booking,
        status: TripStatus.OPEN,
        containerNumber: null,
        containerType: "45PH",
        terminal: "PSA Quay 869",
        destinationCity: "Antwerpen",
        destinationCountry: "Belgium",
        originalPlanningDate: new Date("2026-08-19T00:00:00.000Z"),
        planningDate: new Date("2026-08-19T00:00:00.000Z"),
        startTime: null,
        endTime: null,
        direction: "COLLECTION",
        vehicleId: "vehicle-1",
        waitingTimeMinutes: 30,
        internalNotes: "Operator note",
        pdfDocumentId: "pdf-original",
        tripGroupId: null,
      };
      harness.trips.push(trip);

      const documentsBefore = harness.pdfDocuments.length;
      const result = await harness.importer.cancel(readFixture(file), file);

      expect(result.cancellations).toEqual([
        { bookingNumber: booking, outcome: "CANCELLED" },
      ]);
      expect(trip.status).toBe(TripStatus.CANCELLED);
      // The Trip survives with everything on it.
      expect(trip.vehicleId).toBe("vehicle-1");
      expect(trip.waitingTimeMinutes).toBe(30);
      expect(trip.internalNotes).toBe("Operator note");
      expect(trip.pdfDocumentId).toBe("pdf-original");
      // And the cancellation document is kept and recorded.
      expect(harness.pdfDocuments).toHaveLength(documentsBefore + 1);

      const cancelDocument = harness.pdfDocuments.at(-1) as { id: string };

      expect(historyOf(trip.id)).toContainEqual(
        expect.objectContaining({
          eventType: "CANCELLED",
          pdfDocumentId: cancelDocument.id,
        }),
      );
    });
  });

  /**
   * ── THE PAIR ────────────────────────────────────────────────────────────
   * One booking, two real documents: the planned order and the cancelled one.
   * Everything below is the same two files in a different order.
   * ────────────────────────────────────────────────────────────────────────
   */
  describe("the booking both folders name", () => {
    async function importPlanned() {
      const result = await importAsNew(PLANNED_1369485);

      return result.trips[0];
    }

    it("cancels after a revision: NEW → UPDATE → CANCEL", async () => {
      const created = await importPlanned();
      await harness.importer.revise(readFixture(PLANNED_1369485), "update.pdf");
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");

      expect(tripFor(SHARED_BOOKING)?.status).toBe(TripStatus.CANCELLED);
      // Three documents: the order, the revision, the cancellation.
      expect(harness.pdfDocuments).toHaveLength(3);
      expect(historyOf(created.id).map((entry) => entry.eventType)).toEqual([
        "UPDATE_APPLIED",
        "CANCELLED",
      ]);
    });

    it("stays cancelled when the revision arrives after: NEW → CANCEL → UPDATE", async () => {
      const created = await importPlanned();
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");

      await expect(
        harness.importer.revise(readFixture(PLANNED_1369485), "late-update.pdf"),
      ).rejects.toThrow();

      expect(tripFor(SHARED_BOOKING)?.status).toBe(TripStatus.CANCELLED);
      // The refused revision is kept and recorded, and it changed nothing.
      expect(harness.pdfDocuments).toHaveLength(3);
      expect(historyOf(created.id)).toContainEqual(
        expect.objectContaining({ eventType: "UPDATE_REFUSED" }),
      );
    });

    it("does not let a refused revision become the latest update", async () => {
      const created = await importPlanned();
      await harness.importer.revise(readFixture(PLANNED_1369485), "update.pdf");
      const applied = harness.pdfDocuments.at(-1) as { id: string };

      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");
      await expect(
        harness.importer.revise(readFixture(PLANNED_1369485), "late-update.pdf"),
      ).rejects.toThrow();

      const latest = await harness.latestUpdateOf(created.id);

      expect(latest?.pdfDocumentId).toBe(applied.id);
    });

    it("creates no second Trip for a cancelled booking: NEW → CANCEL → NEW", async () => {
      await importPlanned();
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");

      await expect(importPlanned()).rejects.toThrow();

      expect(harness.trips).toHaveLength(1);
      expect(tripFor(SHARED_BOOKING)?.status).toBe(TripStatus.CANCELLED);
    });

    it("records a second cancellation without moving anything", async () => {
      const created = await importPlanned();
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel-1.pdf");

      const result = await harness.importer.cancel(
        readFixture(CANCELLED_1369485),
        "cancel-2.pdf",
      );

      expect(result.cancellations[0].outcome).toBe("ALREADY_CANCELLED");
      expect(tripFor(SHARED_BOOKING)?.status).toBe(TripStatus.CANCELLED);
      expect(historyOf(created.id)).toContainEqual(
        expect.objectContaining({ eventType: "CANCEL_REDUNDANT" }),
      );
    });

    it("reopens only when an operator says so", async () => {
      const created = await importPlanned();
      await harness.importer.revise(readFixture(PLANNED_1369485), "update.pdf");
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");
      const documentsBefore = harness.pdfDocuments.length;
      const historyBefore = historyOf(created.id).length;
      const latestBefore = await harness.latestUpdateOf(created.id);

      const reopened = await harness.tripService.changeStatus(created.id, {
        status: TripStatus.OPEN,
      });

      expect(reopened.status).toBe(TripStatus.OPEN);
      expect(harness.pdfDocuments).toHaveLength(documentsBefore);
      expect(historyOf(created.id).length).toBe(historyBefore);
      expect(await harness.latestUpdateOf(created.id)).toEqual(latestBefore);
      // Opening prices nothing: only closing publishes.
      expect(harness.events).toEqual([]);
    });
  });

  /**
   * ── SEVERAL REVISIONS IN A ROW ──────────────────────────────────────────
   * Each is compared against the Trip as it stood immediately before it, which
   * is what makes the third one report only what the third one moved.
   * ────────────────────────────────────────────────────────────────────────
   */
  describe("three revisions of one real order", () => {
    const FILE = "UPDATE/transportorder1368223.pdf";

    it("gives each revision its own change set", async () => {
      const created = (await importAsNew(FILE)).trips[0];

      // Move the Trip away from the document between revisions, so the next
      // one is a genuine change of exactly the fields moved.
      Object.assign(tripFor("ANRDUB2790449") as Record<string, unknown>, {
        containerNumber: "ABC123",
      });
      await harness.importer.revise(readFixture(FILE), "update-1.pdf");
      const first = harness.pdfDocuments.at(-1) as { id: string };

      Object.assign(tripFor("ANRDUB2790449") as Record<string, unknown>, {
        terminal: "Quay 869",
      });
      await harness.importer.revise(readFixture(FILE), "update-2.pdf");
      const second = harness.pdfDocuments.at(-1) as { id: string };

      await harness.importer.revise(readFixture(FILE), "update-3.pdf");
      const third = harness.pdfDocuments.at(-1) as { id: string };

      expect(changedFieldsOf(created.id, first.id)).toEqual(["containerNumber"]);
      expect(changedFieldsOf(created.id, second.id)).toEqual(["terminal"]);
      // The third repeats what the second left; nothing moved.
      expect(changedFieldsOf(created.id, third.id)).toEqual([]);
    });

    it("keeps every earlier revision in the history", async () => {
      const created = (await importAsNew(FILE)).trips[0];

      for (const label of ["update-1.pdf", "update-2.pdf", "update-3.pdf"]) {
        await harness.importer.revise(readFixture(FILE), label);
      }

      const documents = new Set(
        historyOf(created.id).map((entry) => entry.pdfDocumentId),
      );

      expect(documents.size).toBe(3);
      expect(harness.pdfDocuments).toHaveLength(4);
    });

    it("counts a value that returns to an earlier one as changed again", async () => {
      const created = (await importAsNew(FILE)).trips[0];
      const trip = tripFor("ANRDUB2790449") as Record<string, unknown>;

      Object.assign(trip, { containerNumber: "ABC123" });
      await harness.importer.revise(readFixture(FILE), "update-1.pdf");
      const first = harness.pdfDocuments.at(-1) as { id: string };

      Object.assign(trip, { containerNumber: "ABC123" });
      await harness.importer.revise(readFixture(FILE), "update-2.pdf");
      const second = harness.pdfDocuments.at(-1) as { id: string };

      expect(changedFieldsOf(created.id, first.id)).toEqual(["containerNumber"]);
      expect(changedFieldsOf(created.id, second.id)).toEqual(["containerNumber"]);
    });

    it("reports the newest revision as the latest update", async () => {
      const created = (await importAsNew(FILE)).trips[0];

      Object.assign(tripFor("ANRDUB2790449") as Record<string, unknown>, {
        containerNumber: "ABC123",
      });
      await harness.importer.revise(readFixture(FILE), "update-1.pdf");

      Object.assign(tripFor("ANRDUB2790449") as Record<string, unknown>, {
        terminal: "Quay 869",
      });
      await harness.importer.revise(readFixture(FILE), "update-2.pdf");
      const second = harness.pdfDocuments.at(-1) as { id: string };

      const latest = await harness.latestUpdateOf(created.id);

      expect(latest).toMatchObject({
        pdfDocumentId: second.id,
        changedFields: ["terminal"],
      });
    });
  });

  describe("the same document twice", () => {
    const FILE = "UPDATE/transportorder1368224.pdf";
    const COPY = "UPDATE/transportorder1368224 (1).pdf";

    /** Byte-identical, filed under a different name. */
    it("is the same bytes under both filenames", () => {
      expect(readFixture(COPY)).toEqual(readFixture(FILE));
    });

    it("creates no second Trip when re-imported under another name", async () => {
      await importAsNew(FILE);

      await expect(importAsNew(COPY)).rejects.toThrow();

      expect(harness.trips).toHaveLength(1);
    });

    it("stores one FILE for both, and one row for each arrival", async () => {
      await importAsNew(FILE);
      await harness.importer.revise(readFixture(COPY), COPY);

      // Content-addressed: identical bytes are written once.
      expect(readdirSync(storageDirectory)).toHaveLength(1);
      // Two arrivals, two records — each with the name it arrived under.
      expect(harness.pdfDocuments).toHaveLength(2);
      expect(harness.pdfDocuments.at(-1)?.originalFilename).toBe(COPY);
    });

    it("applies the revision once per arrival, changing nothing the second time", async () => {
      const created = (await importAsNew(FILE)).trips[0];

      await harness.importer.revise(readFixture(FILE), "update-1.pdf");
      await harness.importer.revise(readFixture(COPY), "update-2.pdf");

      const applied = historyOf(created.id).filter(
        (entry) => entry.eventType === "UPDATE_APPLIED",
      );

      expect(applied).toHaveLength(2);
      expect(applied.every((entry) => entry.newValue === undefined)).toBe(true);
    });
  });

  describe("finished work", () => {
    const FILE = "UPDATE/transportorder1348827.pdf";

    it("is not rewritten by a revision, and the document is kept", async () => {
      const created = (await importAsNew(FILE)).trips[0];
      const trip = tripFor("ANRDUB2765105") as Record<string, unknown>;
      trip.status = TripStatus.CLOSED;
      trip.containerNumber = "ABC123";

      await expect(
        harness.importer.revise(readFixture(FILE), "late-update.pdf"),
      ).rejects.toThrow();

      expect(trip.status).toBe(TripStatus.CLOSED);
      expect(trip.containerNumber).toBe("ABC123");
      expect(harness.pdfDocuments).toHaveLength(2);
      expect(historyOf(created.id)).toContainEqual(
        expect.objectContaining({ eventType: "UPDATE_REFUSED" }),
      );
    });

    it("is not cancelled by a later cancellation, and that is recorded", async () => {
      const created = (await importAsNew(FILE)).trips[0];
      const trip = tripFor("ANRDUB2765105") as Record<string, unknown>;
      trip.status = TripStatus.CLOSED;

      const result = await harness.importer.cancel(
        readFixture(FILE),
        "cancel.pdf",
      );

      expect(result.cancellations[0].outcome).toBe("REFUSED_CLOSED");
      expect(trip.status).toBe(TripStatus.CLOSED);
      expect(historyOf(created.id)).toContainEqual(
        expect.objectContaining({ eventType: "CANCEL_REFUSED" }),
      );
    });
  });

  describe("the document history of a real Trip", () => {
    it("lists the order, its revisions and its cancellation", async () => {
      const created = (await importAsNew(PLANNED_1369485)).trips[0];

      Object.assign(tripFor(SHARED_BOOKING) as Record<string, unknown>, {
        containerNumber: "ABC123",
      });
      await harness.importer.revise(readFixture(PLANNED_1369485), "update-1.pdf");
      await harness.importer.revise(readFixture(PLANNED_1369485), "update-2.pdf");
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");

      const { items } = await harness.documents.findForTrip(created.id);

      expect(items.map((item) => item.action)).toEqual([
        "CANCEL",
        "UPDATE",
        "UPDATE",
        "NEW",
      ]);
      expect(items.map((item) => item.originalFilename)).toEqual([
        "cancel.pdf",
        "update-2.pdf",
        "update-1.pdf",
        "transportorder1369485.pdf",
      ]);
      // Only the first revision moved anything.
      expect(items[2].changedFields).toEqual(["containerNumber"]);
      expect(items[1].changedFields).toEqual([]);
    });

    it("returns bytes for every listed document", async () => {
      const created = (await importAsNew(PLANNED_1369485)).trips[0];
      await harness.importer.revise(readFixture(PLANNED_1369485), "update-1.pdf");
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");

      const { items } = await harness.documents.findForTrip(created.id);

      for (const item of items) {
        const content = await harness.pdfDocumentService.readContent(
          item.pdfDocumentId,
        );

        expect(content.originalFilename).toBe(item.originalFilename);
        expect(content.content.byteLength).toBeGreaterThan(0);
      }
    });

    /** The cancellation and the order are different bytes; prove they differ. */
    it("returns the right bytes for each of them", async () => {
      const created = (await importAsNew(PLANNED_1369485)).trips[0];
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");

      const { items } = await harness.documents.findForTrip(created.id);
      const cancel = items.find((item) => item.action === "CANCEL") as {
        pdfDocumentId: string;
      };
      const order = items.find((item) => item.action === "NEW") as {
        pdfDocumentId: string;
      };

      const cancelBytes = await harness.pdfDocumentService.readContent(
        cancel.pdfDocumentId,
      );
      const orderBytes = await harness.pdfDocumentService.readContent(
        order.pdfDocumentId,
      );

      expect(cancelBytes.content.byteLength).toBe(
        readFixture(CANCELLED_1369485).byteLength,
      );
      expect(orderBytes.content.byteLength).toBe(
        readFixture(PLANNED_1369485).byteLength,
      );
      expect(cancelBytes.content.equals(orderBytes.content)).toBe(false);
    });
  });

  describe("atomicity", () => {
    /**
     * A revision naming a booking nobody holds CREATES the Trip: the original
     * order never reached us, and refusing it would leave real transport
     * unplanned. Its document is kept, because it is now that Trip's source.
     */
    it("creates the Trip a revision names when nobody holds it", async () => {
      const result = await harness.importer.revise(
        readFixture("UPDATE/transportorder1353246.pdf"),
        "no-order-arrived.pdf",
      );

      expect(result.revisions[0].action).toBe("CREATED_FROM_UPDATE");
      expect(harness.trips).toHaveLength(1);
      expect(harness.pdfDocuments).toHaveLength(1);
      expect(readdirSync(storageDirectory)).toHaveLength(1);
    });

    it("writes nothing partial when a revision is refused", async () => {
      const created = (await importAsNew(PLANNED_1369485)).trips[0];
      await harness.importer.cancel(readFixture(CANCELLED_1369485), "cancel.pdf");
      const before = { ...(tripFor(SHARED_BOOKING) as Record<string, unknown>) };

      await expect(
        harness.importer.revise(readFixture(PLANNED_1369485), "late.pdf"),
      ).rejects.toThrow();

      expect(tripFor(SHARED_BOOKING)).toEqual(before);
      // One event for the refusal, and its document to explain it.
      expect(
        historyOf(created.id).filter(
          (entry) => entry.eventType === "UPDATE_REFUSED",
        ),
      ).toHaveLength(1);
    });
  });
});
