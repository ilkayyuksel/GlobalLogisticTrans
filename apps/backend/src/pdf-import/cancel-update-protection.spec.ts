import { TripStatus } from "@prisma/client";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RevisionRefusedException } from "./exceptions/pdf-import.exceptions";
import { buildHarness } from "./real-documents.harness";

/**
 * UPDATE and CANCEL documents against a protected Trip, and a COLLECTION
 * matched without a container — through the real parser, the real importer and
 * the real revision service; only the tables are in memory.
 *
 * ── THE RULES (owner, November 2026) ────────────────────────────────────────
 * A Trip that is CLOSED, or has a driver assigned (`driverId`), is changed by
 * neither an UPDATE nor a CANCEL: nothing is written to it, the refusal is
 * recorded against it, and the document is a HANDLED one — no exception, so its
 * email is processed and never retried.
 *
 * A COLLECTION document printing no container finds its Trip by booking number
 * and ORIGINAL date (`resolveTripForDocument`), never by the current planning
 * date — and that original date is never written back as the planning date.
 *
 * ── THE DOCUMENTS ───────────────────────────────────────────────────────────
 * The real pair 1369485: a COLLECTION for booking ANRDUB2790203 on 2026-08-19,
 * printing no container, as an UPDATE and as a CANCEL.
 * ────────────────────────────────────────────────────────────────────────────
 */

jest.setTimeout(120_000);

const FIXTURES = resolve(__dirname, "../../../../docs/06-pdf");
const UPDATE = "UPDATE/transportorder1369485.pdf";
const CANCEL = "CANCEL/cancelled_transportorder1369485.pdf";
const BOOKING = "ANRDUB2790203";
const ORIGINAL_DAY = new Date("2026-08-19T00:00:00.000Z");
const MOVED_DAY = new Date("2026-08-21T00:00:00.000Z");
const DRIVER = "driver-1";

function readFixture(relativePath: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, relativePath)));
}

