import { Prisma, Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { DriverService } from "../drivers/driver.service";
import { ImportedTripData } from "./import-trips.command";
import { TripDocumentsService } from "./trip-documents.service";
import { TripPlanningDataService } from "./trip-planning-data.service";
import { TripRevisionService } from "./trip-revision.service";
import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { TripRepository } from "./trip.repository";
import { VehicleAssignmentService } from "../vehicle-assignments/vehicle-assignment.service";
import { VehicleService } from "../vehicles/vehicle.service";

/**
 * MANY updates to one Trip, and what each of them left behind.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 * That every UPDATE document keeps its OWN answer. Three updates produce three
 * change sets, not one merged list and not only the last one; a value that goes
 * ABC → XYZ → ABC counts as changed both times, because each update is compared
 * against the Trip as it stood when that update arrived. The highlight an
 * operator sees means "the latest update moved this" — so an older update's
 * fields must stop being reported the moment a newer one lands.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The repository is in memory but behaves like the real one in the two respects
 * that matter: the audit trail is append-only, and a booking number is held by
 * every Trip that is not deleted.
 */

const BOOKING = "ANRDUB2602247";
const TRIP_ID = "trip-1";

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    status: TripStatus.OPEN,
    bookingNumber: BOOKING,
    containerNumber: "ABC123",
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-21T00:00:00.000Z"),
    planningDate: new Date("2026-08-21T00:00:00.000Z"),
    startTime: new Date("1970-01-01T08:00:00.000Z"),
    endTime: new Date("1970-01-01T10:00:00.000Z"),
    direction: "COLLECTION",
    vehicleId: "vehicle-1",
    driverId: null,
    waitingTimeMinutes: 45,
    distanceKm: null,
    executionDatetime: null,
    internalNotes: "Bel de klant",
    tripGroupId: null,
    pdfDocumentId: "pdf-new",
    parserMetadata: null,
    ...overrides,
  } as unknown as Trip;
}

/** The order as the document states it — identical to the Trip by default. */
function buildDocument(
  overrides: Partial<ImportedTripData> = {},
): ImportedTripData {
  return {
    bookingNumber: BOOKING,
    containerNumber: "ABC123",
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    planningDate: "2026-08-21",
    startTime: "08:00",
    endTime: "10:00",
    direction: "COLLECTION",
    parserMetadata: {},
    ...overrides,
  };
}

