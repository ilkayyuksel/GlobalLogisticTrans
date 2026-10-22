import ExcelJS from "exceljs";
import { Prisma, TripDirection, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { type CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { reliablyPriced } from "./__fixtures__/invoice-pricing";
import { buildInvoiceWorkbook } from "./__fixtures__/invoice-workbook";
import type { InvoiceFuelRateReader } from "./pricing/invoice-fuel-rate.reader";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * The Fuel of a line the invoice check ADDS for a forgotten transport is a
 * FORMULA on that line's own Tarief — Excel calculates it, as on the
 * customer's own lines — at the percentage the Trip's stored price was
 * calculated at.
 *
 * The customer's document here charges `Fuel 24%`, as their real files write
 * it: its one line states Tarief 135 and Fuel `=24%*L2` (32,40). Columns:
 * L Tarief, M Fuel.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));
const TARIEF = 12;
const FUEL = 13;
const zero = new Prisma.Decimal(0);

function pricing(tarief: string, brandstof: string, extra: Partial<Record<"backload" | "tol", string>> = {}): CurrentTripPricing {
  const amount = (value: string | undefined) => (value === undefined ? zero : new Prisma.Decimal(value));

  return reliablyPriced({
    components: [],
    tarief: new Prisma.Decimal(tarief),
    brandstof: new Prisma.Decimal(brandstof),
    backload: amount(extra.backload),
    tol: amount(extra.tol),
    tunnel: zero,
    others: zero,
    ek: zero,
    totaal: new Prisma.Decimal(tarief).add(brandstof).add(amount(extra.backload)).add(amount(extra.tol)),
  });
}

function missingTrip(id: string, bookingNumber: string) {
  return {
    id,
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: MONDAY,
    originalPlanningDate: MONDAY,
    startTime: null,
    bookingNumber,
    containerNumber: `EUCU${bookingNumber.slice(-7)}`,
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "MELSELE",
    direction: TripDirection.DELIVERY,
    tripGroupId: null,
    distanceKm: null,
  };
}

