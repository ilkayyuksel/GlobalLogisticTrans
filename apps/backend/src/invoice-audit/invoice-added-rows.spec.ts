import ExcelJS from "exceljs";
import { Prisma, TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { type CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { fuelRatesOf, reliablyPriced } from "./__fixtures__/invoice-pricing";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * The lines this check adds for transports the invoice forgot, read back out of
 * the corrected file: what is red, what is yellow, where `COMBINATION` stands,
 * when the Fuel header follows — and that a document whose totals would leave
 * an added line out gets none.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));

const COLUMN = {
  bookingNumber: 5,
  containerNumber: 6,
  startPoint: 7,
  endPoint: 11,
  tarief: 12,
  fuel: 13,
  remarks: 21,
} as const;

/** One customer line on 2, so the first added line goes to 3. */
const ADDED_ROW = 3;

function pricing(tarief: string, brandstof: string): CurrentTripPricing {
  const zero = new Prisma.Decimal(0);

  return reliablyPriced({
    components: [],
    tarief: new Prisma.Decimal(tarief),
    brandstof: new Prisma.Decimal(brandstof),
    backload: zero,
    tol: zero,
    tunnel: zero,
    others: zero,
    ek: zero,
    totaal: new Prisma.Decimal(tarief).add(brandstof),
  });
}

function missingTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "missing-1",
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: MONDAY,
    originalPlanningDate: MONDAY,
    startTime: null,
    bookingNumber: "BELANR2720016",
    containerNumber: "EUCU2451828",
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "MELSELE",
    direction: TripDirection.DELIVERY,
    tripGroupId: null,
    distanceKm: null,
    ...overrides,
  };
}

const CUSTOMER_LINE: InvoiceFixtureLine = {
  planningDate: MONDAY,
  bookingNumber: "DUBANR2718284",
  containerNumber: "EUCU 4581604",
  tarief: 135,
  fuel: "formula",
};