describe("many updates to one Trip", () => {
  let stored: Trip[];
  let history: Prisma.TripHistoryUncheckedCreateInput[];
  let documents: Record<string, { id: string; originalFilename: string }>;
  let clock: number;
  let repository: TripRepository;
  let revision: TripRevisionService;

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  beforeEach(() => {
    stored = [buildTrip()];
    history = [];
    documents = {};
    clock = 0;

    const fake: Record<string, jest.Mock> = {
      findByBookingNumber: jest.fn(
        ({
          bookingNumber,
          statuses,
        }: {
          bookingNumber: string;
          statuses: readonly TripStatus[];
        }) =>
          Promise.resolve(
            stored.find(
              (trip) =>
                trip.bookingNumber === bookingNumber &&
                statuses.includes(trip.status),
            ) ?? null,
          ),
      ),
      findById: jest.fn((id: string) =>
        Promise.resolve(stored.find((trip) => trip.id === id) ?? null),
      ),
      setStatus: jest.fn((id: string, status: TripStatus) => {
        const trip = stored.find((candidate) => candidate.id === id) as Trip;
        Object.assign(trip, { status });
        return Promise.resolve(trip);
      }),
      update: jest.fn((id: string, data: Record<string, unknown>) => {
        const trip = stored.find((candidate) => candidate.id === id) as Trip;
        Object.assign(trip, data);
        return Promise.resolve(trip);
      }),
      /** Append-only, and stamped in arrival order so "latest" is decidable. */
      recordHistory: jest.fn(
        (entries: Prisma.TripHistoryUncheckedCreateInput[]) => {
          for (const entry of entries) {
            clock += 1;
            history.push({
              ...entry,
              occurredAt: new Date(1_700_000_000_000 + clock * 1_000),
            });
          }

          return Promise.resolve();
        },
      ),
      findAppliedUpdateHistory: jest.fn((tripIds: readonly string[]) =>
        Promise.resolve(
          history
            .filter(
              (entry) =>
                entry.eventType === "UPDATE_APPLIED" &&
                tripIds.includes(entry.tripId),
            )
            .slice()
            .reverse(),
        ),
      ),
      findHistoryForTrip: jest.fn((tripId: string) =>
        Promise.resolve(
          history
            .filter((entry) => entry.tripId === tripId)
            .slice()
            .reverse()
            .map((entry) => ({
              ...entry,
              pdfDocument: entry.pdfDocumentId
                ? documents[entry.pdfDocumentId]
                : null,
            })),
        ),
      ),
      findPdfDocument: jest.fn((id: string) =>
        Promise.resolve(documents[id] ?? null),
      ),
      runInTransaction: jest.fn((work: (repository: unknown) => unknown) =>
        work(fake),
      ),
    };

    repository = fake as unknown as TripRepository;
    revision = new TripRevisionService(repository, logger);
  });

  /** A stored UPDATE document, as the importer would have committed one. */
  function documentNamed(id: string) {
    documents[id] = { id, originalFilename: `${id}.pdf` };

    return { pdfDocumentId: id };
  }

  async function update(
    id: string,
    overrides: Partial<ImportedTripData> = {},
  ) {
    return revision.applyDocumentRevision(
      buildDocument(overrides),
      documentNamed(id),
    );
  }

  /** What the Trip list would show as the latest update. */
  async function latestUpdate() {
    const planning = new TripPlanningDataService(
      {
        findManyByIds: jest.fn().mockResolvedValue(new Map()),
      } as unknown as VehicleService,
      {
        findManyByIds: jest.fn().mockResolvedValue(new Map()),
      } as unknown as DriverService,
      {
        findDriversForVehiclesOnDates: jest.fn().mockResolvedValue(new Map()),
      } as unknown as VehicleAssignmentService,
      {
        findCustomPropertiesForTrips: jest.fn().mockResolvedValue([]),
        findAppliedUpdateHistory: (
          repository as unknown as {
            findAppliedUpdateHistory: (ids: readonly string[]) => unknown;
          }
        ).findAppliedUpdateHistory,
      } as unknown as TripRepository,
      {
        findForTrips: () => Promise.resolve(new Map()),
      } as unknown as CostConfirmationService,
    );

    const resolved = await planning.resolveMany(stored);

    return resolved.get(TRIP_ID)?.latestUpdate ?? null;
  }

  function changeSetsOf(documentId: string): string[] {
    return history
      .filter((entry) => entry.pdfDocumentId === documentId)
      .flatMap((entry) =>
        entry.newValue && typeof entry.newValue === "object"
          ? Object.keys(entry.newValue as Record<string, unknown>)
          : [],
      );
  }

  describe("one update", () => {
    it("records the single field it moved", async () => {
      const result = await update("update-1", { containerNumber: "XYZ456" });

      expect(result.outcome).toBe("UPDATED");
      expect(result.changedFields).toEqual(["containerNumber"]);
      expect(changeSetsOf("update-1")).toEqual(["containerNumber"]);
      expect(stored[0].containerNumber).toBe("XYZ456");
    });

    it("records every field it moved, one row each", async () => {
      await update("update-1", {
        containerNumber: "XYZ456",
        terminal: "Quay 869",
        planningDate: "2026-08-22",
      });

      expect(changeSetsOf("update-1")).toEqual([
        "containerNumber",
        "terminal",
        "originalPlanningDate",
      ]);
      expect(
        history.filter((entry) => entry.pdfDocumentId === "update-1"),
      ).toHaveLength(3);
    });

    /**
     * An update that agrees with the Trip is still an update. It arrived, it
     * was accepted, and an update that left no trace would look like one that
     * never came.
     */
    it("records an update that changed nothing, with no fields", async () => {
      const result = await update("update-1");

      expect(result.outcome).toBe("UPDATED");
      expect(result.changedFields).toEqual([]);
      expect(changeSetsOf("update-1")).toEqual([]);
      expect(
        history.filter((entry) => entry.pdfDocumentId === "update-1"),
      ).toHaveLength(1);
      expect(await latestUpdate()).toMatchObject({ changedFields: [] });
    });

    it("invents no change for a field the document repeats", async () => {
      await update("update-1", { containerNumber: "XYZ456" });

      expect(changeSetsOf("update-1")).not.toContain("terminal");
      expect(changeSetsOf("update-1")).not.toContain("startTime");
    });
  });

  describe("several updates in a row", () => {
    it("gives each update its own change set", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await update("update-2", {
        containerNumber: "XYZ456",
        planningDate: "2026-08-22",
      });
      await update("update-3", {
        containerNumber: "DEF789",
        planningDate: "2026-08-22",
        terminal: "Quay 869",
      });

      expect(changeSetsOf("update-1")).toEqual(["containerNumber"]);
      expect(changeSetsOf("update-2")).toEqual(["originalPlanningDate"]);
      expect(changeSetsOf("update-3")).toEqual([
        "containerNumber",
        "terminal",
      ]);
    });

    it("compares against the state after the previous update", async () => {
      await update("update-1", { containerNumber: "XYZ456" });

      // Repeating UPDATE 1's value: nothing has moved since.
      const second = await update("update-2", { containerNumber: "XYZ456" });

      expect(second.changedFields).toEqual([]);
    });

    it("keeps every earlier change set intact", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await update("update-2", { containerNumber: "XYZ456", terminal: "Quay 869" });
      await update("update-3", { containerNumber: "DEF789", terminal: "Quay 869" });

      // Nothing collapsed, nothing overwritten: three documents, three answers.
      expect(new Set(history.map((entry) => entry.pdfDocumentId)).size).toBe(3);
      expect(changeSetsOf("update-1")).toEqual(["containerNumber"]);
      expect(changeSetsOf("update-2")).toEqual(["terminal"]);
    });

    /** Identical documents are each their own arrival, and each say "nothing". */
    it("records repeated identical updates separately", async () => {
      await update("update-1");
      await update("update-2");

      expect(history).toHaveLength(2);
      expect(changeSetsOf("update-1")).toEqual([]);
      expect(changeSetsOf("update-2")).toEqual([]);
    });
  });

  describe("a value that goes back to what it was", () => {
    it("counts both moves as changes", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await update("update-2", { containerNumber: "ABC123" });

      expect(changeSetsOf("update-1")).toEqual(["containerNumber"]);
      // Compared against XYZ456, not against the original ABC123.
      expect(changeSetsOf("update-2")).toEqual(["containerNumber"]);
      expect(stored[0].containerNumber).toBe("ABC123");
    });
  });

  describe("the latest update", () => {
    it("reports the fields the newest update moved", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await update("update-2", {
        containerNumber: "XYZ456",
        planningDate: "2026-08-22",
      });

      expect(await latestUpdate()).toMatchObject({
        changedFields: ["originalPlanningDate"],
        pdfDocumentId: "update-2",
      });
    });

    /** The whole point of the highlight: yesterday's field goes back to normal. */
    it("stops reporting the previous update's fields", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await update("update-2", {
        containerNumber: "XYZ456",
        planningDate: "2026-08-22",
      });

      expect((await latestUpdate())?.changedFields).not.toContain(
        "containerNumber",
      );
    });

    it("is null when no update has ever arrived", async () => {
      expect(await latestUpdate()).toBeNull();
    });

    /**
     * A cancellation does not replace the latest update. The update still
     * happened, and it is still the last thing that changed the Trip.
     */
    it("survives a later cancellation", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await revision.cancelByBookingNumber(BOOKING, documentNamed("cancel-1"));

      expect(await latestUpdate()).toMatchObject({
        changedFields: ["containerNumber"],
        pdfDocumentId: "update-1",
      });
    });

    /** A refused update changed nothing, so it is not the latest CHANGE. */
    it("ignores an update that was refused after cancellation", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await revision.cancelByBookingNumber(BOOKING, documentNamed("cancel-1"));
      await update("update-2", { containerNumber: "DEF789" });

      expect(await latestUpdate()).toMatchObject({ pdfDocumentId: "update-1" });
    });
  });

  describe("documents that could not be applied", () => {
    it("records an update that arrived after cancellation", async () => {
      await revision.cancelByBookingNumber(BOOKING, documentNamed("cancel-1"));

      const result = await update("update-1", { containerNumber: "XYZ456" });

      expect(result.outcome).toBe("REFUSED_CANCELLED");
      expect(stored[0].status).toBe(TripStatus.CANCELLED);
      expect(stored[0].containerNumber).toBe("ABC123");
      expect(history).toContainEqual(
        expect.objectContaining({
          eventType: "UPDATE_REFUSED",
          pdfDocumentId: "update-1",
        }),
      );
    });

    it("records a second cancellation without touching the Trip", async () => {
      await revision.cancelByBookingNumber(BOOKING, documentNamed("cancel-1"));
      const afterFirst = { ...stored[0] };

      const outcome = await revision.cancelByBookingNumber(
        BOOKING,
        documentNamed("cancel-2"),
      );

      expect(outcome).toBe("ALREADY_CANCELLED");
      expect(stored[0]).toEqual(afterFirst);
      expect(history).toContainEqual(
        expect.objectContaining({
          eventType: "CANCEL_REDUNDANT",
          pdfDocumentId: "cancel-2",
        }),
      );
    });

    it("records an update refused because the Trip is finished", async () => {
      stored[0].status = TripStatus.CLOSED;

      const result = await update("update-1", { containerNumber: "XYZ456" });

      expect(result.outcome).toBe("REFUSED_CLOSED");
      expect(stored[0].containerNumber).toBe("ABC123");
      expect(history).toContainEqual(
        expect.objectContaining({ eventType: "UPDATE_REFUSED" }),
      );
    });

    it("records a cancellation refused because the Trip is finished", async () => {
      stored[0].status = TripStatus.CLOSED;

      const outcome = await revision.cancelByBookingNumber(
        BOOKING,
        documentNamed("cancel-1"),
      );

      expect(outcome).toBe("REFUSED_CLOSED");
      expect(stored[0].status).toBe(TripStatus.CLOSED);
      expect(history).toContainEqual(
        expect.objectContaining({ eventType: "CANCEL_REFUSED" }),
      );
    });

    it("records a new order arriving for a booking number still held", async () => {
      await revision.cancelByBookingNumber(BOOKING, documentNamed("cancel-1"));

      await revision.recordRefusedNewOrder([BOOKING], documentNamed("new-2"));

      expect(stored[0].status).toBe(TripStatus.CANCELLED);
      expect(stored).toHaveLength(1);
      expect(history).toContainEqual(
        expect.objectContaining({
          eventType: "NEW_REFUSED_DUPLICATE",
          pdfDocumentId: "new-2",
        }),
      );
    });
  });

  describe("the document list", () => {
    async function listDocuments() {
      documents["pdf-new"] = { id: "pdf-new", originalFilename: "order.pdf" };

      const service = new TripDocumentsService(repository, logger);

      return (await service.findForTrip(TRIP_ID)).items;
    }

    it("shows every document of the Trip, newest first", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await update("update-2", { containerNumber: "DEF789" });
      await revision.cancelByBookingNumber(BOOKING, documentNamed("cancel-1"));

      const items = await listDocuments();

      expect(items.map((item) => item.pdfDocumentId)).toEqual([
        "cancel-1",
        "update-2",
        "update-1",
        "pdf-new",
      ]);
      expect(items.map((item) => item.action)).toEqual([
        "CANCEL",
        "UPDATE",
        "UPDATE",
        "NEW",
      ]);
    });

    /** One update that moved two fields is ONE document with two fields. */
    it("groups the rows of one update into a single entry", async () => {
      await update("update-1", {
        containerNumber: "XYZ456",
        terminal: "Quay 869",
      });

      const items = await listDocuments();
      const entry = items.find((item) => item.pdfDocumentId === "update-1");

      expect(items.filter((item) => item.action === "UPDATE")).toHaveLength(1);
      expect(entry?.changedFields.sort()).toEqual(["containerNumber", "terminal"]);
    });

    it("says which documents changed nothing", async () => {
      await revision.cancelByBookingNumber(BOOKING, documentNamed("cancel-1"));
      await update("update-1", { containerNumber: "XYZ456" });

      const items = await listDocuments();
      const refused = items.find((item) => item.pdfDocumentId === "update-1");

      expect(refused?.applied).toBe(false);
      expect(refused?.outcome).toMatch(/after cancellation/);
    });

    it("exposes no storage path and no email content", async () => {
      await update("update-1", { containerNumber: "XYZ456" });

      const items = await listDocuments();

      for (const item of items) {
        expect(Object.keys(item)).toEqual([
          "pdfDocumentId",
          "action",
          "originalFilename",
          "occurredAt",
          "changedFields",
          "outcome",
          "applied",
          "createdTrip",
        ]);
      }
    });
  });

  describe("what an update never touches", () => {
    it("leaves operator-controlled fields alone across many updates", async () => {
      await update("update-1", { containerNumber: "XYZ456" });
      await update("update-2", { terminal: "Quay 869" });
      await update("update-3", { destinationCity: "Lessines" });

      expect(stored[0].vehicleId).toBe("vehicle-1");
      expect(stored[0].waitingTimeMinutes).toBe(45);
      expect(stored[0].internalNotes).toBe("Bel de klant");
      expect(stored[0].status).toBe(TripStatus.OPEN);
    });
  });
});
