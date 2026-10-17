import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { type CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import { reliablyPriced } from "./__fixtures__/invoice-pricing";
import { InvoiceAuditService } from "./invoice-audit.service";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";

/**
 * The corrected document, and the preview that comes with it.
 *
 * ── THE TWO RULES THIS FILE EXISTS FOR ──────────────────────────────────────
 * Producing the file changes NOTHING in this system — nothing is paid, no Trip
 * is touched — and its preview says which transports a separate confirmation
 * may settle: a line of the customer's own document that matched one CLOSED
 * Trip and whose pricing was reconciled, and nothing else.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));

const COLUMN = {
  bookingNumber: 5,
  tarief: 12,
  fuel: 13,
} as const;

function pricing(overrides: Record<string, string> = {}): CurrentTripPricing {
  const amount = (key: string) => new Prisma.Decimal(overrides[key] ?? "0");

  return reliablyPriced({
    components: [],
    tarief: amount("tarief"),
    brandstof: amount("brandstof"),
    backload: amount("backload"),
    tol: amount("tol"),
    tunnel: amount("tunnel"),
    others: amount("others"),
    ek: amount("ek"),
    totaal: amount("totaal"),
  });
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

    service = buildInvoiceAuditService({
      trips,
      effectivePricing,
      logger,
      writer,
    });
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

  /** The Trips the preview offers for payment. */
  const payableIds = (applied: { result: { payments: { tripId: string; payable: boolean }[] } }) =>
    applied.result.payments.filter((payment) => payment.payable).map((payment) => payment.tripId);

  /**
   * ── THE CORRECTED FILE PAYS NOTHING ──────────────────────────────────────
   * Producing the document is not a decision about money; the operator
   * confirms payment separately (`payment/invoice-payment.service.spec.ts`).
   * What the preview does say is which transports that confirmation may settle.
   */
  describe("which transports the preview offers for payment", () => {
    it("offers a line whose price was already right", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37" })]]),
      );

      const { applied } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(payableIds(applied)).toEqual(["trip-1"]);
      expect(applied.result.payments[0].category).toBe("UNCHANGED");
      expect(applied.result.rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
    });

    /** A wrong price is a reason to correct the invoice, not to leave it unpaid. */
    it("offers a line whose price it had to correct", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "425", brandstof: "42.50" })]]),
      );

      const { applied, sheet } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(payableIds(applied)).toEqual(["trip-1"]);
      expect(applied.result.payments[0].category).toBe("RAISED");
      expect(sheet.getRow(2).getCell(COLUMN.tarief).value).toBe(425);
    });

    it.each([
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
    ])("offers nothing for a %s line", async (status, candidates, prices) => {
      trips.findManyForInvoice.mockResolvedValue(candidates);
      effectivePricing.findForTrips.mockResolvedValue(new Map(Object.entries(prices)));

      const { applied } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(applied.result.rows[0].status).toBe(status);
      expect(payableIds(applied)).toEqual([]);
    });

    /**
     * A difference no cell may carry is a question for the customer, so the
     * transport is not settled on it either.
     */
    it("offers nothing for a line whose difference could not be placed", async () => {
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
      expect(applied.result.payments[0]).toMatchObject({
        payable: false,
        reasons: expect.arrayContaining(["PRICE_NOT_SETTLED", "LINE_MARKED"]),
      });
    });

    /** One transport charged on two lines is one entry, with both rows. */
    it("lists a transport once however many lines charge it", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37", ek: "200" })]]),
      );

      const { applied } = await apply(
        await buildInvoiceWorkbook({
          lines: [
            line("DUBANR2718284", "EUCU 4581604", { ek: 200 }),
            line("DUBANR2718284", "EUCU 4581604", { tarief: null, fuel: null }),
          ],
        }),
      );

      expect(applied.result.payments).toHaveLength(1);
      expect(applied.result.payments[0]).toMatchObject({ payable: true, rowNumbers: [2, 3] });
    });

    it("shows a transport already paid as re-invoiced", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604", { isPaid: true }),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37" })]]),
      );

      const { applied } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );

      expect(applied.result.payments[0]).toMatchObject({ payable: true, alreadyPaid: true });
    });
  });

  /** B1 — producing the corrected document writes nothing to this system. */
  describe("what the corrected file changes in this system", () => {
    it("pays nothing and touches no Trip", async () => {
      const write = jest.fn();

      Object.assign(trips, { update: write, create: write, setPaid: write, delete: write });
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip("missing-1", "BELANR2720016", "EUCU2451828"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          ["trip-1", pricing({ tarief: "425", brandstof: "42.50" })],
          ["missing-1", pricing({ tarief: "517.20", brandstof: "51.72" })],
        ]),
      );

      const { applied, sheet } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );
      const addedRow = applied.result.missingTrips[0].rowNumber!;

      expect(applied.rowsAdded).toBe(1);
      expect(sheet.getRow(addedRow).getCell(COLUMN.bookingNumber).value).toBe("BELANR2720016");
      expect(trips.setPaidMany).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });

    it("answers nothing when the document cannot be produced", async () => {
      jest.spyOn(writer, "apply").mockImplementation(() => {
        throw new Error("the workbook could not be written");
      });

      const file = await buildInvoiceWorkbook({
        lines: [line("DUBANR2718284", "EUCU 4581604")],
      });

      await expect(
        service.apply({ buffer: file, originalname: "week.xlsx", size: file.length }),
      ).rejects.toThrow("the workbook could not be written");
    });
  });

  /** The lines as received, and as the corrected file states them. */
  describe("the totals before and after", () => {
    it("adds up the raised amounts and the added lines", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      trips.findClosedUnpaidBetween.mockResolvedValue([
        trip("missing-1", "BELANR2720016", "EUCU2451828"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          ["trip-1", pricing({ tarief: "425", brandstof: "37" })],
          ["missing-1", pricing({ tarief: "100", brandstof: "10" })],
        ]),
      );

      const { applied } = await apply(
        await buildInvoiceWorkbook({ lines: [line("DUBANR2718284", "EUCU 4581604")] }),
      );
      const tarief = applied.result.totals.columns.find((column) => column.column === "Tarief");

      expect(tarief).toEqual({ column: "Tarief", before: "370.00", after: "525.00" });
      expect(applied.result.totals).toMatchObject({ before: "407.00", after: "572.00" });
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
      const addedRow = applied.result.missingTrips[0].rowNumber!;

      expect(sheet.getRow(addedRow).getCell(COLUMN.bookingNumber).value).toBe(
        "BELANR2720016",
      );
      // No fill: ExcelJS reads a styled cell without one back as pattern "none".
      expect((fillOf(sheet, addedRow) as ExcelJS.FillPattern | undefined)?.pattern ?? "none").toBe("none");
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
