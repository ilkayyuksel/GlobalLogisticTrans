import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";

import { TripExportLabelsService } from "../trip-export/trip-export-labels.service";
import { AppLoggerService } from "../logger/app-logger.service";
import type { EffectivePricing } from "../trip-pricing/effective-pricing";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripRepository } from "../trips/trip.repository";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { InvoiceAuditService } from "./invoice-audit.service";
import { InvoiceRowMatchingService } from "./matching/invoice-row-matching.service";
import { MissingTripsService } from "./missing/missing-trips.service";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";

/**
 * The final processing: the corrected document, and the payments it settles.
 *
 * ── THE TWO RULES THIS FILE EXISTS FOR ──────────────────────────────────────
 * WHICH transports are paid — a line of the customer's own document that
 * matched one CLOSED Trip and whose pricing was reconciled, and nothing else —
 * and WHEN: only after the whole file has been produced, so a document this
 * system cannot write settles nothing.
 *
 * The transports ADDED below the invoice are the case worth stating twice: they
 * are written into the file and deliberately left unpaid, because they were not
 * on the document the customer sent.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));

const COLUMN = {
  bookingNumber: 5,
  tarief: 12,
  fuel: 13,
} as const;

function pricing(overrides: Record<string, string> = {}): EffectivePricing {
  const amount = (key: string) => new Prisma.Decimal(overrides[key] ?? "0");

  return {
    components: [],
    tarief: amount("tarief"),
    brandstof: amount("brandstof"),
    backload: amount("backload"),
    tol: amount("tol"),
    tunnel: amount("tunnel"),
    others: amount("others"),
    ek: amount("ek"),
    totaal: amount("totaal"),
  };
}

function trip(
  id: string,
  bookingNumber: string,
  containerNumber: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: MONDAY,
    startTime: new Date("1970-01-01T08:30:00.000Z"),
    bookingNumber,
    containerNumber,
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "ZEMST",
    direction: "DELIVERY",
    tripGroupId: null,
    distanceKm: new Prisma.Decimal("58.00"),
    ...overrides,
  };
}

function line(bookingNumber: string, containerNumber: string, amounts: Record<string, unknown> = {}) {
  return {
    planningDate: MONDAY,
    bookingNumber,
    containerNumber,
    tarief: 370,
    fuel: 37,
    ...amounts,
  };
}

/** The export words: none unless a test supplies them. */
const exportLabels = { findForTrips: jest.fn(async () => new Map()) };

