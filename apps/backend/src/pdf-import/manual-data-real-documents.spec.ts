import { TripStatus } from "@prisma/client";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildHarness, type RealDocumentHarness } from "./real-documents.harness";

/**
 * What the real UPDATE and CANCEL documents do to a Trip an operator worked on.
 *
 * ── THE TWO GUARANTEES ──────────────────────────────────────────────────────
 * 1. A document never removes what the operator entered: the waiting time
 *    (a window with Volgende dag, or a legacy duration alone) and the Custom
 *    Values they assigned. These documents print neither, and that silence is
 *    not an instruction to clear anything.
 * 2. A CANCEL only cancels a Trip that is OPEN when it is written. A CLOSED
 *    Trip is left exactly as it is; an already cancelled one is not rewritten.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * One real booking, ANRDUB2790203, has both a planned order and its
 * cancellation in the fixture set, so everything below runs on those two real
 * files through the real importer, revision service and matcher.
 */

jest.setTimeout(180_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");
const BOOKING = "ANRDUB2790203";
const PLANNED = "UPDATE/transportorder1369485.pdf";
const CANCELLED = "CANCEL/cancelled_transportorder1369485.pdf";

function readFixture(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, relativePath)));
}

function time(clock: string): Date {
  return new Date(`1970-01-01T${clock}:00.000Z`);
}

/** What an afternoon of planning leaves on the Trip. */
const OPERATOR_WINDOW = {
  vehicleId: "vehicle-1",
  driverId: "driver-1",
  containerNumber: "MSKU1234565",
  waitingTimeStart: time("10:00"),
  waitingTimeEnd: time("12:00"),
  waitingTimeEndsNextDay: true,
  waitingTimeMinutes: 960,
};

/** A waiting time entered before the two clock columns existed. */
const OPERATOR_LEGACY = {
  waitingTimeStart: null,
  waitingTimeEnd: null,
  waitingTimeEndsNextDay: false,
  waitingTimeMinutes: 135,
};