describe("UPDATE and CANCEL documents for a protected Trip, and a collection without a container", () => {
  let storageDirectory: string;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "tms-protection-"));
    harness = buildHarness(storageDirectory);
  });

  afterEach(async () => {
    await rm(storageDirectory, { recursive: true, force: true });
  });

  /** The order imported as NEW, then planned by an operator as `planning` says. */
  async function existingTrip(planning: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    await harness.importer.import(readFixture(UPDATE), "order.pdf");
    const trip = harness.trips.find((candidate) => candidate.bookingNumber === BOOKING) as Record<string, unknown>;

    // The container an operator typed in later: the documents still print none.
    Object.assign(trip, { containerNumber: "MSKU1234565" }, planning);

    return trip;
  }

  const eventsOf = (trip: Record<string, unknown>) =>
    harness.history.filter((entry) => entry.tripId === trip.id);
  const update = () => harness.importer.revise(readFixture(UPDATE), "update.pdf");
  const cancel = () => harness.importer.cancel(readFixture(CANCEL), "cancel.pdf");

  describe("1–5. a protected Trip is left exactly as it is", () => {
    const PROTECTED = [
      ["CLOSED, no driver", { status: TripStatus.CLOSED, driverId: null }, "REFUSED_CLOSED"],
      ["OPEN with a driver", { status: TripStatus.OPEN, driverId: DRIVER }, "REFUSED_DRIVER_ASSIGNED"],
      ["CLOSED with a driver", { status: TripStatus.CLOSED, driverId: DRIVER }, "REFUSED_CLOSED"],
    ] as const;

    it.each(PROTECTED)("%s: an UPDATE is ignored", async (_label, planning, reason) => {
      const trip = await existingTrip({ ...planning, planningDate: MOVED_DAY });
      const before = { ...trip };

      const result = await update();

      expect(result.revisions).toEqual([
        { bookingNumber: BOOKING, tripId: trip.id, action: reason, changedFields: [] },
      ]);
      expect(trip).toEqual(before);
      expect(harness.trips).toHaveLength(1);
      expect(harness.events).toEqual([]);
      expect(eventsOf(trip)).toContainEqual(
        expect.objectContaining({ eventType: "UPDATE_REFUSED", newValue: { reason } }),
      );
    });

    it.each(PROTECTED)("%s: a CANCEL is ignored", async (_label, planning, reason) => {
      const trip = await existingTrip({ ...planning, planningDate: MOVED_DAY });
      const before = { ...trip };

      const result = await cancel();

      expect(result.cancellations).toEqual([{ bookingNumber: BOOKING, outcome: reason }]);
      expect(trip).toEqual(before);
      expect(harness.trips).toHaveLength(1);
      expect(harness.events).toEqual([]);
      expect(eventsOf(trip)).toContainEqual(
        expect.objectContaining({ eventType: "CANCEL_REFUSED", newValue: { reason } }),
      );
    });

    /* A CANCELLED Trip with a driver is not brought back by an UPDATE either. */
    it("does not reopen a cancelled Trip that has a driver", async () => {
      const trip = await existingTrip({ status: TripStatus.CANCELLED, driverId: DRIVER });
      const before = { ...trip };

      const result = await update();

      expect(result.revisions[0].action).toBe("REFUSED_DRIVER_ASSIGNED");
      expect(trip).toEqual(before);
    });
  });

  describe("6/7. an OPEN Trip without a driver is handled as before", () => {
    it("6. an UPDATE is applied", async () => {
      const trip = await existingTrip({ terminal: "Somewhere else" });

      const result = await update();

      expect(result.revisions[0]).toMatchObject({ action: "UPDATED", tripId: trip.id });
      expect(trip.terminal).not.toBe("Somewhere else");
      expect(eventsOf(trip).map((entry) => entry.eventType)).toContain("UPDATE_APPLIED");
    });

    it("7. a CANCEL is applied", async () => {
      const trip = await existingTrip();

      const result = await cancel();

      expect(result.cancellations).toEqual([{ bookingNumber: BOOKING, outcome: "CANCELLED" }]);
      expect(trip.status).toBe(TripStatus.CANCELLED);
    });
  });

  describe("12/13/18/20/21. a collection without a container, re-planned to another day", () => {
    it("12/13/18/20. an UPDATE finds the Trip by booking and ORIGINAL date, and keeps its planning date", async () => {
      const trip = await existingTrip({ planningDate: MOVED_DAY });

      const result = await update();

      expect(result.revisions[0]).toMatchObject({ action: "UPDATED", tripId: trip.id });
      expect(harness.trips).toHaveLength(1);
      expect(trip).toMatchObject({
        status: TripStatus.OPEN,
        originalPlanningDate: ORIGINAL_DAY,
        planningDate: MOVED_DAY,
        // The document printed no container; the operator's stays.
        containerNumber: "MSKU1234565",
      });
    });

    it("21. a CANCEL finds it the same way, and keeps its planning date", async () => {
      const trip = await existingTrip({ planningDate: MOVED_DAY });

      const result = await cancel();

      expect(result.cancellations[0].outcome).toBe("CANCELLED");
      expect(harness.trips).toHaveLength(1);
      expect(trip).toMatchObject({
        status: TripStatus.CANCELLED,
        originalPlanningDate: ORIGINAL_DAY,
        planningDate: MOVED_DAY,
      });
    });

    it.each([
      ["14. CLOSED: the UPDATE", { status: TripStatus.CLOSED }, update, "REFUSED_CLOSED"],
      ["15. a driver: the UPDATE", { driverId: DRIVER }, update, "REFUSED_DRIVER_ASSIGNED"],
      ["16. CLOSED: the CANCEL", { status: TripStatus.CLOSED }, cancel, "REFUSED_CLOSED"],
      ["17. a driver: the CANCEL", { driverId: DRIVER }, cancel, "REFUSED_DRIVER_ASSIGNED"],
    ] as const)("%s is ignored", async (_label, planning, apply, reason) => {
      const trip = await existingTrip({ ...planning, planningDate: MOVED_DAY });
      const before = { ...trip };

      const result = await apply();

      const outcome = result.revisions[0]?.action ?? result.cancellations[0]?.outcome;
      expect(outcome).toBe(reason);
      expect(trip).toEqual(before);
      expect(harness.trips).toHaveLength(1);
    });
  });

  describe("19. two Trips share the booking and the original date", () => {
    async function twoContainers() {
      const first = await existingTrip({ planningDate: MOVED_DAY });
      const second = { ...first, id: "trip-second", containerNumber: "TGHU7654321" };
      harness.trips.push(second);

      return [{ ...first }, { ...second }];
    }

    it("an UPDATE chooses neither and creates no third Trip", async () => {
      const before = await twoContainers();

      await expect(update()).rejects.toThrow(RevisionRefusedException);

      expect(harness.trips).toEqual(before);
    });

    it("a CANCEL chooses neither", async () => {
      const before = await twoContainers();

      const result = await cancel();

      expect(result.cancellations[0].outcome).toBe("AMBIGUOUS_BOOKING_MATCH");
      expect(harness.trips).toEqual(before);
    });
  });

  /* 22: an un-moved Trip still follows the document's date, as it always did. */
  it("22. keeps the existing date behaviour for a Trip nobody re-planned", async () => {
    const trip = await existingTrip();

    await update();

    expect(trip).toMatchObject({ originalPlanningDate: ORIGINAL_DAY, planningDate: ORIGINAL_DAY });
  });
});