const isRed = (cell: ExcelJS.Cell) => cell.font?.color?.argb === CORRECTED_TEXT_ARGB;
const isYellow = (cell: ExcelJS.Cell) =>
  (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb === "FFFFFF00";

describe("the lines added for forgotten transports", () => {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  interface Week {
    readonly missing: readonly Record<string, unknown>[];
    readonly pricingByTrip: Record<string, CurrentTripPricing>;
    readonly groupSizes?: Record<string, number>;
    readonly fuelRate?: string;
    readonly customerLine?: Partial<InvoiceFixtureLine>;
    /** Changes the received document before it is checked. */
    readonly edit?: (sheet: ExcelJS.Worksheet) => void;
  }

  async function correct(week: Week) {
    const trips = {
      findManyForInvoice: jest.fn().mockResolvedValue([
        {
          id: "trip-1",
          status: TripStatus.CLOSED,
          isPaid: false,
          planningDate: MONDAY,
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU4581604",
        },
      ]),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue(week.missing),
      setPaidMany: jest.fn(async (ids: readonly string[]) => ids.length),
    };
    const effectivePricing = {
      findForTrips: jest.fn(async (ids: readonly string[]) =>
        new Map(ids.flatMap((id) => (week.pricingByTrip[id] ? [[id, week.pricingByTrip[id]]] : []))),
      ),
    };
    const reads = invoiceReads();

    reads.countGroupMembers.mockResolvedValue(new Map(Object.entries(week.groupSizes ?? {})));

    const service = buildInvoiceAuditService({
      trips,
      effectivePricing,
      logger,
      reads,
      fuelRates: week.fuelRate ? fuelRatesOf(new Prisma.Decimal(week.fuelRate)) : undefined,
    });
    const received = await withEdit(
      await buildInvoiceWorkbook({ lines: [{ ...CUSTOMER_LINE, ...week.customerLine }] }),
      week.edit,
    );
    const applied = await service.apply({
      buffer: received,
      originalname: "week 13 - 2026 GLT.xlsx",
      size: received.length,
    });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    return { applied, sheet: book.worksheets[0] };
  }

  it("writes the amounts, booking and container of a reliably priced line in red", async () => {
    const { sheet } = await correct({
      missing: [missingTrip()],
      pricingByTrip: { "trip-1": pricing("135", "13.50"), "missing-1": pricing("200", "20") },
    });
    const added = sheet.getRow(ADDED_ROW);

    expect(added.getCell(COLUMN.bookingNumber).value).toBe("BELANR2720016");
    expect(isRed(added.getCell(COLUMN.bookingNumber))).toBe(true);
    expect(isRed(added.getCell(COLUMN.containerNumber))).toBe(true);
    expect(added.getCell(COLUMN.tarief).value).toBe(200);
    expect(isRed(added.getCell(COLUMN.tarief))).toBe(true);
    expect(isRed(added.getCell(COLUMN.fuel))).toBe(true);
    // Everything else takes the customer's look; not a problem line.
    expect(isRed(added.getCell(COLUMN.startPoint))).toBe(false);
    expect(isYellow(added.getCell(COLUMN.bookingNumber))).toBe(false);
  });

  it("adds a line whose price cannot be relied on without amounts, in yellow", async () => {
    const { applied, sheet } = await correct({
      missing: [missingTrip()],
      pricingByTrip: { "trip-1": pricing("135", "13.50") },
    });
    const added = sheet.getRow(ADDED_ROW);

    expect(added.getCell(COLUMN.bookingNumber).value).toBe("BELANR2720016");
    expect(added.getCell(COLUMN.tarief).value).toBeNull();
    expect(isYellow(added.getCell(1))).toBe(true);
    expect(isYellow(added.getCell(COLUMN.remarks))).toBe(true);
    expect(applied.result.missingTrips[0].priceReliability.reliable).toBe(false);
    // An added line is never offered for payment.
    expect(applied.result.payments.map((payment) => payment.tripId)).toEqual(["trip-1"]);
  });

  describe("COMBINATION", () => {
    it("marks the Endpoint of the leg out of the terminal in a group of two", async () => {
      const { applied, sheet } = await correct({
        missing: [missingTrip({ tripGroupId: "g" })],
        pricingByTrip: { "trip-1": pricing("135", "13.50"), "missing-1": pricing("200", "20") },
        groupSizes: { g: 2 },
      });

      expect(sheet.getRow(ADDED_ROW).getCell(COLUMN.endPoint).value).toBe("COMBINATION");
      expect(sheet.getRow(ADDED_ROW).getCell(COLUMN.startPoint).value).toBeNull();
      expect(applied.result.missingTrips[0].combinationEnd).toBe("endPoint");
    });

    it("spells the marker as the customer's own legs do", async () => {
      const { sheet } = await correct({
        missing: [missingTrip({ tripGroupId: "g", direction: TripDirection.COLLECTION })],
        pricingByTrip: { "trip-1": pricing("135", "13.50"), "missing-1": pricing("200", "20") },
        groupSizes: { g: 2 },
        customerLine: { endPoint: "COMBINATION " },
      });

      expect(sheet.getRow(ADDED_ROW).getCell(COLUMN.startPoint).value).toBe("COMBINATION ");
    });

    it("marks nothing for a group of three", async () => {
      const { sheet } = await correct({
        missing: [missingTrip({ tripGroupId: "g" })],
        pricingByTrip: { "trip-1": pricing("135", "13.50"), "missing-1": pricing("200", "20") },
        groupSizes: { g: 3 },
      });

      expect(sheet.getRow(ADDED_ROW).getCell(COLUMN.endPoint).value).toBeNull();
    });
  });

  describe("the Fuel header", () => {
    /** Fuel `10%*L2` (13,50) where the system holds 24% (32,40). */
    const RAISED_TO_24 = {
      missing: [missingTrip()],
      pricingByTrip: { "trip-1": pricing("135", "32.40"), "missing-1": pricing("200", "48") },
      fuelRate: "24",
    };

    it("follows when the whole column, added lines included, states one new percentage", async () => {
      const { applied, sheet } = await correct(RAISED_TO_24);

      expect(sheet.getCell("M1").value).toBe("Fuel 24%");
      // The summary moved down one row with the totals; its label followed.
      expect(sheet.getCell("K7").value).toBe("Fuel 24% ");
      expect(sheet.getCell("M2").formula).toBe("24%*L2");
      expect(sheet.getCell(`M${ADDED_ROW}`).formula).toBe(`24%*L${ADDED_ROW}`);
      expect(applied.result.fuelHeader?.header.after).toBe("Fuel 24%");
    });

    it("stays when an added line's Fuel would not come out at the new percentage", async () => {
      const { applied, sheet } = await correct({
        ...RAISED_TO_24,
        pricingByTrip: { ...RAISED_TO_24.pricingByTrip, "missing-1": pricing("200", "46") },
      });

      expect(sheet.getCell("M1").value).toBe("Fuel 10%");
      expect(applied.result.fuelHeader).toBeNull();
    });
  });

  /** Week 36 as corrected by hand: one total that stops short. */
  describe("a document whose totals would leave an added line out", () => {
    const shortBackloadTotal = (sheet: ExcelJS.Worksheet) => {
      sheet.getCell("N3").value = { formula: "SUM(N1:N1)", result: 0 };
    };

    it("gets no added line and no new Fuel header, and says why", async () => {
      const { applied, sheet } = await correct({
        missing: [missingTrip()],
        pricingByTrip: { "trip-1": pricing("135", "32.40"), "missing-1": pricing("200", "48") },
        fuelRate: "24",
        edit: shortBackloadTotal,
      });

      expect(applied.rowsAdded).toBe(0);
      expect(applied.result.missingTrips).toHaveLength(1);
      expect(applied.result.missingTrips[0].rowNumber).toBeNull();
      expect(applied.result.totalsStructure.sound).toBe(false);
      expect(applied.result.totalsStructure.problems).toEqual([
        expect.stringContaining("Backload"),
      ]);
      expect(applied.result.fuelHeader).toBeNull();
      expect(sheet.getCell("M1").value).toBe("Fuel 10%");
      // The deviation itself is reported, never "fixed".
      expect(sheet.getCell("N3").formula).toBe("SUM(N1:N1)");
      // The totals row did not move.
      expect(sheet.getCell("L3").formula).toBe("SUM(L2:L2)");
    });
  });
});

/** The received document, as the customer might have changed it by hand. */
async function withEdit(
  file: Buffer,
  edit: ((sheet: ExcelJS.Worksheet) => void) | undefined,
): Promise<Buffer> {
  if (!edit) {
    return file;
  }

  const book = new ExcelJS.Workbook();

  await book.xlsx.load(file as unknown as ArrayBuffer);
  edit(book.worksheets[0]);

  return Buffer.from(await book.xlsx.writeBuffer());
}