describe("processing a weekly invoice", () => {
  let trips: {
    findManyForInvoice: jest.Mock;
    findClosedUnpaidBetween: jest.Mock;
    setPaidMany: jest.Mock;
  };
  let effectivePricing: { findForTrips: jest.Mock };
  let writer: InvoiceSheetWriter;
  let service: InvoiceAuditService;

  beforeEach(() => {
    trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      setPaidMany: jest.fn(async (ids: readonly string[]) => ids.length),
    };
    effectivePricing = { findForTrips: jest.fn().mockResolvedValue(new Map()) };

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    writer = new InvoiceSheetWriter(logger);

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
        exportLabels as unknown as TripExportLabelsService,
        logger,
      ),
      writer,
      trips as unknown as TripRepository,
      logger,
    );
  });

  async function apply(file: Buffer) {
    const applied = await service.apply({
      buffer: file,
      originalname: "week 13 - 2026 GLT.xlsx",
      size: file.length,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    return { applied, sheet: workbook.worksheets[0] };
  }

  /** The ids this run marked paid. */
  const paidIds = () =>
    (trips.setPaidMany.mock.calls[0]?.[0] ?? []) as readonly string[];

  describe("which transports it settles", () => {
    it("pays a line whose price was already right", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37" })]]),
      );

      const { applied } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(paidIds()).toEqual(["trip-1"]);
      expect(applied.paidTrips).toBe(1);
      expect(applied.result.rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
    });

    /** A wrong price is a reason to correct the invoice, not to leave it unpaid. */
    it("pays a line whose price it had to correct", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "425", brandstof: "42.50" })]]),
      );

      const { applied, sheet } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(paidIds()).toEqual(["trip-1"]);
      expect(applied.result.rows[0].pricingStatus).toBe("PRICING_CORRECTED");
      // And the document really was corrected before anything was paid.
      expect(sheet.getRow(2).getCell(COLUMN.tarief).value).toBe(425);
    });

    it.each([
      [
        "NOT_FOUND",
        [] as unknown[],
        {},
      ],
      [
        "NOT_FINISHED",
        [trip("open-1", "DUBANR2718284", "EUCU4581604", { status: TripStatus.OPEN })],
        { "open-1": pricing({ tarief: "370" }) },
      ],
      [
        "AMBIGUOUS",
        [
          trip("closed-a", "DUBANR2718284", "EUCU4581604"),
          trip("closed-b", "DUBANR2718284", "EUCU4581604"),
        ],
        { "closed-a": pricing({ tarief: "370" }), "closed-b": pricing({ tarief: "370" }) },
      ],
    ])("pays nothing for a %s line", async (status, candidates, prices) => {
      trips.findManyForInvoice.mockResolvedValue(candidates);
      effectivePricing.findForTrips.mockResolvedValue(new Map(Object.entries(prices)));

      const { applied } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(applied.result.rows[0].status).toBe(status);
      expect(applied.paidTrips).toBe(0);
      expect(paidIds()).toEqual([]);
    });

    /**
     * A difference no cell may carry is a question for the customer, so the
     * transport is not settled on it either.
     */
    it("pays nothing for a line whose difference could not be placed", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37", ek: "250" })]]),
      );

      const { applied } = await apply(
        await buildInvoiceWorkbook({
          lines: [
            line("DUBANR2718284", "EUCU 4581604", { ek: 120 }),
            line("DUBANR2718284", "EUCU 4581604", { tarief: null, fuel: null, ek: 80 }),
          ],
        }),
      );

      expect(applied.result.rows[0].pricingStatus).toBe("NOT_DISTRIBUTABLE");
      expect(applied.paidTrips).toBe(0);
    });

    it("pays nothing for a row that states too little to be a line", async () => {
      const { applied } = await apply(
        await buildInvoiceWorkbook({
          lines: [],
          incompleteLines: [[null, "GLT", null, null, "ANRDUB2725107"]],
        }),
      );

      expect(applied.result.incompleteRowNumbers).toEqual([2]);
      expect(applied.paidTrips).toBe(0);
    });

    /** One transport charged on two lines is settled once. */
    it("pays a transport once however many lines charge it", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37", ek: "200" })]]),
      );

      await apply(
        await buildInvoiceWorkbook({
          lines: [
            line("DUBANR2718284", "EUCU 4581604", { ek: 200 }),
            line("DUBANR2718284", "EUCU 4581604", { tarief: null, fuel: null }),
          ],
        }),
      );

      expect(paidIds()).toEqual(["trip-1"]);
    });
  });

  describe("the transports it adds", () => {
    /**
     * ── ADDED, AND DELIBERATELY UNPAID ──────────────────────────────────────
     * They were not on the invoice the customer sent, so nothing has been paid
     * for them. They are written into the file so the next invoice is complete.
     */
    it("adds a missing transport without settling it", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip("missing-1", "BELANR2720016", "EUCU2451828"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          ["trip-1", pricing({ tarief: "370", brandstof: "37" })],
          ["missing-1", pricing({ tarief: "517.20", brandstof: "51.72" })],
        ]),
      );

      const { applied, sheet } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(applied.rowsAdded).toBe(1);
      // Where the report says it went — below the summary block.
      const addedRow = applied.result.missingTrips[0].rowNumber;
      expect(sheet.getRow(addedRow).getCell(COLUMN.bookingNumber).value).toBe(
        "BELANR2720016",
      );
      // Only the invoice's own transport is settled.
      expect(paidIds()).toEqual(["trip-1"]);
      expect(paidIds()).not.toContain("missing-1");
    });
  });

  describe("running it twice", () => {
    it("counts a transport that was already paid rather than paying it again", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604", { isPaid: true }),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37" })]]),
      );

      const { applied } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(applied.alreadyPaid).toBe(1);
      expect(applied.paidTrips).toBe(0);
      expect(paidIds()).toEqual([]);
    });
  });

  describe("the order of the work", () => {
    /**
     * ── THE FILE FIRST, ALWAYS ──────────────────────────────────────────────
     * A document this system cannot produce must settle nothing: an operator
     * can retry that. Paying first and then failing would leave a week marked
     * paid with nothing to send.
     */
    it("settles nothing when the document cannot be produced", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37" })]]),
      );
      jest.spyOn(writer, "apply").mockImplementation(() => {
        throw new Error("the workbook could not be written");
      });

      const file = await buildInvoiceWorkbook({
        lines: [line("DUBANR2718284", "EUCU 4581604")],
      });

      await expect(
        service.apply({ buffer: file, originalname: "week.xlsx", size: file.length }),
      ).rejects.toThrow("the workbook could not be written");

      expect(trips.setPaidMany).not.toHaveBeenCalled();
    });

    it("reports no success when the payment fails", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37" })]]),
      );
      trips.setPaidMany.mockRejectedValue(new Error("the database is gone"));

      const file = await buildInvoiceWorkbook({
        lines: [line("DUBANR2718284", "EUCU 4581604")],
      });

      await expect(
        service.apply({ buffer: file, originalname: "week.xlsx", size: file.length }),
      ).rejects.toThrow("the database is gone");
    });

    it("writes one statement for the whole invoice", async () => {
      trips.findManyForInvoice.mockResolvedValue(
        Array.from({ length: 20 }, (_value, index) =>
          trip(`trip-${index}`, `ANRDUB${2725000 + index}`, `EUCU${4581000 + index}`),
        ),
      );
      effectivePricing.findForTrips.mockResolvedValue(
        new Map(
          Array.from({ length: 20 }, (_value, index) => [
            `trip-${index}`,
            pricing({ tarief: "370", brandstof: "37" }),
          ]),
        ),
      );

      await apply(
        await buildInvoiceWorkbook({
          lines: Array.from({ length: 20 }, (_value, index) =>
            line(`ANRDUB${2725000 + index}`, `EUCU ${4581000 + index}`),
          ),
        }),
      );

      expect(trips.setPaidMany).toHaveBeenCalledTimes(1);
      expect(paidIds()).toHaveLength(20);
    });

    /** Payment writes one column. Nothing else on a Trip is reachable from here. */
    it("touches nothing on a Trip but its payment", async () => {
      const write = jest.fn();

      Object.assign(trips, {
        update: write,
        create: write,
        setPaid: write,
        delete: write,
      });
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "425", brandstof: "42.50" })]]),
      );

      await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(write).not.toHaveBeenCalled();
      expect(trips.setPaidMany).toHaveBeenCalledWith(["trip-1"]);
    });
  });

  describe("the lines nobody could resolve", () => {
    async function aWeekWithAProblem() {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip("missing-1", "BELANR2720016", "EUCU2451828"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          ["trip-1", pricing({ tarief: "370", brandstof: "37" })],
          ["missing-1", pricing({ tarief: "517.20", brandstof: "51.72" })],
        ]),
      );

      return apply(
        await buildInvoiceWorkbook({
          lines: [
            line("DUBANR2718284", "EUCU 4581604"),
            line("ANRBEL9999999", "PVDU 9999999"),
          ],
        }),
      );
    }

    const fillOf = (sheet: ExcelJS.Worksheet, rowNumber: number) =>
      sheet.getRow(rowNumber).getCell(COLUMN.bookingNumber).fill;

    it("marks them yellow", async () => {
      const { sheet, applied } = await aWeekWithAProblem();

      expect(applied.rowsMarked).toBe(1);
      expect(fillOf(sheet, 3)).toMatchObject({
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFF00" },
      });
    });

    it("leaves a line it resolved unmarked", async () => {
      const { sheet } = await aWeekWithAProblem();

      expect(fillOf(sheet, 2)).toBeUndefined();
    });

    it("does not mark the transports it added", async () => {
      const { sheet, applied } = await aWeekWithAProblem();
      const addedRow = applied.result.missingTrips[0].rowNumber;

      expect(sheet.getRow(addedRow).getCell(COLUMN.bookingNumber).value).toBe(
        "BELANR2720016",
      );
      expect(fillOf(sheet, addedRow)).toBeUndefined();
    });

    /** A colour, and nothing else: the customer's own figures stay theirs. */
    it("changes nothing a marked line states", async () => {
      const { sheet } = await aWeekWithAProblem();

      expect(sheet.getRow(3).getCell(COLUMN.tarief).value).toBe(370);
      expect(sheet.getRow(3).getCell(COLUMN.fuel).value).toBe(37);
      expect(sheet.getRow(3).getCell(COLUMN.bookingNumber).value).toBe(
        "ANRBEL9999999",
      );
    });
  });
});
