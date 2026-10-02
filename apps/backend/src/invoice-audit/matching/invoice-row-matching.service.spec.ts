import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../../logger/app-logger.service";
import { TripRepository } from "../../trips/trip.repository";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { InvoiceRowMatchingService } from "./invoice-row-matching.service";

/**
 * Which Trip an invoice line is about.
 *
 * ── THE RULE THESE TESTS HOLD ───────────────────────────────────────────────
 * Three values and a status: the date (the Trip's planned OR original day,
 * exactly), the booking number, the normalised container number, and CLOSED.
 *
 * There is exactly one fallback, and it is narrow: when NO Trip holds the
 * invoice's container, the single Trip sharing its booking and day is matched
 * with its container corrected. The booking is never relaxed, and a line is
 * never matched on its container or its date alone — see the last block.
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

    /*
     * "Another container" no longer means "not found" on its own. When no Trip
     * holds the invoice's container, the sole Trip on that booking and day is
     * matched with its container corrected — see "a misprinted container"
     * below. What still never matches is a container with nothing else.
     */
    it("does not match a container on another booking", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({ bookingNumber: "ANRDUB2725107", containerNumber: "EUCU4581604" }),
      ]);

      const [match] = await service.match([row()]);

      expect(match.status).toBe("NOT_FOUND");
    });

    it("does not match a container on another day", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip({
          planningDate: new Date("2026-03-24T00:00:00.000Z"),
          originalPlanningDate: new Date("2026-03-25T00:00:00.000Z"),
        }),
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

      // The invoice's days, which a Trip may answer to by either of its dates.
      expect(query.invoiceDates).toEqual([
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

/*
 * ═════════════════════════════════════════════════════════════════════════════
 * THE REVISED MATCH: both dates, and a misprinted container.
 * ═════════════════════════════════════════════════════════════════════════════
 */
describe("InvoiceRowMatchingService — both dates and a misprinted container", () => {
  const ORDERED = new Date("2026-09-21T00:00:00.000Z");
  const PLANNED = new Date("2026-09-28T00:00:00.000Z");
  const RIGHT = "EUCU1234567";

  let trips: { findManyForInvoice: jest.Mock };
  let service: InvoiceRowMatchingService;

  beforeEach(() => {
    trips = { findManyForInvoice: jest.fn().mockResolvedValue([]) };
    service = new InvoiceRowMatchingService(
      trips as unknown as TripRepository,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as AppLoggerService,
    );
  });

  /** A Trip that was ordered for the 21st and carried out on the 28th. */
  function replanned(overrides: Partial<Trip> = {}): Trip {
    return trip({
      id: "trip-a",
      bookingNumber: "ABC123",
      containerNumber: RIGHT,
      planningDate: PLANNED,
      originalPlanningDate: ORDERED,
      ...overrides,
    });
  }

  function line(overrides: Partial<InvoiceSheetRow> = {}): InvoiceSheetRow {
    return row({
      planningDate: "2026-09-28",
      bookingNumber: "ABC123",
      containerNumber: "EUCU 1234567",
      normalizedContainerNumber: RIGHT,
      ...overrides,
    });
  }

  async function matchOne(rowOverrides: Partial<InvoiceSheetRow>, stored: Trip[]) {
    trips.findManyForInvoice.mockResolvedValue(stored);

    const [match] = await service.match([line(rowOverrides)]);

    return match;
  }

  const WRONG = {
    containerNumber: "EUCU 9999999",
    normalizedContainerNumber: "EUCU9999999",
  };

  describe("the date", () => {
    /** A — the invoice states the day the transport is planned on. */
    it("matches on the Trip's planning date", async () => {
      const match = await matchOne({ planningDate: "2026-09-28" }, [replanned()]);

      expect(match).toMatchObject({ status: "MATCHED", containerCorrection: null });
      expect(match.trip?.id).toBe("trip-a");
    });

    /** B — the invoice states the day the order was originally placed for. */
    it("matches on the Trip's original planning date", async () => {
      const match = await matchOne({ planningDate: "2026-09-21" }, [replanned()]);

      expect(match).toMatchObject({ status: "MATCHED", containerCorrection: null });
      expect(match.trip?.id).toBe("trip-a");
    });

    /** C — a day that is neither: no range, no nearest date. */
    it.each(["2026-09-20", "2026-09-22", "2026-09-27", "2026-09-29"])(
      "does not match a date that is neither of the two (%s)",
      async (planningDate) => {
        const match = await matchOne({ planningDate }, [replanned()]);

        expect(match).toMatchObject({ status: "NOT_FOUND", trip: null });
      },
    );

    it("asks the database for the invoice's days, to be met by either date", async () => {
      await matchOne({ planningDate: "2026-09-21" }, [replanned()]);

      expect(trips.findManyForInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceDates: [ORDERED] }),
      );
    });
  });

  describe("the exact container, on either date", () => {
    /** D — the exact container via the planning date. */
    it("matches the exact container through the planning date", async () => {
      const match = await matchOne({ planningDate: "2026-09-28" }, [
        replanned({ originalPlanningDate: new Date("2026-09-14T00:00:00.000Z") }),
      ]);

      expect(match).toMatchObject({ status: "MATCHED", containerCorrection: null });
    });

    /** E — the exact container via the original planning date. */
    it("matches the exact container through the original planning date", async () => {
      const match = await matchOne({ planningDate: "2026-09-21" }, [
        replanned({ planningDate: new Date("2026-10-05T00:00:00.000Z") }),
      ]);

      expect(match).toMatchObject({ status: "MATCHED", containerCorrection: null });
    });

    /** H — one Trip answering by BOTH dates is still one candidate. */
    it("counts a Trip answering by both dates once", async () => {
      const both = replanned({ planningDate: PLANNED, originalPlanningDate: PLANNED });
      // The same Trip twice in the result, as an OR query could return it.
      const match = await matchOne({}, [both, both]);

      expect(match.status).toBe("MATCHED");
      expect(match.candidates).toHaveLength(1);
    });

    it("counts a Trip once in the fallback too", async () => {
      const both = replanned({ planningDate: PLANNED, originalPlanningDate: PLANNED });
      const match = await matchOne(WRONG, [both, both]);

      expect(match.status).toBe("MATCHED");
      expect(match.candidates).toHaveLength(1);
    });

    /**
     * I — an exact container match wins, even beside another Trip on the same
     * booking and day. That other Trip would make the FALLBACK ambiguous; it
     * must not take away a match the container already decided.
     */
    it("prefers the exact container over another Trip on the booking and day", async () => {
      const match = await matchOne({}, [
        replanned(),
        replanned({ id: "trip-b", containerNumber: "TLLU1595717" }),
      ]);

      expect(match).toMatchObject({ status: "MATCHED", containerCorrection: null });
      expect(match.trip?.id).toBe("trip-a");
    });

    it("prefers the exact container even when the other Trip answers by the other date", async () => {
      const match = await matchOne({}, [
        replanned(),
        replanned({
          id: "trip-b",
          containerNumber: "TLLU1595717",
          planningDate: new Date("2026-10-05T00:00:00.000Z"),
          originalPlanningDate: PLANNED,
        }),
      ]);

      expect(match.trip?.id).toBe("trip-a");
    });

    it("still reports two CLOSED Trips holding the container as AMBIGUOUS", async () => {
      const match = await matchOne({}, [
        replanned(),
        replanned({ id: "trip-b", planningDate: ORDERED, originalPlanningDate: PLANNED }),
      ]);

      expect(match).toMatchObject({ status: "AMBIGUOUS", trip: null });
      expect(match.candidates).toHaveLength(2);
    });

    /**
     * An OPEN Trip holding the exact container is the transport the invoice
     * named, unfinished. It must NOT fall through to the fallback, where it
     * could be settled against a different, closed Trip.
     */
    it("reports an OPEN Trip holding the container as NOT_FINISHED, never falling back", async () => {
      const match = await matchOne({}, [
        replanned({ status: TripStatus.OPEN }),
        replanned({ id: "trip-b", containerNumber: "TLLU1595717" }),
      ]);

      expect(match).toMatchObject({
        status: "NOT_FINISHED",
        trip: null,
        containerCorrection: null,
      });
    });
  });

  describe("a misprinted container", () => {
    /** F — one Trip on the booking and day: matched, container corrected. */
    it("matches the sole Trip on the booking and day and corrects the container", async () => {
      const match = await matchOne(WRONG, [replanned({ containerNumber: "EUCU1111111" })]);

      expect(match).toMatchObject({
        status: "MATCHED",
        containerCorrection: {
          invoiceContainerNumber: "EUCU 9999999",
          tripContainerNumber: "EUCU1111111",
        },
      });
      expect(match.trip?.id).toBe("trip-a");
    });

    it("corrects through the original planning date too", async () => {
      const match = await matchOne({ ...WRONG, planningDate: "2026-09-21" }, [
        replanned({ containerNumber: "EUCU1111111" }),
      ]);

      expect(match.status).toBe("MATCHED");
      expect(match.containerCorrection?.tripContainerNumber).toBe("EUCU1111111");
    });

    /**
     * G — two Trips, one through each date. Over BOTH dates together they are
     * two candidates, so nothing is chosen and nothing is corrected.
     */
    it("reports two Trips across the two dates as AMBIGUOUS, correcting nothing", async () => {
      const match = await matchOne(WRONG, [
        replanned({ containerNumber: "EUCU1111111" }),
        replanned({
          id: "trip-b",
          containerNumber: "EUCU2222222",
          planningDate: new Date("2026-10-05T00:00:00.000Z"),
          originalPlanningDate: PLANNED,
        }),
      ]);

      expect(match).toMatchObject({
        status: "AMBIGUOUS",
        trip: null,
        containerCorrection: null,
      });
      expect(match.candidates.map((candidate) => candidate.id).sort()).toEqual([
        "trip-a",
        "trip-b",
      ]);
    });

    /**
     * Not only CLOSED Trips are counted. With the container gone nothing says
     * which transport the line is, and settling the closed one because the
     * other "cannot be invoiced yet" would pay on a guess.
     */
    it.each([TripStatus.OPEN, TripStatus.CANCELLED])(
      "reports a CLOSED Trip beside a %s one as AMBIGUOUS",
      async (status) => {
        const match = await matchOne(WRONG, [
          replanned({ containerNumber: "EUCU1111111" }),
          replanned({ id: "trip-b", containerNumber: "EUCU2222222", status }),
        ]);

        expect(match).toMatchObject({ status: "AMBIGUOUS", containerCorrection: null });
      },
    );

    it("reports a sole OPEN Trip as NOT_FINISHED, uncorrected", async () => {
      const match = await matchOne(WRONG, [
        replanned({ containerNumber: "EUCU1111111", status: TripStatus.OPEN }),
      ]);

      expect(match).toMatchObject({
        status: "NOT_FINISHED",
        trip: null,
        containerCorrection: null,
      });
    });

    /** No container to correct TO: the customer's own value is never blanked. */
    it("leaves a sole CLOSED Trip without a container NOT_FOUND", async () => {
      const match = await matchOne(WRONG, [replanned({ containerNumber: null })]);

      expect(match).toMatchObject({
        status: "NOT_FOUND",
        trip: null,
        containerCorrection: null,
      });
    });

    it("never matches on the container without the booking", async () => {
      const match = await matchOne({ bookingNumber: "XYZ999" }, [replanned()]);

      expect(match.status).toBe("NOT_FOUND");
    });

    it("never matches on the booking without the date", async () => {
      const match = await matchOne({ ...WRONG, planningDate: "2026-09-30" }, [
        replanned({ containerNumber: "EUCU1111111" }),
      ]);

      expect(match.status).toBe("NOT_FOUND");
    });
  });

  describe("a line this system added", () => {
    /** ADDED_MISSING keeps working, and its own container is never rewritten. */
    it("stays ADDED_MISSING and is never container-corrected", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        replanned({ containerNumber: "EUCU1111111" }),
      ]);

      const [match] = await service.match(
        [line({ rowNumber: 9, ...WRONG })],
        new Map([
          [
            9,
            {
              rowNumber: 9,
              tripId: "trip-a",
              planningDate: "2026-09-28",
              bookingNumber: "ABC123",
              normalizedContainerNumber: "EUCU9999999",
            },
          ],
        ]),
      );

      expect(match).toMatchObject({ status: "ADDED_MISSING", containerCorrection: null });
    });

    /** A customer's own line with a corrected container is not one of ours. */
    it("leaves a corrected customer line an ordinary MATCHED line", async () => {
      const match = await matchOne({ rowNumber: 4, ...WRONG }, [
        replanned({ containerNumber: "EUCU1111111" }),
      ]);

      expect(match.status).toBe("MATCHED");
      expect(match.containerCorrection).not.toBeNull();
    });
  });
});