describe("operator data through the real UPDATE and CANCEL documents", () => {
  let storageDirectory: string;
  let harness: RealDocumentHarness;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-manual-data-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  /**
   * The real order imported as NEW, then worked on by an operator: the data
   * above on the Trip and two Custom Values assigned by hand.
   */
  async function plannedTrip(
    operatorData: Record<string, unknown>,
    status: TripStatus = TripStatus.OPEN,
  ): Promise<Record<string, unknown>> {
    await harness.importer.import(readFixture(PLANNED), "order.pdf");
    const trip = harness.trips.find(
      (candidate) => candidate.bookingNumber === BOOKING,
    ) as Record<string, unknown>;

    Object.assign(trip, operatorData, { status });
    for (const customPropertyId of ["property-genset", "property-customs"]) {
      harness.customProperties.push({
        id: `manual-${customPropertyId}`,
        tripId: trip.id,
        customPropertyId,
        isAutomatic: false,
      });
    }

    return trip;
  }

  function manualAssignments(tripId: unknown): string[] {
    return harness.customProperties
      .filter((row) => row.tripId === tripId && row.isAutomatic === false)
      .map((row) => row.customPropertyId as string)
      .sort();
  }

  function eventsOf(tripId: unknown): string[] {
    return harness.history
      .filter((entry) => entry.tripId === tripId)
      .map((entry) => entry.eventType as string);
  }

  describe("an UPDATE document", () => {
    it("keeps the manual Custom Values", async () => {
      const trip = await plannedTrip(OPERATOR_WINDOW);

      await harness.importer.revise(readFixture(PLANNED), "update.pdf");

      expect(manualAssignments(trip.id)).toEqual([
        "property-customs",
        "property-genset",
      ]);
    });

    it("keeps a waiting window with Volgende dag it does not mention", async () => {
      const trip = await plannedTrip(OPERATOR_WINDOW);

      await harness.importer.revise(readFixture(PLANNED), "update.pdf");

      expect(trip).toMatchObject({
        waitingTimeStart: time("10:00"),
        waitingTimeEnd: time("12:00"),
        waitingTimeEndsNextDay: true,
        waitingTimeMinutes: 960,
      });
    });

    it("keeps a legacy duration that has no times", async () => {
      const trip = await plannedTrip(OPERATOR_LEGACY);

      await harness.importer.revise(readFixture(PLANNED), "update.pdf");

      expect(trip).toMatchObject(OPERATOR_LEGACY);
    });

    /*
     * The real document prints no container: the field is EMPTY, not merely
     * absent. Emptiness is still not an instruction to clear what the operator
     * typed in, and the same holds for the vehicle and driver it never names.
     */
    it("keeps operator values where the document leaves the field empty", async () => {
      const trip = await plannedTrip(OPERATOR_WINDOW);

      const result = await harness.importer.revise(
        readFixture(PLANNED),
        "update.pdf",
      );

      expect(result.revisions[0].action).toBe("UPDATED");
      expect(trip).toMatchObject({
        containerNumber: "MSKU1234565",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
      });
    });
  });

  describe("a CANCEL document", () => {
    it("cancels an OPEN Trip and keeps everything the operator entered", async () => {
      const trip = await plannedTrip(OPERATOR_WINDOW);

      const result = await harness.importer.cancel(
        readFixture(CANCELLED),
        "cancel.pdf",
      );

      expect(result.cancellations).toEqual([
        { bookingNumber: BOOKING, outcome: "CANCELLED" },
      ]);
      expect(trip).toMatchObject({
        ...OPERATOR_WINDOW,
        status: TripStatus.CANCELLED,
      });
      expect(manualAssignments(trip.id)).toEqual([
        "property-customs",
        "property-genset",
      ]);
    });

    it("leaves a CLOSED Trip exactly as it was", async () => {
      const trip = await plannedTrip(OPERATOR_LEGACY, TripStatus.CLOSED);
      const before = { ...trip };
      const assignmentsBefore = manualAssignments(trip.id);

      const result = await harness.importer.cancel(
        readFixture(CANCELLED),
        "cancel.pdf",
      );

      expect(result.cancellations[0].outcome).toBe("REFUSED_CLOSED");
      expect(trip).toEqual(before);
      expect(manualAssignments(trip.id)).toEqual(assignmentsBefore);
      expect(eventsOf(trip.id)).toEqual(["CANCEL_REFUSED"]);
    });

    it("does not rewrite a Trip that is already cancelled", async () => {
      const trip = await plannedTrip(OPERATOR_WINDOW);
      await harness.importer.cancel(readFixture(CANCELLED), "cancel.pdf");
      const afterFirst = { ...trip };

      const result = await harness.importer.cancel(
        readFixture(CANCELLED),
        "cancel-again.pdf",
      );

      expect(result.cancellations[0].outcome).toBe("ALREADY_CANCELLED");
      expect(trip).toEqual(afterFirst);
      expect(manualAssignments(trip.id)).toEqual([
        "property-customs",
        "property-genset",
      ]);
      expect(eventsOf(trip.id)).toEqual(["CANCELLED", "CANCEL_REDUNDANT"]);
    });

    /*
     * ── THE RACE, AT THE IMPORT BOUNDARY ────────────────────────────────────
     * The Trip is OPEN when the document is matched and closed by an operator
     * before the cancellation is written. The write decides on what the row
     * holds then, so the closed work stays closed.
     */
    it("does not cancel a Trip that was closed after it was matched", async () => {
      const trip = await plannedTrip(OPERATOR_WINDOW);
      const repository = harness.tripRepository as unknown as {
        transitionStatus: jest.Mock;
      };
      const compareAndSet = repository.transitionStatus.getMockImplementation()!;
      repository.transitionStatus.mockImplementationOnce(
        (id: string, from: TripStatus, to: TripStatus) => {
          trip.status = TripStatus.CLOSED;
          return compareAndSet(id, from, to);
        },
      );

      const result = await harness.importer.cancel(
        readFixture(CANCELLED),
        "cancel.pdf",
      );

      expect(result.cancellations[0].outcome).toBe("REFUSED_CLOSED");
      expect(trip).toMatchObject({ ...OPERATOR_WINDOW, status: TripStatus.CLOSED });
    });

    /*
     * A failure leaves nothing behind, and the retry the next scan makes
     * cancels exactly once — with the operator's data still intact.
     */
    it("leaves no partial change when it fails, and cancels once on retry", async () => {
      const trip = await plannedTrip(OPERATOR_WINDOW);
      const documentsBefore = harness.pdfDocuments.length;
      const repository = harness.tripRepository as unknown as {
        transitionStatus: jest.Mock;
      };
      repository.transitionStatus.mockRejectedValueOnce(
        new Error("database unavailable"),
      );

      await expect(
        harness.importer.cancel(readFixture(CANCELLED), "cancel.pdf"),
      ).rejects.toThrow("database unavailable");

      expect(trip.status).toBe(TripStatus.OPEN);
      expect(harness.pdfDocuments).toHaveLength(documentsBefore);

      const retry = await harness.importer.cancel(
        readFixture(CANCELLED),
        "cancel.pdf",
      );

      expect(retry.cancellations[0].outcome).toBe("CANCELLED");
      expect(eventsOf(trip.id)).toEqual(["CANCELLED"]);
      expect(trip).toMatchObject(OPERATOR_WINDOW);
      expect(manualAssignments(trip.id)).toHaveLength(2);
    });
  });
});