describe("the Fuel formula of an added line", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;

  /**
   * The customer's week with one line of its own, and these forgotten
   * transports: their stored prices and the Fuel rate each snapshot recorded.
   */
  async function check(
    missing: readonly { trip: ReturnType<typeof missingTrip>; pricing: CurrentTripPricing; fuelRate: string | null }[],
  ) {
    const pricingByTrip = new Map<string, CurrentTripPricing>([
      ["trip-1", pricing("135", "32.40")],
      ...missing.map((each) => [each.trip.id, each.pricing] as const),
    ]);
    const rates = new Map(
      [["trip-1", "24"] as const, ...missing.map((each) => [each.trip.id, each.fuelRate] as const)]
        .filter((entry): entry is readonly [string, string] => entry[1] !== null)
        .map(([id, rate]) => [id, new Prisma.Decimal(rate)]),
    );
    const service = buildInvoiceAuditService({
      logger,
      trips: {
        findManyForInvoice: jest.fn().mockResolvedValue([
          {
            id: "trip-1",
            status: TripStatus.CLOSED,
            isPaid: false,
            planningDate: MONDAY,
            originalPlanningDate: MONDAY,
            bookingNumber: "DUBANR2718284",
            containerNumber: "EUCU4581604",
            terminal: "Quay 869",
            destinationCity: "MELSELE",
            direction: TripDirection.DELIVERY,
            tripGroupId: null,
          },
        ]),
        findClosedUnpaidBetween: jest.fn().mockResolvedValue(missing.map((each) => each.trip)),
      },
      effectivePricing: {
        findForTrips: jest.fn(async (ids: readonly string[]) =>
          new Map(ids.flatMap((id) => (pricingByTrip.has(id) ? [[id, pricingByTrip.get(id)!] as const] : []))),
        ),
      },
      fuelRates: {
        findForTrips: async (ids: readonly string[]) =>
          new Map([...rates].filter(([id]) => ids.includes(id))),
      } as unknown as InvoiceFuelRateReader,
    });
    const received = await withCustomerFuelFormula(
      await buildInvoiceWorkbook({
        fuelPercentage: 24,
        lines: [{ planningDate: MONDAY, bookingNumber: "DUBANR2718284", containerNumber: "EUCU 4581604", tarief: 135 }],
      }),
    );
    const applied = await service.apply({ buffer: received, originalname: "week 13 - 2026 GLT.xlsx", size: received.length });
    // Written to a file and read back: what the customer's Excel opens.
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    return { applied, sheet: book.worksheets[0], received };
  }

  const fuelCell = (sheet: ExcelJS.Worksheet, row: number) => sheet.getRow(row).getCell(FUEL);
  const isRed = (cell: ExcelJS.Cell) => cell.font?.color?.argb === CORRECTED_TEXT_ARGB;

  it("1. Tarief 100 at 24%: a formula on its own Tarief cell that comes to 24", async () => {
    const { sheet } = await check([
      { trip: missingTrip("missing-1", "BELANR2720016"), pricing: pricing("100", "24"), fuelRate: "24" },
    ]);
    const cell = fuelCell(sheet, 3);

    expect(sheet.getRow(3).getCell(TARIEF).value).toBe(100);
    expect(cell.formula).toBe("24%*L3");
    expect(cell.result).toBe(24);
    expect(typeof cell.value).toBe("object");
  });

  it("2. refers to the Tarief cell of its own row, whatever the Tarief and the row", async () => {
    const { sheet } = await check([
      { trip: missingTrip("missing-1", "BELANR2720016"), pricing: pricing("250", "60"), fuelRate: "24" },
      { trip: missingTrip("missing-2", "BELANR2720017"), pricing: pricing("137.50", "33"), fuelRate: "24" },
    ]);
    const rows = [3, 4].map((row) => ({
      booking: sheet.getRow(row).getCell(5).value,
      tarief: sheet.getRow(row).getCell(TARIEF).value,
      formula: fuelCell(sheet, row).formula,
      result: fuelCell(sheet, row).result,
    }));

    expect(rows).toEqual(
      expect.arrayContaining([
        { booking: "BELANR2720016", tarief: 250, formula: expect.stringMatching(/^24%\*L[34]$/), result: 60 },
        { booking: "BELANR2720017", tarief: 137.5, formula: expect.stringMatching(/^24%\*L[34]$/), result: 33 },
      ]),
    );
    for (const row of [3, 4]) {
      expect(fuelCell(sheet, row).formula).toBe(`24%*L${row}`);
    }
  });

  /** The existing rule: an amount of nothing is an empty cell, never `0` or a formula showing `- €`. */
  it("3. a Tarief of zero: no Fuel, the cell empty as every zero amount", async () => {
    const { sheet } = await check([
      { trip: missingTrip("missing-1", "BELANR2720016"), pricing: pricing("0", "0"), fuelRate: "24" },
    ]);

    expect(sheet.getRow(3).getCell(TARIEF).value).toBeNull();
    expect(fuelCell(sheet, 3).value).toBeNull();
  });

  describe("4. the Trip's own percentage, never one assumed", () => {
    it("writes the Trip's 15% though the document charges 24%", async () => {
      const { sheet } = await check([
        { trip: missingTrip("missing-1", "BELANR2720016"), pricing: pricing("100", "15"), fuelRate: "15" },
      ]);

      expect(fuelCell(sheet, 3).formula).toBe("15%*L3");
      expect(fuelCell(sheet, 3).result).toBe(15);
    });

    it("follows the document's percentage when the snapshot recorded none, if it comes to the Fuel", async () => {
      const { sheet } = await check([
        { trip: missingTrip("missing-1", "BELANR2720016"), pricing: pricing("100", "24"), fuelRate: null },
      ]);

      expect(fuelCell(sheet, 3).formula).toBe("24%*L3");
    });

    it("writes the amount when no percentage comes to exactly the Fuel", async () => {
      const { sheet } = await check([
        // A recorded 15% where the stored Fuel is 17,30: no formula would show it.
        { trip: missingTrip("missing-1", "BELANR2720016"), pricing: pricing("100", "17.30"), fuelRate: "15" },
      ]);

      expect(fuelCell(sheet, 3).formula).toBeUndefined();
      expect(fuelCell(sheet, 3).value).toBe(17.3);
    });
  });

  it("5. counts the Fuel once: the totals sum each column over the lines, the added one included", async () => {
    const { sheet } = await check([
      {
        trip: missingTrip("missing-1", "BELANR2720016"),
        pricing: pricing("100", "24", { tol: "10" }),
        fuelRate: "24",
      },
    ]);
    const totals = sheet.getRow(4);

    expect(totals.getCell(TARIEF).formula).toBe("SUM(L2:L3)");
    expect(totals.getCell(FUEL).formula).toBe("SUM(M2:M3)");
    // Fuel is in the Fuel column alone: not added to the Tarief or any other cell.
    expect(sheet.getRow(3).getCell(TARIEF).value).toBe(100);
    expect(sheet.getRow(3).getCell(16).value).toBe(10);
    const formulas = [...Array(21).keys()]
      .map((index) => sheet.getRow(3).getCell(index + 1))
      .filter((cell) => cell.formula);
    expect(formulas.map((cell) => cell.address)).toEqual(["M3"]);
  });

  it("6. keeps the formula in the saved file, marked red as everything new, and leaves the customer's own line alone", async () => {
    const { sheet, received } = await check([
      { trip: missingTrip("missing-1", "BELANR2720016"), pricing: pricing("100", "24"), fuelRate: "24" },
    ]);
    const original = new ExcelJS.Workbook();

    await original.xlsx.load(received as unknown as ArrayBuffer);

    expect(fuelCell(sheet, 3).formula).toBe("24%*L3");
    expect(isRed(fuelCell(sheet, 3))).toBe(true);
    expect(fuelCell(sheet, 3).numFmt).toBe(original.worksheets[0].getRow(2).getCell(FUEL).numFmt);
    // The customer's line: unchanged, not red.
    expect(fuelCell(sheet, 2).formula).toBe("24%*L2");
    expect(isRed(fuelCell(sheet, 2))).toBe(false);
    // And the received file itself is never written to.
    expect(original.worksheets[0].getRow(3).getCell(5).value).not.toBe("BELANR2720016");
  });
});

/** The customer's line writes its Fuel as their real files do: `=24%*L2`. */
async function withCustomerFuelFormula(file: Buffer): Promise<Buffer> {
  const book = new ExcelJS.Workbook();

  await book.xlsx.load(file as unknown as ArrayBuffer);
  book.worksheets[0].getCell("M2").value = { formula: "24%*L2", result: 32.4 };

  return Buffer.from(await book.xlsx.writeBuffer());
}
