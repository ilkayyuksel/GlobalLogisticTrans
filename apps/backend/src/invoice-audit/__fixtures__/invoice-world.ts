import ExcelJS from "exceljs";
import { Prisma, RouteMatchMethod, type Trip, TripStatus } from "@prisma/client";

import type { AppLoggerService } from "../../logger/app-logger.service";
import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import { buildInvoiceAuditService } from "./invoice-audit-service";
import { reliablyPriced } from "./invoice-pricing";
import { invoiceReads } from "./invoice-reads";
import { tripRecord } from "./invoice-rows";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./invoice-workbook";

/**
 * A database of Trips and Cost Confirmations that every read FILTERS, so an
 * invoice line can only find what a real query would return — and the whole
 * check run over it, the corrected workbook read back from its bytes.
 *
 * Every Trip is reliably priced at Tarief 200, Fuel 30.
 */
export interface InvoiceWorld {
  readonly trips: Trip[];
  readonly confirmations: { tripId: string; ccNumber: string; amount: Prisma.Decimal }[];
  /** A Trip's stored EK, when not zero. */
  readonly ekOf: Map<string, string>;
  /** Trips whose stored price cannot be relied on: no route was found. */
  readonly unreliable: Set<string>;
  check(lines: readonly InvoiceFixtureLine[]): Promise<CheckedInvoice>;
  /** The check run over a workbook as it is — a corrected one, checked again. */
  checkFile(file: Buffer): Promise<CheckedInvoice>;
}

export interface CheckedInvoice {
  result: Awaited<ReturnType<ReturnType<typeof buildInvoiceAuditService>["apply"]>>["result"];
  cell: (row: number, column: number) => ExcelJS.Cell;
  receivedUnchanged: boolean;
  /** The corrected workbook's bytes. */
  written: Buffer;
}

export const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export function aTrip(id: string, booking: string, container: string | null, date: string, overrides: Partial<Trip> = {}): Trip {
  return tripRecord({
    id,
    bookingNumber: booking,
    containerNumber: container,
    planningDate: day(date),
    originalPlanningDate: day(date),
    startTime: null,
    ...overrides,
  });
}

const SILENT = { setContext: () => undefined, log: () => undefined, warn: () => undefined, error: () => undefined };

export function invoiceWorld(): InvoiceWorld {
  const trips: Trip[] = [];
  const confirmations: InvoiceWorld["confirmations"] = [];
  const ekOf = new Map<string, string>();
  const unreliable = new Set<string>();
  const onDay = (trip: Trip, days: readonly Date[]) =>
    days.some((each) => [trip.planningDate, trip.originalPlanningDate].some((date) => date?.getTime() === each.getTime()));

  function service() {
    const reads = invoiceReads();
    const zero = new Prisma.Decimal(0);
    const priced = (tripId: string): CurrentTripPricing => {
      const ek = new Prisma.Decimal(ekOf.get(tripId) ?? 0);
      const pricing = reliablyPriced({
        components: [],
        tarief: new Prisma.Decimal(200),
        brandstof: new Prisma.Decimal(30),
        backload: zero,
        tol: zero,
        tunnel: zero,
        others: zero,
        ek,
        totaal: new Prisma.Decimal(230).add(ek),
      });

      return unreliable.has(tripId)
        ? { ...pricing, routeMatch: { ...pricing.routeMatch, method: RouteMatchMethod.NOT_FOUND, routePricingId: null } }
        : pricing;
    };

    reads.findTripsOnDates.mockImplementation(async (days) => trips.filter((trip) => onDay(trip, days)));
    reads.findTripsByBookings.mockImplementation(async (bookings) =>
      trips.filter((trip) => bookings.includes(trip.bookingNumber!)),
    );
    reads.findTripsByIds.mockImplementation(async (ids) => trips.filter((trip) => ids.includes(trip.id)));
    reads.findCostConfirmationsByNumbers.mockImplementation(async (numbers) =>
      confirmations.filter((confirmation) => numbers.includes(confirmation.ccNumber)),
    );
    reads.findCostConfirmationNumbers.mockImplementation(
      async (ids) =>
        new Map(ids.map((id) => [id, confirmations.filter((each) => each.tripId === id).map((each) => each.ccNumber)])),
    );

    return buildInvoiceAuditService({
      logger: SILENT as unknown as AppLoggerService,
      reads,
      trips: {
        findManyForInvoice: async (query: { invoiceDates: Date[]; bookingNumbers: string[]; statuses: TripStatus[] }) =>
          trips.filter(
            (trip) =>
              query.statuses.includes(trip.status) &&
              query.bookingNumbers.includes(trip.bookingNumber!) &&
              onDay(trip, query.invoiceDates),
          ),
        findClosedUnpaidBetween: async ({ from, to }: { from: Date; to: Date }) =>
          trips.filter(
            (trip) => trip.status === TripStatus.CLOSED && !trip.isPaid && trip.planningDate! >= from && trip.planningDate! <= to,
          ),
      },
      effectivePricing: {
        findForTrips: async (ids: readonly string[]) => new Map(ids.map((id) => [id, priced(id)])),
      },
    });
  }

  async function checkFile(received: Buffer): Promise<CheckedInvoice> {
    const copy = Buffer.from(received);
    const applied = await service().apply({ buffer: received, originalname: "week 41 - 2026 GLT.xlsx", size: received.length });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    return {
      result: applied.result,
      cell: (row, column) => book.worksheets[0].getRow(row).getCell(column),
      receivedUnchanged: received.equals(copy),
      written: applied.workbook as Buffer,
    };
  }

  return {
    trips,
    confirmations,
    ekOf,
    unreliable,
    checkFile,
    async check(lines) {
      return checkFile(await buildInvoiceWorkbook({ lines, fuelPercentage: 15 }));
    },
  };
}
