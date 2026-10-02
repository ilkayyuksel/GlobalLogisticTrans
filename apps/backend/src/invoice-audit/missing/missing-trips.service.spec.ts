import { Prisma, Trip, TripStatus } from "@prisma/client";

import { TripExportLabelsService } from "../../trip-export/trip-export-labels.service";
import { AppLoggerService } from "../../logger/app-logger.service";
import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import { EffectivePricingService } from "../../trip-pricing/effective-pricing.service";
import { TripRepository } from "../../trips/trip.repository";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { MissingTripsService } from "./missing-trips.service";

/**
 * Which finished transports the invoice forgot.
 *
 * ── WHAT DECIDES IT ─────────────────────────────────────────────────────────
 * CLOSED, unpaid, planned inside the days the document covers, and named on no
 * line of it. The first three are the database's answer; the fourth is the
 * document's, and it counts EVERY line — a line that found no Trip, one whose
 * Trip is unfinished and one that matched several all still name a transport,
 * and adding a row for it would invoice the same transport twice.
 */

const MONDAY = new Date("2026-03-23T00:00:00.000Z");
const FRIDAY = new Date("2026-03-27T00:00:00.000Z");
const PERIOD = { from: "2026-03-23", to: "2026-03-27" } as const;

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: MONDAY,
    startTime: new Date("1970-01-01T08:30:00.000Z"),
    bookingNumber: "BELANR2720016",
    containerNumber: "EUCU2451828",
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "MELSELE",
    direction: "DELIVERY",
    tripGroupId: null,
    distanceKm: new Prisma.Decimal("31.00"),
    ...overrides,
  } as Trip;
}

function row(overrides: Partial<InvoiceSheetRow> = {}): InvoiceSheetRow {
  return {
    rowNumber: 2,
    planningDate: "2026-03-23",
    bookingNumber: "BELANR2720016",
    containerNumber: "EUCU 2451828",
    normalizedContainerNumber: "EUCU2451828",
    amounts: {},
    ...overrides,
  };
}

function pricing(tarief: string): EffectivePricing {
  const amount = new Prisma.Decimal(tarief);

  return {
    components: [],
    tarief: amount,
    brandstof: new Prisma.Decimal("0"),
    backload: new Prisma.Decimal("0"),
    tol: new Prisma.Decimal("0"),
    tunnel: new Prisma.Decimal("0"),
    others: new Prisma.Decimal("0"),
    ek: new Prisma.Decimal("0"),
    totaal: amount,
  };
}

/** The export words: none unless a test supplies them. */
const exportLabels = { findForTrips: jest.fn(async () => new Map()) };

