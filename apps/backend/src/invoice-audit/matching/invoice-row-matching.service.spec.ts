import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../../logger/app-logger.service";
import { TripRepository } from "../../trips/trip.repository";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { InvoiceRowMatchingService } from "./invoice-row-matching.service";

/**
 * Which Trip an invoice line is about.
 *
 * ── THE RULE THESE TESTS HOLD ───────────────────────────────────────────────
 * Three values and a status: the planning date, the booking number, the
 * normalised container number, and CLOSED. Every test here that fails a match
 * fails it on exactly one of those, because the rule has no fallback — a line
 * that misses on one value misses, and nothing looser is tried.
 *
 * The ambiguous case is the one that matters most: two CLOSED Trips with one
 * identity must produce no Trip at all. Picking either would later mark the
 * wrong transport paid, and there is no honest way to choose.
 */

const PLANNING_DATE = "2026-03-23";
const BOOKING = "DUBANR2718284";

function row(overrides: Partial<InvoiceSheetRow> = {}): InvoiceSheetRow {
  return {
    rowNumber: 2,
    planningDate: PLANNING_DATE,
    bookingNumber: BOOKING,
    containerNumber: "EUCU 4581604",
    normalizedContainerNumber: "EUCU4581604",
    // Matching reads none of them; the pricing check has its own suite.
    amounts: {},
    ...overrides,
  };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.CLOSED,
    planningDate: new Date("2026-03-23T00:00:00.000Z"),
    bookingNumber: BOOKING,
    // As this system stores it: no space, which is the whole reason the
    // comparison normalises.
    containerNumber: "EUCU4581604",
    ...overrides,
  } as Trip;
}

