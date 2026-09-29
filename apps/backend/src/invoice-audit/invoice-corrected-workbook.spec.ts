import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";

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
 * The corrected workbook, read back out of the bytes that were produced.
 *
 * ── WHY THE FILE ITSELF IS THE ASSERTION ────────────────────────────────────
 * Everything this phase promises is a property of the document: the right cells
 * changed, nothing else did, the formulas are still formulas, the euro formats
 * and the hidden columns survived, and no row moved. None of that can be proved
 * by inspecting the service's own result — so every test here writes a real
 * workbook, reads it back with ExcelJS, and looks at the cells.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));

/** Which column holds what, as the customer's sheet orders them. */
const COLUMN = {
  planningDate: 1,
  bookingNumber: 5,
  containerNumber: 6,
  tarief: 12,
  fuel: 13,
  backload: 14,
  maut: 15,
  tolB: 16,
  tolFr: 17,
  tunnel: 18,
  others: 19,
  ek: 20,
} as const;

const MONEY_FORMAT = '_-"€"* #,##0.00_-;-"€"* #,##0.00_-;_-"€"* "-"??_-;_-@_-';

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
  status: TripStatus = TripStatus.CLOSED,
) {
  return {
    id,
    status,
    planningDate: MONDAY,
    bookingNumber,
    containerNumber,
  };
}

/** What a cell holds, as a plain number, whatever shape it is in. */
function amountAt(sheet: ExcelJS.Worksheet, rowNumber: number, column: number) {
  const value = sheet.getRow(rowNumber).getCell(column).value;

  if (value !== null && typeof value === "object" && "result" in value) {
    return (value as { result: unknown }).result;
  }

  return value;
}

function formulaAt(sheet: ExcelJS.Worksheet, rowNumber: number, column: number) {
  const value = sheet.getRow(rowNumber).getCell(column).value;

  return value !== null && typeof value === "object" && "formula" in value
    ? (value as { formula: string }).formula
    : null;
}