describe("MissingTripsService", () => {
  let trips: { findClosedUnpaidBetween: jest.Mock };
  let effectivePricing: { findForTrips: jest.Mock };
  let service: MissingTripsService;

  beforeEach(() => {
    trips = { findClosedUnpaidBetween: jest.fn().mockResolvedValue([]) };
    effectivePricing = { findForTrips: jest.fn().mockResolvedValue(new Map()) };

    service = new MissingTripsService(
      trips as unknown as TripRepository,
      effectivePricing as unknown as EffectivePricingService,
      exportLabels as unknown as TripExportLabelsService,
      {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as unknown as AppLoggerService,
    );
  });

  describe("what the database is asked", () => {
    it("asks for the days the invoice covers, as whole days in UTC", async () => {
      await service.find(PERIOD, [row()]);

      expect(trips.findClosedUnpaidBetween).toHaveBeenCalledWith({
        from: MONDAY,
        to: FRIDAY,
      });
    });

    it("asks nothing at all for a document with no line", async () => {
      const missing = await service.find(null, []);

      expect(missing).toEqual([]);
      expect(trips.findClosedUnpaidBetween).not.toHaveBeenCalled();
    });

    /**
     * CLOSED and unpaid are the query's own conditions, so a Trip that is OPEN,
     * CANCELLED, DELETED or already paid never reaches this service. The
     * repository's test holds that; this holds that nothing here loosens it.
     */
    it("adds no status or payment rule of its own", async () => {
      await service.find(PERIOD, []);

      expect(trips.findClosedUnpaidBetween).toHaveBeenCalledWith({
        from: MONDAY,
        to: FRIDAY,
      });
      expect(trips.findClosedUnpaidBetween.mock.calls[0][0]).not.toHaveProperty(
        "statuses",
      );
    });
  });

  describe("which candidates are missing", () => {
    it("reports a finished unpaid transport the invoice does not state", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([trip()]);

      const missing = await service.find(PERIOD, [
        row({ bookingNumber: "ANRDUB2725107", normalizedContainerNumber: "TLLU1595717" }),
      ]);

      expect(missing).toHaveLength(1);
      expect(missing[0].trip.id).toBe("trip-1");
    });

    it("reports every one of them", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip({ id: "a", bookingNumber: "A" }),
        trip({ id: "b", bookingNumber: "B" }),
        trip({ id: "c", bookingNumber: "C" }),
      ]);

      const missing = await service.find(PERIOD, []);

      expect(missing.map((entry) => entry.trip.id)).toEqual(["a", "b", "c"]);
    });

    it("leaves out a transport the invoice already states", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([trip()]);

      const missing = await service.find(PERIOD, [row()]);

      expect(missing).toEqual([]);
    });

    /** `EUCU 2451828` on the invoice and `EUCU2451828` here are one container. */
    it("compares the container in its normalised form", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip({ containerNumber: "EUCU 2451828" }),
      ]);

      const missing = await service.find(PERIOD, [
        row({ containerNumber: "EUCU2451828", normalizedContainerNumber: "EUCU2451828" }),
      ]);

      expect(missing).toEqual([]);
    });

    it("does not consider another day the same transport", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([trip()]);

      const missing = await service.find(PERIOD, [
        row({ planningDate: "2026-03-24" }),
      ]);

      expect(missing).toHaveLength(1);
    });

    it("does not consider another booking the same transport", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([trip()]);

      const missing = await service.find(PERIOD, [
        row({ bookingNumber: "ANRDUB2725107" }),
      ]);

      expect(missing).toHaveLength(1);
    });

    /** No fallback: two of the three values matching is not a match. */
    it("does not consider a line with another container the same transport", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([trip()]);

      const missing = await service.find(PERIOD, [
        row({ normalizedContainerNumber: "TLLU1595717" }),
      ]);

      expect(missing).toHaveLength(1);
    });
  });

  describe("lines the check could not resolve", () => {
    /**
     * ── A PROBLEM LINE STILL NAMES A TRANSPORT ──────────────────────────────
     * Whatever the check made of a line — no Trip, an unfinished one, several —
     * the invoice states that transport, and a second row for it would charge it
     * twice. The comparison is therefore against the document, not against the
     * check's verdicts.
     */
    it("adds nothing for a transport an unresolved line already names", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([trip()]);

      // The line the check reported as AMBIGUOUS: same three values.
      const missing = await service.find(PERIOD, [row()]);

      expect(missing).toEqual([]);
    });
  });

  describe("what it reports about each of them", () => {
    it("reads the pricing for all of them in one call", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip({ id: "a", bookingNumber: "A" }),
        trip({ id: "b", bookingNumber: "B" }),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          ["a", pricing("517.20")],
          ["b", pricing("211.09")],
        ]),
      );

      const missing = await service.find(PERIOD, []);

      expect(effectivePricing.findForTrips).toHaveBeenCalledTimes(1);
      expect(effectivePricing.findForTrips).toHaveBeenCalledWith(["a", "b"]);
      expect(missing[0].pricing?.tarief.toFixed(2)).toBe("517.20");
    });

    it("reports a Trip that was never priced without inventing amounts", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([trip()]);

      const missing = await service.find(PERIOD, []);

      expect(missing[0].pricing).toBeNull();
    });

    /** The route as the Trip domain itself derives it — direction included. */
    it("says the route the way the rest of the system says it", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip({ direction: "DELIVERY", terminal: "PSA Quay 869", destinationCity: "MELSELE" }),
      ]);

      const missing = await service.find(PERIOD, []);

      // The canonical terminal, and the direction deciding which end is first.
      expect(missing[0].route).toBe("Quay 869 -> MELSELE");
    });

    it("turns a collection round, as the Trip domain does", async () => {
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip({ direction: "COLLECTION", terminal: "Quay 869", destinationCity: "ANTWERPEN" }),
      ]);

      const missing = await service.find(PERIOD, []);

      expect(missing[0].route).toBe("ANTWERPEN -> Quay 869");
    });
  });
});
