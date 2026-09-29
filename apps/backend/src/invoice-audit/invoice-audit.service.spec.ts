import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripRepository } from "../trips/trip.repository";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { InvalidInvoiceFileException } from "./exceptions/invoice-audit.exceptions";
import { InvoiceAuditService } from "./invoice-audit.service";
import { InvoiceRowMatchingService } from "./matching/invoice-row-matching.service";
import { MissingTripsService } from "./missing/missing-trips.service";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";

/**
 * The check, from an uploaded file to the answer a screen shows.
 *
 * The reader and the matcher have their own suites; what is proved here is the
 * service's own three jobs — refusing what is not a workbook, deriving the
 * period from the LINES rather than from the file name, and counting the
 * answers — and the promise that binds the phase: nothing is written.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));
const FRIDAY = new Date(Date.UTC(2026, 2, 27));

function line(overrides: Record<string, unknown> = {}) {
  return {
    planningDate: MONDAY,
    bookingNumber: "DUBANR2718284",
    containerNumber: "EUCU 4581604",
    tarief: 135,
    ...overrides,
  };
}

function uploaded(buffer: Buffer, originalname = "week 13 - 2026 GLT.xlsx") {
  return { buffer, originalname, size: buffer.length };
}

describe("InvoiceAuditService", () => {
  let trips: {
    findManyForInvoice: jest.Mock;
    findClosedUnpaidBetween: jest.Mock;
    setPaidMany: jest.Mock;
  };
  let effectivePricing: { findForTrips: jest.Mock };
  let logger: AppLoggerService;
  let service: InvoiceAuditService;

  beforeEach(() => {
    trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      setPaidMany: jest.fn().mockResolvedValue(0),
    };
    // No Trip has been priced unless a test says so; the pricing check has its
    // own suite.
    effectivePricing = { findForTrips: jest.fn().mockResolvedValue(new Map()) };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    service = new InvoiceAuditService(
      new InvoiceSheetReader(logger),
      new InvoiceRowMatchingService(trips as unknown as TripRepository, logger),
      new InvoicePricingService(
        effectivePricing as unknown as EffectivePricingService,
        logger,
      ),
      new MissingTripsService(
        trips as unknown as TripRepository,
        effectivePricing as unknown as EffectivePricingService,
        logger,
      ),
      new InvoiceSheetWriter(logger),
      trips as unknown as TripRepository,
      logger,
    );
  });

  describe("what it accepts", () => {
    it("checks a valid workbook", async () => {
      const file = await buildInvoiceWorkbook({ lines: [line()] });

      const result = await service.check(uploaded(file));

      expect(result.fileName).toBe("week 13 - 2026 GLT.xlsx");
      expect(result.summary.totalRows).toBe(1);
    });

    it("refuses a request with no file", async () => {
      await expect(service.check(undefined)).rejects.toBeInstanceOf(
        InvalidInvoiceFileException,
      );
    });

    it("refuses a file that is not named .xlsx", async () => {
      const file = await buildInvoiceWorkbook({ lines: [line()] });

      await expect(
        service.check(uploaded(file, "week 13.pdf")),
      ).rejects.toThrow(/only \.xlsx/);
    });

    /**
     * On the CONTENT, not the name: a renamed PDF announcing itself as a
     * workbook is refused here rather than inside the reader, where the reason
     * would be far less clear. The same rule the PDF upload applies in reverse.
     */
    it("refuses a file whose bytes are not a workbook", async () => {
      await expect(
        service.check(uploaded(Buffer.from("%PDF-1.7 not a workbook"), "week.xlsx")),
      ).rejects.toThrow(/not an Excel workbook/);
    });

    it("refuses an empty upload", async () => {
      await expect(
        service.check(uploaded(Buffer.alloc(0), "week 13.xlsx")),
      ).rejects.toBeInstanceOf(InvalidInvoiceFileException);
    });

    /** A name is a name, never a path. */
    it("keeps only the base name of the uploaded file", async () => {
      const file = await buildInvoiceWorkbook({ lines: [line()] });

      const result = await service.check(
        uploaded(file, "../../etc/week 13 - 2026 GLT.xlsx"),
      );

      expect(result.fileName).toBe("week 13 - 2026 GLT.xlsx");
    });
  });

  describe("the period", () => {
    it("comes from the lines, not from the file name", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [
          line({ planningDate: FRIDAY }),
          line({ planningDate: MONDAY, bookingNumber: "ANRDUB2725107" }),
        ],
      });

      const result = await service.check(uploaded(file, "week 99 - 1999 GLT.xlsx"));

      expect(result.period).toEqual({ from: "2026-03-23", to: "2026-03-27" });
    });

    it("is null when the sheet holds no line", async () => {
      const file = await buildInvoiceWorkbook({ lines: [] });

      const result = await service.check(uploaded(file));

      expect(result.period).toBeNull();
      expect(result.summary.totalRows).toBe(0);
    });
  });

  describe("what it answers", () => {
    it("counts each status", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        {
          id: "trip-1",
          status: TripStatus.CLOSED,
          planningDate: MONDAY,
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU4581604",
        },
        {
          id: "trip-2",
          status: TripStatus.OPEN,
          planningDate: MONDAY,
          bookingNumber: "ANRDUB2725107",
          containerNumber: "TLLU1595717",
        },
      ]);

      const file = await buildInvoiceWorkbook({
        lines: [
          line(),
          line({ bookingNumber: "ANRDUB2725107", containerNumber: "TLLU 1595717" }),
          line({ bookingNumber: "ANRBEL2642387", containerNumber: "PVDU 1131710" }),
        ],
      });

      const result = await service.check(uploaded(file));

      expect(result.summary).toMatchObject({
        totalRows: 3,
        matched: 1,
        notFound: 1,
        notFinished: 1,
        ambiguous: 0,
      });
    });

    it("says which Trip a matched line was matched to", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        {
          id: "3f1b0d2e-0000-4000-8000-000000000001",
          status: TripStatus.CLOSED,
          planningDate: MONDAY,
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU4581604",
        },
      ]);
      const file = await buildInvoiceWorkbook({ lines: [line()] });

      const [row] = (await service.check(uploaded(file))).rows;

      expect(row).toMatchObject({
        rowNumber: 2,
        status: "MATCHED",
        planningDate: "2026-03-23",
        bookingNumber: "DUBANR2718284",
        // The sheet's own spelling, and the one the match used.
        containerNumber: "EUCU 4581604",
        normalizedContainerNumber: "EUCU4581604",
        trip: {
          id: "3f1b0d2e-0000-4000-8000-000000000001",
          status: "CLOSED",
          planningDate: "2026-03-23",
          containerNumber: "EUCU4581604",
        },
      });
    });

    it("reports rows that state too little to be a line", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [line()],
        incompleteLines: [[null, "GLT", null, null, "ANRDUB2725107"]],
      });

      const result = await service.check(uploaded(file));

      expect(result.summary.totalRows).toBe(1);
      expect(result.incompleteRowNumbers).toEqual([3]);
    });
  });

  describe("what this phase does NOT do", () => {
    /**
     * The promise of the phase, held by a test rather than by a comment: the
     * repository this service reaches offers writes, and none of them is called.
     */
    it("writes nothing at all", async () => {
      const write = jest.fn();

      Object.assign(trips, {
        create: write,
        update: write,
        setPaid: write,
        delete: write,
      });

      const file = await buildInvoiceWorkbook({ lines: [line(), line()] });

      await service.check(uploaded(file));

      expect(write).not.toHaveBeenCalled();
    });

    it("leaves the uploaded bytes untouched", async () => {
      const file = await buildInvoiceWorkbook({ lines: [line()] });
      const before = Buffer.from(file);

      await service.check(uploaded(file));

      expect(file.equals(before)).toBe(true);
    });
  });
});