describe("InvoiceRowMatchingService", () => {
  let trips: { findManyForInvoice: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: InvoiceRowMatchingService;

  beforeEach(() => {
    trips = { findManyForInvoice: jest.fn().mockResolvedValue([]) };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new InvoiceRowMatchingService(
      trips as unknown as TripRepository,
      logger as unknown as AppLoggerService,
    );
  });

  describe("an exact match", () => {
    it("matches on the three values and CLOSED", async () => {
      trips.findManyForInvoice.mockResolvedValue([trip()]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("MATCHED");
      expect(match.trip?.id).toBe("trip-1");
    });

    it("matches a container the sheet spells with spaces", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ containerNumber: "EUCU4581604" }),
      ]);

      const [match] = await service.match([
        row({ containerNumber: "EUCU 4581604", normalizedContainerNumber: "EUCU4581604" }),
      ]);

      expect(match.status).toBe("MATCHED");
    });

    /** And the other way round: a Trip whose container was typed with spaces. */
    it("matches a stored container spelled with spaces", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ containerNumber: "EUCU 4581604" }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("MATCHED");
    });
  });

  describe("what does not match", () => {
    it("does not match another day", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ planningDate: new Date("2026-03-24T00:00:00.000Z") }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("NOT_FOUND");
      expect(match.trip).toBeNull();
    });

    it("does not match another booking", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ bookingNumber: "ANRDUB2725107" }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("NOT_FOUND");
    });

    it("does not match another container", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ containerNumber: "TLLU1595717" }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("NOT_FOUND");
    });

    it("reports a line nothing at all answers as NOT_FOUND", async () => {
      const [match] = await service.match([row()]);

      expect(match.status).toBe("NOT_FOUND");
      expect(match.candidates).toEqual([]);
    });
  });

  describe("a Trip that is not finished", () => {
    it("reports an OPEN Trip as NOT_FINISHED rather than as a match", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ status: TripStatus.OPEN }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("NOT_FINISHED");
      expect(match.trip).toBeNull();
      expect(match.candidates).toHaveLength(1);
    });

    it("reports a CANCELLED Trip as NOT_FINISHED", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ status: TripStatus.CANCELLED }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("NOT_FINISHED");
    });

    /** One CLOSED Trip answers even when an unfinished one shares its identity. */
    it("prefers the CLOSED Trip when both exist", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ id: "open-1", status: TripStatus.OPEN }),
        trip({ id: "closed-1" }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("MATCHED");
      expect(match.trip?.id).toBe("closed-1");
    });

    it("never asks the database for a DELETED Trip", async () => {
      await service.match([row()]);

      expect(trips.findManyForInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          statuses: [TripStatus.OPEN, TripStatus.CLOSED, TripStatus.CANCELLED],
        }),
      );
    });
  });

  describe("more than one CLOSED Trip", () => {
    it("reports AMBIGUOUS and chooses neither", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ id: "closed-1" }),
        trip({ id: "closed-2" }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("AMBIGUOUS");
      expect(match.trip).toBeNull();
      expect(match.candidates.map((candidate) => candidate.id)).toEqual([
        "closed-1",
        "closed-2",
      ]);
    });
  });

  describe("lines sharing one key", () => {
    /**
     * A weekly invoice prints one line per Cost Confirmation under the booking
     * and container of a transport that already has a line. Both lines stay,
     * both match the same Trip, and each records the other so the pricing phase
     * can add their amounts up rather than compare each against the whole.
     */
    it("keeps both rows and records the shared key", async () => {
      trips.findManyForInvoice.mockResolvedValue([trip()]);

      const matches = await service.match([
        row({ rowNumber: 8 }),
        row({ rowNumber: 9 }),
      ]);

      expect(matches).toHaveLength(2);
      expect(matches.map((match) => match.row.rowNumber)).toEqual([8, 9]);
      expect(matches[0].sharedKeyRowNumbers).toEqual([9]);
      expect(matches[1].sharedKeyRowNumbers).toEqual([8]);
      expect(matches.every((match) => match.status === "MATCHED")).toBe(true);
    });

    it("leaves a line with a key of its own unshared", async () => {
      trips.findManyForInvoice.mockResolvedValue([trip()]);

      const matches = await service.match([
        row({ rowNumber: 2 }),
        row({ rowNumber: 3, bookingNumber: "ANRDUB2725107" }),
      ]);

      expect(matches[0].sharedKeyRowNumbers).toEqual([]);
      expect(matches[1].sharedKeyRowNumbers).toEqual([]);
    });
  });

  describe("how the database is asked", () => {
    /**
     * ── ONE QUERY, WHATEVER THE INVOICE'S LENGTH ────────────────────────────
     * A weekly invoice is about a hundred lines. Asking per line would be a
     * hundred round trips for one answer, so this is the test that keeps the
     * batch a batch.
     */
    it("asks once for a hundred lines", async () => {
      const rows = Array.from({ length: 100 }, (_value, index) =>
        row({
          rowNumber: index + 2,
          bookingNumber: `ANRDUB${2725000 + index}`,
          normalizedContainerNumber: `EUCU${4581000 + index}`,
        }),
      );

      await service.match(rows);

      expect(trips.findManyForInvoice).toHaveBeenCalledTimes(1);
    });

    it("sends each day and each booking once", async () => {
      await service.match([
        row({ rowNumber: 2 }),
        row({ rowNumber: 3 }),
        row({ rowNumber: 4, planningDate: "2026-03-24", bookingNumber: "ANRDUB2725107" }),
      ]);

      const [query] = trips.findManyForInvoice.mock.calls[0];

      expect(query.planningDates).toEqual([
        new Date("2026-03-23T00:00:00.000Z"),
        new Date("2026-03-24T00:00:00.000Z"),
      ]);
      expect(query.bookingNumbers).toEqual([BOOKING, "ANRDUB2725107"]);
    });

    it("asks nothing when the sheet holds no line", async () => {
      const matches = await service.match([]);

      expect(matches).toEqual([]);
      expect(trips.findManyForInvoice).toHaveBeenCalledTimes(1);
    });
  });
});