describe("the corrected weekly invoice", () => {
  let trips: {
    findManyForInvoice: jest.Mock;
    findClosedUnpaidBetween: jest.Mock;
    setPaidMany: jest.Mock;
  };
  let effectivePricing: { findForTrips: jest.Mock };
  let service: InvoiceAuditService;
  let logger: AppLoggerService;

  beforeEach(() => {
    trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      setPaidMany: jest.fn().mockResolvedValue(0),
    };
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

  /** Reads the corrected workbook this service produces for `file`. */
  async function correct(file: Buffer) {
    const result = await service.apply({
      buffer: file,
      originalname: "week 13 - 2026 GLT.xlsx",
      size: file.length,
    });

    const workbook = new ExcelJS.Workbook();
    // Read back from the BYTES, so nothing in-memory can flatter the result.
    await workbook.xlsx.load(result.workbook as unknown as ArrayBuffer);

    return { result, workbook, sheet: workbook.worksheets[0] };
  }

  describe("a week with something wrong in every column", () => {
    /**
     * One transport, charged wrongly in every component the check compares, and
     * a second that is already correct.
     */
    async function aWeekToCorrect() {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
        trip("trip-2", "ANRDUB2725107", "TLLU1595717"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          [
            "trip-1",
            pricing({
              tarief: "370",
              brandstof: "37.00",
              backload: "50",
              tol: "63.84",
              tunnel: "36.36",
              others: "84",
              ek: "137.50",
            }),
          ],
          ["trip-2", pricing({ tarief: "149", brandstof: "14.90" })],
        ]),
      );

      return buildInvoiceWorkbook({
        lines: [
          {
            planningDate: MONDAY,
            bookingNumber: "DUBANR2718284",
            containerNumber: "EUCU 4581604",
            tarief: 364,
            fuel: "formula",
            backload: null,
            tolB: 21.83,
            tunnel: 18.18,
            others: 14,
            ek: 55,
          },
          {
            planningDate: MONDAY,
            bookingNumber: "ANRDUB2725107",
            containerNumber: "TLLU 1595717",
            tarief: 149,
            fuel: 14.9,
          },
        ],
      });
    }

    it("writes every corrected amount into its own cell", async () => {
      const { sheet } = await correct(await aWeekToCorrect());

      expect(amountAt(sheet, 2, COLUMN.tarief)).toBe(370);
      expect(amountAt(sheet, 2, COLUMN.backload)).toBe(50);
      expect(amountAt(sheet, 2, COLUMN.tolB)).toBe(63.84);
      expect(amountAt(sheet, 2, COLUMN.tunnel)).toBe(36.36);
      expect(amountAt(sheet, 2, COLUMN.others)).toBe(84);
      expect(amountAt(sheet, 2, COLUMN.ek)).toBe(137.5);
    });

    /** The Fuel cell is a formula, and stays one. */
    it("keeps the Fuel formula and refreshes what it produced", async () => {
      const { sheet } = await correct(await aWeekToCorrect());

      expect(formulaAt(sheet, 2, COLUMN.fuel)).toBe("10%*L2");
      expect(amountAt(sheet, 2, COLUMN.fuel)).toBe(37);
    });

    it("never writes into Maut or Tol FR", async () => {
      const { sheet } = await correct(await aWeekToCorrect());

      expect(amountAt(sheet, 2, COLUMN.maut)).toBeNull();
      expect(amountAt(sheet, 2, COLUMN.tolFr)).toBeNull();
    });

    it("leaves a line that already agrees exactly as it was", async () => {
      const { sheet, result } = await correct(await aWeekToCorrect());

      expect(amountAt(sheet, 3, COLUMN.tarief)).toBe(149);
      expect(amountAt(sheet, 3, COLUMN.fuel)).toBe(14.9);
      expect(result.result.rows[1].pricingStatus).toBe("MATCHED_NO_CHANGES");
    });

    it("reports what it changed, from and to", async () => {
      const { result } = await correct(await aWeekToCorrect());

      const row = result.result.rows[0];

      expect(row.pricingStatus).toBe("PRICING_CORRECTED");
      expect(
        row.differences.map((difference) => [
          difference.component,
          difference.invoiceValue,
          difference.correctedValue,
        ]),
      ).toEqual([
        ["Tarief", "364.00", "370.00"],
        ["Fuel", "36.40", "37.00"],
        ["Backload", null, "50.00"],
        ["Tol", "21.83", "63.84"],
        ["Tunnel", "18.18", "36.36"],
        ["Others", "14.00", "84.00"],
        ["EK", "55.00", "137.50"],
      ]);
      expect(result.result.summary).toMatchObject({
        priceChecked: 2,
        priceUnchanged: 1,
        priceCorrected: 1,
        priceNotDistributable: 0,
        correctedCells: 7,
      });
    });
  });

  describe("what the document keeps", () => {
    async function aCorrectedWeek() {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37.00" })]]),
      );

      return correct(
        await buildInvoiceWorkbook({
          lines: [
            {
              planningDate: MONDAY,
              bookingNumber: "DUBANR2718284",
              containerNumber: "EUCU 4581604",
              tarief: 364,
              fuel: "formula",
            },
            {
              planningDate: MONDAY,
              bookingNumber: "ANRDUB2725107",
              containerNumber: "TLLU 1595717",
              tarief: 149,
              fuel: 14.9,
            },
          ],
        }),
      );
    }

    it("keeps the headers", async () => {
      const { sheet } = await aCorrectedWeek();

      expect(sheet.getRow(1).getCell(1).value).toBe("Planning date");
      expect(sheet.getRow(1).getCell(13).value).toBe("Fuel 10%");
      expect(sheet.getRow(1).getCell(21).value).toBe("Remarks");
    });

    it("adds and removes no row", async () => {
      const { sheet } = await aCorrectedWeek();

      // Two lines, the totals row, a blank line and ten summary rows.
      expect(sheet.rowCount).toBe(15);
      expect(sheet.getRow(2).getCell(COLUMN.bookingNumber).value).toBe("DUBANR2718284");
      expect(sheet.getRow(3).getCell(COLUMN.bookingNumber).value).toBe("ANRDUB2725107");
    });

    it("keeps the euro format on a corrected cell", async () => {
      const { sheet } = await aCorrectedWeek();

      expect(sheet.getRow(2).getCell(COLUMN.tarief).numFmt).toBe(MONEY_FORMAT);
    });

    it("keeps Maut and Tol FR hidden", async () => {
      const { sheet } = await aCorrectedWeek();

      expect(sheet.getColumn(COLUMN.maut).hidden).toBe(true);
      expect(sheet.getColumn(COLUMN.tolFr).hidden).toBe(true);
    });

    /** The totals stay formulas; only what they last produced is refreshed. */
    it("keeps the totals row a row of formulas, in its place", async () => {
      const { sheet } = await aCorrectedWeek();

      expect(formulaAt(sheet, 4, COLUMN.tarief)).toBe("SUM(L2:L3)");
      expect(amountAt(sheet, 4, COLUMN.tarief)).toBe(519); // 370 + 149
      expect(formulaAt(sheet, 4, COLUMN.fuel)).toBe("SUM(M2:M3)");
      expect(amountAt(sheet, 4, COLUMN.fuel)).toBe(51.9); // 37.00 + 14.90
    });

    it("refreshes the summary block, which points at the totals", async () => {
      const { sheet } = await aCorrectedWeek();

      expect(formulaAt(sheet, 6, 12)).toBe("L4");
      expect(amountAt(sheet, 6, 12)).toBe(519);
    });

    /*
     * ── WHERE THIS IS PROVED ────────────────────────────────────────────────
     * `fullCalcOnLoad` is written into the workbook's XML but ExcelJS does not
     * read it back into `calcProperties`, so asserting it here would prove
     * nothing about the file. The writer's own test holds it, on the workbook
     * object it was set on.
     */
    it("leaves no stale figure behind for a reader that does not recalculate", async () => {
      const { sheet } = await aCorrectedWeek();

      // The corrected Tarief, the formula's refreshed result and the total all
      // agree, with no recalculation involved.
      expect(amountAt(sheet, 2, COLUMN.tarief)).toBe(370);
      expect(amountAt(sheet, 2, COLUMN.fuel)).toBe(37);
      expect(amountAt(sheet, 4, COLUMN.tarief)).toBe(519);
    });

    it("is a workbook that reads back", async () => {
      const { sheet } = await aCorrectedWeek();

      expect(sheet.name).toBe("Sheet1");
      expect(sheet.getRow(2).getCell(COLUMN.planningDate).value).toBeInstanceOf(Date);
    });
  });

  describe("lines this phase must not touch", () => {
    /**
     * ── ONLY A MATCHED LINE MAY CHANGE ──────────────────────────────────────
     * A line with no CLOSED Trip, one whose Trip is unfinished and one that
     * matched several are all left exactly as the customer wrote them — even
     * where this system holds a completely different figure.
     */
    async function aWeekOfProblems() {
      trips.findManyForInvoice.mockResolvedValue([
        // NOT_FINISHED: the three values match, the Trip is still open.
        trip("open-1", "ANRDUB2725107", "TLLU1595717", TripStatus.OPEN),
        // AMBIGUOUS: two closed Trips with one identity.
        trip("closed-a", "ANRCRK2643680", "EUCU2451936"),
        trip("closed-b", "ANRCRK2643680", "EUCU2451936"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          ["open-1", pricing({ tarief: "999" })],
          ["closed-a", pricing({ tarief: "999" })],
          ["closed-b", pricing({ tarief: "999" })],
        ]),
      );

      return correct(
        await buildInvoiceWorkbook({
          lines: [
            {
              planningDate: MONDAY,
              bookingNumber: "ANRBEL9999999",
              containerNumber: "PVDU 9999999",
              tarief: 210,
              tolB: 12,
            },
            {
              planningDate: MONDAY,
              bookingNumber: "ANRDUB2725107",
              containerNumber: "TLLU 1595717",
              tarief: 149,
            },
            {
              planningDate: MONDAY,
              bookingNumber: "ANRCRK2643680",
              containerNumber: "EUCU 2451936",
              tarief: 180,
            },
          ],
        }),
      );
    }

    it.each([
      ["NOT_FOUND", 2, 210],
      ["NOT_FINISHED", 3, 149],
      ["AMBIGUOUS", 4, 180],
    ])("leaves a %s line untouched", async (status, rowNumber, tarief) => {
      const { sheet, result } = await aWeekOfProblems();

      expect(
        result.result.rows.find((row) => row.rowNumber === rowNumber)?.status,
      ).toBe(status);
      expect(amountAt(sheet, rowNumber, COLUMN.tarief)).toBe(tarief);
    });

    it("compares none of them", async () => {
      const { result } = await aWeekOfProblems();

      expect(result.result.summary).toMatchObject({
        priceChecked: 0,
        priceCorrected: 0,
        correctedCells: 0,
      });
      expect(
        result.result.rows.every((row) => row.pricingStatus === "NOT_COMPARED"),
      ).toBe(true);
    });

    it("writes nothing at all into the workbook", async () => {
      const { sheet } = await aWeekOfProblems();

      /*
       * The totals row is untouched: still the formula it was saved with, and
       * still without a recomputed result — which is what a workbook whose
       * cells never changed looks like. (ExcelJS does not persist a cached
       * result of 0, so its absence here is the file as it was written.)
       */
      expect(formulaAt(sheet, 5, COLUMN.tarief)).toBe("SUM(L2:L4)");
      expect(amountAt(sheet, 5, COLUMN.tarief)).toMatchObject({
        formula: "SUM(L2:L4)",
      });
    });
  });

  describe("an EK stated on two rows", () => {
    async function aWeekWithTwoConfirmations(expectedEk: string) {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "135", brandstof: "13.50", ek: expectedEk })]]),
      );

      return correct(
        await buildInvoiceWorkbook({
          lines: [
            {
              planningDate: MONDAY,
              bookingNumber: "DUBANR2718284",
              containerNumber: "EUCU 4581604",
              tarief: 135,
              fuel: 13.5,
            },
            {
              planningDate: MONDAY,
              bookingNumber: "DUBANR2718284",
              containerNumber: "EUCU 4581604",
              ek: 120,
              remarks: "EC 3631683",
            },
            {
              planningDate: MONDAY,
              bookingNumber: "DUBANR2718284",
              containerNumber: "EUCU 4581604",
              ek: 80,
              remarks: "EC 3640867",
            },
          ],
        }),
      );
    }

    it("agrees when the two add up to what this system holds", async () => {
      const { result, sheet } = await aWeekWithTwoConfirmations("200");

      expect(
        result.result.rows.every(
          (row) => row.pricingStatus === "MATCHED_NO_CHANGES",
        ),
      ).toBe(true);
      expect(amountAt(sheet, 3, COLUMN.ek)).toBe(120);
      expect(amountAt(sheet, 4, COLUMN.ek)).toBe(80);
    });

    it("reports a differing total and changes neither cell", async () => {
      const { result, sheet } = await aWeekWithTwoConfirmations("250");

      expect(result.result.rows[0].pricingStatus).toBe("NOT_DISTRIBUTABLE");
      expect(result.result.summary.priceNotDistributable).toBe(1);
      expect(result.result.summary.correctedCells).toBe(0);
      // Both EK cells keep exactly what the customer stated.
      expect(amountAt(sheet, 3, COLUMN.ek)).toBe(120);
      expect(amountAt(sheet, 4, COLUMN.ek)).toBe(80);
    });
  });

  /**
   * ── THE SHAPE THE REAL INVOICES ARE WRITTEN IN ────────────────────────────
   * Excel writes a column of identical formulas once and lets the cells below
   * borrow it. The customer's weekly invoice is full of them — one week holds 11
   * such masters and 94 borrowers — and writing an amount into a master leaves
   * the borrowers pointing at nothing: ExcelJS then refuses to write the
   * workbook at all, with "Shared Formula master must exist above and or left of
   * clone".
   *
   * It was a real 500 against the real document, and these tests are what keep
   * it fixed.
   */
  describe("a Fuel column written as a shared formula", () => {
    async function aWeekWithBorrowedFormulas(brandstof: string) {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
        trip("trip-2", "ANRDUB2725107", "TLLU1595717"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([
          ["trip-1", pricing({ tarief: "370", brandstof })],
          ["trip-2", pricing({ tarief: "149", brandstof: "14.90" })],
        ]),
      );

      return correct(
        await buildInvoiceWorkbook({
          sharedFuelFormula: true,
          lines: [
            {
              planningDate: MONDAY,
              bookingNumber: "DUBANR2718284",
              containerNumber: "EUCU 4581604",
              tarief: 364,
              fuel: "formula",
            },
            {
              planningDate: MONDAY,
              bookingNumber: "ANRDUB2725107",
              containerNumber: "TLLU 1595717",
              tarief: 149,
              fuel: "formula",
            },
          ],
        }),
      );
    }

    /** The case that failed: the master is replaced by an amount. */
    it("writes a workbook that reads back when the master is overwritten", async () => {
      // 12% on our side, which the sheet's own 10% formula cannot produce.
      const { sheet } = await aWeekWithBorrowedFormulas("44.40");

      expect(amountAt(sheet, 2, COLUMN.fuel)).toBe(44.4);
      // The borrower kept a working formula of its own, translated to its row.
      expect(formulaAt(sheet, 3, COLUMN.fuel)).toBe("10%*L3");
      expect(amountAt(sheet, 3, COLUMN.fuel)).toBe(14.9);
    });

    it("keeps the master a formula when it still produces the right amount", async () => {
      const { sheet } = await aWeekWithBorrowedFormulas("37.00");

      expect(formulaAt(sheet, 2, COLUMN.fuel)).toBe("10%*L2");
      expect(amountAt(sheet, 2, COLUMN.fuel)).toBe(37);
      expect(formulaAt(sheet, 3, COLUMN.fuel)).toBe("10%*L3");
    });

    /** A column of shared formulas nothing corrects keeps its own shape. */
    it("releases nothing when no master is written to", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370", brandstof: "37.00" })]]),
      );

      const { sheet } = await correct(
        await buildInvoiceWorkbook({
          sharedFuelFormula: true,
          lines: [
            {
              planningDate: MONDAY,
              bookingNumber: "DUBANR2718284",
              containerNumber: "EUCU 4581604",
              tarief: 364,
              fuel: "formula",
            },
          ],
        }),
      );

      expect(amountAt(sheet, 2, COLUMN.tarief)).toBe(370);
      expect(formulaAt(sheet, 2, COLUMN.fuel)).toBe("10%*L2");
    });
  });

  /**
   * ── THE TRANSPORTS THE INVOICE FORGOT ─────────────────────────────────────
   * A finished, unpaid transport of the same week that the document does not
   * mention is written underneath it: past the totals row and the summary
   * block, after one blank line. Nothing existing moves — these workbooks carry
   * shared formulas and ExcelJS cannot insert a row through them — and the
   * totals grow to cover what was added.
   */
  describe("adding a transport the invoice forgot", () => {
    /** A CLOSED, unpaid Trip of the same week, priced. */
    function missingTrip(overrides: Record<string, unknown> = {}) {
      return {
        id: "missing-1",
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
      };
    }

    /** One line the invoice states, and whatever is missing beside it. */
    async function aWeekMissing(
      missing: readonly Record<string, unknown>[],
      pricingByTrip: Record<string, ReturnType<typeof pricing>>,
      options: { sharedFuelFormula?: boolean } = {},
    ) {
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      trips.findClosedUnpaidBetween.mockResolvedValue(missing);
      effectivePricing.findForTrips.mockImplementation((ids: readonly string[]) =>
        Promise.resolve(
          new Map(
            ids
              .filter((id) => pricingByTrip[id] !== undefined)
              .map((id) => [id, pricingByTrip[id]]),
          ),
        ),
      );

      return correct(
        await buildInvoiceWorkbook({
          ...options,
          lines: [
            {
              planningDate: MONDAY,
              bookingNumber: "DUBANR2718284",
              containerNumber: "EUCU 4581604",
              tarief: 135,
              fuel: options.sharedFuelFormula ? "formula" : 13.5,
              tolB: 12,
            },
          ],
        }),
      );
    }

    const FULL_PRICING = pricing({
      tarief: "517.20",
      brandstof: "51.72",
      backload: "0",
      tol: "24.98",
      tunnel: "18.18",
      others: "14",
      ek: "55",
      totaal: "681.08",
    });

    it("writes it below the summary block, not among the invoice's own lines", async () => {
      const { sheet, result } = await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
        "missing-1": FULL_PRICING,
      });

      // One line on row 2, the totals on 3, ten summary rows through 14; the
      // added line therefore lands on 16, after one blank row.
      expect(result.result.missingTrips).toHaveLength(1);
      expect(result.result.missingTrips[0].rowNumber).toBe(16);
      expect(sheet.getRow(16).getCell(COLUMN.bookingNumber).value).toBe(
        "BELANR2720016",
      );
      // And the document's own line is exactly where it was.
      expect(sheet.getRow(2).getCell(COLUMN.bookingNumber).value).toBe(
        "DUBANR2718284",
      );
    });

    it("fills the line with what this system holds", async () => {
      const { sheet } = await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
        "missing-1": FULL_PRICING,
      });

      const row = sheet.getRow(16);

      expect(row.getCell(COLUMN.planningDate).value).toBeInstanceOf(Date);
      expect(row.getCell(2).value).toBe("GLT"); // the document's own Supplier
      expect(row.getCell(3).value).toBe("08:30"); // Time (requested)
      expect(row.getCell(4).value).toBe("45PH");
      expect(row.getCell(COLUMN.containerNumber).value).toBe("EUCU2451828");
      expect(row.getCell(8).value).toBe("Quay 869 -> MELSELE"); // Trip
      expect(row.getCell(9).value).toBe(31); // Distance
      expect(amountAt(sheet, 16, COLUMN.tarief)).toBe(517.2);
      expect(amountAt(sheet, 16, COLUMN.fuel)).toBe(51.72);
      expect(amountAt(sheet, 16, COLUMN.tolB)).toBe(24.98);
      expect(amountAt(sheet, 16, COLUMN.tunnel)).toBe(18.18);
      expect(amountAt(sheet, 16, COLUMN.others)).toBe(14);
      expect(amountAt(sheet, 16, COLUMN.ek)).toBe(55);
    });

    /** The toll convention of phase 3, unchanged: Tol B, and nothing else. */
    it("writes the toll into Tol B and leaves Maut and Tol FR empty", async () => {
      const { sheet } = await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
        "missing-1": FULL_PRICING,
      });

      expect(amountAt(sheet, 16, COLUMN.maut)).toBeNull();
      expect(amountAt(sheet, 16, COLUMN.tolFr)).toBeNull();
    });

    /**
     * A grouped transport carries its own Combination surcharge, and whether its
     * partner is on the invoice is not consulted.
     */
    it("writes the Combination surcharge of a grouped transport", async () => {
      const { sheet } = await aWeekMissing(
        [missingTrip({ tripGroupId: "group-1" })],
        {
          "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
          "missing-1": pricing({ tarief: "210", brandstof: "21", backload: "50" }),
        },
      );

      expect(amountAt(sheet, 16, COLUMN.backload)).toBe(50);
    });

    it("adds every missing transport, in the order it was given", async () => {
      const { sheet, result } = await aWeekMissing(
        [
          missingTrip({ id: "missing-1", bookingNumber: "BELANR2720016" }),
          missingTrip({ id: "missing-2", bookingNumber: "ANRDUB2727180" }),
        ],
        {
          "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
          "missing-1": FULL_PRICING,
          "missing-2": pricing({ tarief: "211.09", brandstof: "21.11" }),
        },
      );

      expect(result.result.summary.missingTrips).toBe(2);
      expect(sheet.getRow(16).getCell(COLUMN.bookingNumber).value).toBe(
        "BELANR2720016",
      );
      expect(sheet.getRow(17).getCell(COLUMN.bookingNumber).value).toBe(
        "ANRDUB2727180",
      );
    });

    it("grows the totals to cover them, still as formulas", async () => {
      const { sheet } = await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
        "missing-1": FULL_PRICING,
      });

      expect(formulaAt(sheet, 3, COLUMN.tarief)).toBe("SUM(L2:L2,L16:L16)");
      // 135 from the invoice's own line, 517.20 from the added one.
      expect(amountAt(sheet, 3, COLUMN.tarief)).toBe(652.2);
      expect(formulaAt(sheet, 3, COLUMN.ek)).toBe("SUM(T2:T2,T16:T16)");
      expect(amountAt(sheet, 3, COLUMN.ek)).toBe(55);
    });

    it("keeps the summary block pointing at the grown totals", async () => {
      const { sheet } = await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
        "missing-1": FULL_PRICING,
      });

      expect(formulaAt(sheet, 5, 12)).toBe("L3");
      expect(amountAt(sheet, 5, 12)).toBe(652.2);
    });

    it("gives the added line the look of the document's own lines", async () => {
      const { sheet } = await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
        "missing-1": FULL_PRICING,
      });

      expect(sheet.getRow(16).getCell(COLUMN.tarief).numFmt).toBe(MONEY_FORMAT);
      // Not a problem row: no highlight of any kind.
      expect(sheet.getRow(16).getCell(COLUMN.bookingNumber).fill).toEqual(
        sheet.getRow(2).getCell(COLUMN.bookingNumber).fill,
      );
    });

    /** The document's own Fuel convention, when it uses one. */
    it("writes Fuel as the document writes it", async () => {
      const { sheet } = await aWeekMissing(
        [missingTrip()],
        {
          "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
          // 10% of 517.20, which is exactly what the sheet's formula produces.
          "missing-1": pricing({ tarief: "517.20", brandstof: "51.72" }),
        },
        { sharedFuelFormula: true },
      );

      expect(formulaAt(sheet, 16, COLUMN.fuel)).toBe("10%*L16");
      expect(amountAt(sheet, 16, COLUMN.fuel)).toBe(51.72);
    });

    it("writes the amount when the document's percentage would not produce it", async () => {
      const { sheet } = await aWeekMissing(
        [missingTrip()],
        {
          "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
          // 12% on our side: the sheet's 10% formula cannot arrive at it.
          "missing-1": pricing({ tarief: "517.20", brandstof: "62.06" }),
        },
        { sharedFuelFormula: true },
      );

      expect(formulaAt(sheet, 16, COLUMN.fuel)).toBeNull();
      expect(amountAt(sheet, 16, COLUMN.fuel)).toBe(62.06);
    });

    it("leaves a Trip that was never priced without invented amounts", async () => {
      const { sheet } = await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
      });

      expect(sheet.getRow(16).getCell(COLUMN.bookingNumber).value).toBe(
        "BELANR2720016",
      );
      expect(amountAt(sheet, 16, COLUMN.tarief)).toBeNull();
    });

    /**
     * ── THE SAME FILE TWICE ─────────────────────────────────────────────────
     * The corrected document states the added transports, so checking it again
     * finds them already there. Nothing is remembered between the two runs: the
     * answer comes from the file in hand and the database as it is.
     */
    it("does not add the same transport twice", async () => {
      const first = await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
        "missing-1": FULL_PRICING,
      });

      const second = await service.apply({
        buffer: first.result.workbook,
        originalname: "week 13 - 2026 GLT (gecorrigeerd).xlsx",
        size: first.result.workbook.length,
      });

      expect(second.result.summary.missingTrips).toBe(0);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(second.workbook as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];

      const bookings: string[] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const booking = row.getCell(COLUMN.bookingNumber).value;
        if (typeof booking === "string") bookings.push(booking);
      });

      expect(bookings.filter((booking) => booking === "BELANR2720016")).toHaveLength(1);
    });

    it("never marks the added transport paid", async () => {
      const write = jest.fn();

      Object.assign(trips, { setPaid: write, update: write, create: write });

      await aWeekMissing([missingTrip()], {
        "trip-1": pricing({ tarief: "135", brandstof: "13.50", tol: "12" }),
        "missing-1": FULL_PRICING,
      });

      expect(write).not.toHaveBeenCalled();
    });
  });

  describe("what this phase still refuses to do", () => {
    it("never writes to a Trip", async () => {
      const write = jest.fn();

      Object.assign(trips, {
        create: write,
        update: write,
        setPaid: write,
        delete: write,
      });
      trips.findManyForInvoice.mockResolvedValue([
        trip("trip-1", "DUBANR2718284", "EUCU4581604"),
      ]);
      effectivePricing.findForTrips.mockResolvedValue(
        new Map([["trip-1", pricing({ tarief: "370" })]]),
      );

      await correct(
        await buildInvoiceWorkbook({
          lines: [
            {
              planningDate: MONDAY,
              bookingNumber: "DUBANR2718284",
              containerNumber: "EUCU 4581604",
              tarief: 364,
            },
          ],
        }),
      );

      expect(write).not.toHaveBeenCalled();
    });

    /**
     * ── TWO READS, WHATEVER THE INVOICE'S LENGTH ────────────────────────────
     * One for the transports the document names and one for the transports it
     * forgot — two different questions, each asked for its whole set at once.
     * Neither grows with the number of lines, which is what "no N+1" means.
     */
    it("reads the pricing per set, not per line", async () => {
      trips.findManyForInvoice.mockResolvedValue(
        Array.from({ length: 30 }, (_value, index) =>
          trip(`trip-${index}`, `ANRDUB${2725000 + index}`, `EUCU${4581000 + index}`),
        ),
      );

      await correct(
        await buildInvoiceWorkbook({
          lines: Array.from({ length: 30 }, (_value, index) => ({
            planningDate: MONDAY,
            bookingNumber: `ANRDUB${2725000 + index}`,
            containerNumber: `EUCU ${4581000 + index}`,
            tarief: 100,
          })),
        }),
      );

      expect(effectivePricing.findForTrips).toHaveBeenCalledTimes(2);
      // The 30 matched transports, in one call.
      expect(effectivePricing.findForTrips.mock.calls[0][0]).toHaveLength(30);
      // And the missing ones, in one more — none here.
      expect(effectivePricing.findForTrips.mock.calls[1][0]).toHaveLength(0);
    });
  });
});
