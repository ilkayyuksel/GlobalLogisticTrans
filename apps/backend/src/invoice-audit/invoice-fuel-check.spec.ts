import { isDeepStrictEqual } from "node:util";

import ExcelJS from "exceljs";
import { Prisma, RouteMatchMethod, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingAmountSource } from "../trip-pricing/effective-pricing";
import { type CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { EXACT_ROUTE_MATCH, fuelRatesOf, NO_FUEL_RATES, reliablyPriced } from "./__fixtures__/invoice-pricing";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * The Fuel of a line, checked on its own — also when its Tarief is right.
 *
 * The expected Fuel is this system's own: the Fuel the Pricing Engine stored on
 * the Trip's snapshot, which is the configured percentage applied to the
 * Trip's Tarief (Over ST included), followed by an operator's correction of the
 * Tarief. Nothing is recalculated here and no percentage is assumed: the rate a
 * formula is written with is the one the snapshot recorded.
 */

const MONDAY = new Date(Date.UTC(2026, 2, 23));
const ROW = 2;
const COLUMN = { tarief: 12, fuel: 13, backload: 14, tolB: 16, others: 19, ek: 20, remarks: 21 } as const;

function pricing(tarief: string, brandstof: string, extra: Partial<Record<"tol" | "ek", string>> = {}): CurrentTripPricing {
  const zero = new Prisma.Decimal(0);
  const amount = (value: string | undefined) => (value === undefined ? zero : new Prisma.Decimal(value));

  return reliablyPriced({
    components: [],
    tarief: new Prisma.Decimal(tarief),
    brandstof: new Prisma.Decimal(brandstof),
    backload: zero,
    tol: amount(extra.tol),
    tunnel: zero,
    others: zero,
    ek: amount(extra.ek),
    totaal: new Prisma.Decimal(tarief).add(brandstof).add(amount(extra.tol)).add(amount(extra.ek)),
  });
}

/** The Engine's own Tarief and Fuel lines, as a stored snapshot carries them. */
function withEngineLines(held: CurrentTripPricing): CurrentTripPricing {
  const engine = (componentCode: string, amount: Prisma.Decimal) => ({
    componentCode,
    engineAmount: amount,
    effectiveAmount: amount,
    source: PricingAmountSource.ENGINE,
  });

  return {
    ...held,
    components: [engine("BASE_PRICE", held.tarief), engine("FUEL_SURCHARGE", held.brandstof)],
  };
}

const LINE: InvoiceFixtureLine = {
  planningDate: MONDAY,
  bookingNumber: "DUBANR2718284",
  containerNumber: "EUCU 4581604",
  tarief: 200,
};

describe("the Fuel of an invoice line", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;

  async function correct(line: Partial<InvoiceFixtureLine>, held: CurrentTripPricing, fuelRate?: string) {
    const service = buildInvoiceAuditService({
      trips: {
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
        findClosedUnpaidBetween: jest.fn().mockResolvedValue([]),
      },
      effectivePricing: { findForTrips: jest.fn().mockResolvedValue(new Map([["trip-1", held]])) },
      logger,
      fuelRates: fuelRate ? fuelRatesOf(new Prisma.Decimal(fuelRate)) : NO_FUEL_RATES,
    });
    const received = await buildInvoiceWorkbook({ lines: [{ ...LINE, ...line }] });
    const applied = await service.apply({ buffer: received, originalname: "week 13.xlsx", size: received.length });
    const [before, after] = await Promise.all([read(received), read(applied.workbook)]);

    return { applied, before, after, changed: changedCells(before, after) };
  }

  const isRed = (sheet: ExcelJS.Worksheet, column: number) =>
    sheet.getRow(ROW).getCell(column).font?.color?.argb === CORRECTED_TEXT_ARGB;

  it("leaves a right Tarief and a right Fuel exactly as they are", async () => {
    const { applied, changed } = await correct({ fuel: 20 }, pricing("200", "20"));

    expect(changed).toEqual([]);
    expect(applied.result.rows[0].pricingStatus).toBe("MATCHED_NO_CHANGES");
  });

  /** The case this file exists for: a right Tarief is no reason to skip the Fuel. */
  it("corrects only the Fuel when the Tarief is right and the Fuel is too low, in red", async () => {
    const { applied, after, changed } = await correct({ fuel: 10, tolB: 12 }, pricing("200", "20", { tol: "12" }));

    expect(changed).toEqual([`M${ROW}`]);
    expect(after.getRow(ROW).getCell(COLUMN.fuel).value).toBe(20);
    expect(isRed(after, COLUMN.fuel)).toBe(true);
    expect(isRed(after, COLUMN.tarief)).toBe(false);
    expect(applied.result.rows[0].differences.filter((difference) => difference.correctedValue !== null)).toEqual([
      expect.objectContaining({ component: "Fuel", kind: "RAISE", invoiceValue: "10.00", correctedValue: "20.00" }),
    ]);
  });

  /** A Fuel higher than this system's is left exactly as the customer wrote it. */
  it("leaves a Fuel that is too high alone when the Tarief is right, and reports it", async () => {
    const { applied, after, changed } = await correct({ fuel: 30 }, pricing("200", "20"));

    expect(changed).toEqual([]);
    expect(after.getRow(ROW).getCell(COLUMN.fuel).value).toBe(30);
    expect(isRed(after, COLUMN.fuel)).toBe(false);
    expect(applied.result.rows[0].pricingStatus).toBe("INVOICE_HIGHER");
    expect(applied.result.rows[0].differences).toEqual([
      expect.objectContaining({ component: "Fuel", kind: "INVOICE_HIGHER", correctedValue: null }),
    ]);
  });

  it("corrects an empty Fuel when the Tarief is right", async () => {
    const { after, changed } = await correct({ fuel: null }, pricing("200", "20"));

    expect(changed).toEqual([`M${ROW}`]);
    expect(after.getRow(ROW).getCell(COLUMN.fuel).value).toBe(20);
  });

  /** In the customer's own shape, at the percentage the snapshot recorded — never a constant of ours. */
  it.each([
    ["24", "48.00"],
    ["26", "52.00"],
  ])("writes the Fuel as the Trip's own %s%% of its Tarief", async (rate, brandstof) => {
    const { after, changed } = await correct({ fuel: "formula" }, pricing("200", brandstof), rate);
    const fuel = after.getRow(ROW).getCell(COLUMN.fuel);

    expect(changed).toEqual([`M${ROW}`]);
    expect(fuel.formula).toBe(`${rate}%*L${ROW}`);
    expect(isRed(after, COLUMN.fuel)).toBe(true);
  });

  /** The Tarief goes up, and the Fuel is checked against the NEW Tarief. */
  it("checks the Fuel against the raised Tarief", async () => {
    const { after, changed } = await correct({ tarief: 150, fuel: "formula" }, pricing("200", "48"), "24");

    expect(changed.sort()).toEqual([`L${ROW}`, `M${ROW}`]);
    expect(after.getRow(ROW).getCell(COLUMN.tarief).value).toBe(200);
    expect(after.getRow(ROW).getCell(COLUMN.fuel).formula).toBe(`24%*L${ROW}`);
    expect(isRed(after, COLUMN.fuel)).toBe(true);
  });

  /** A Tarief of nothing owes no Fuel; a Fuel on the invoice is never lowered. */
  it("owes no Fuel on a Tarief of zero, and lowers none", async () => {
    const empty = await correct({ tarief: null, fuel: null }, pricing("0", "0"));
    const stated = await correct({ tarief: null, fuel: 10 }, pricing("0", "0"));

    expect(empty.changed).toEqual([]);
    expect(stated.changed).toEqual([]);
    expect(stated.applied.result.rows[0].differences).toEqual([
      expect.objectContaining({ component: "Fuel", kind: "INVOICE_HIGHER" }),
    ]);
  });

  /*
   * ── A HIGHER TARIEF ON THE INVOICE (owner, 19 October 2026) ────────────────
   * That Tarief stays — nothing is lowered — so the Fuel owed is OUR percentage
   * of IT, not of this system's Tarief. Here: our Tarief 200 at 20% (Fuel 40),
   * the invoice's Tarief 250, so the Fuel owed is 50.
   */
  describe("when the invoice states a higher Tarief than this system", () => {
    const HELD = withEngineLines(pricing("200", "40"));

    it("raises a Fuel at a lower percentage to ours of the invoice's Tarief", async () => {
      const { applied, after, changed } = await correct({ tarief: 250, fuel: 40 }, HELD, "20");

      expect(changed).toEqual([`M${ROW}`]);
      expect(after.getRow(ROW).getCell(COLUMN.tarief).value).toBe(250);
      expect(after.getRow(ROW).getCell(COLUMN.fuel).formula).toBe(`20%*L${ROW}`);
      expect(isRed(after, COLUMN.fuel)).toBe(true);
      expect(isRed(after, COLUMN.tarief)).toBe(false);
      expect(applied.result.rows[0].differences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ component: "Fuel", kind: "RAISE", invoiceValue: "40.00", correctedValue: "50.00" }),
        ]),
      );
    });

    it("raises the customer's own lower-percentage formula", async () => {
      // `10%*L2` on 250 = 25.
      const { after, changed } = await correct({ tarief: 250, fuel: "formula" }, HELD, "20");

      expect(changed).toEqual([`M${ROW}`]);
      expect(after.getRow(ROW).getCell(COLUMN.fuel).formula).toBe(`20%*L${ROW}`);
    });

    it("leaves a Fuel that is already our percentage of it", async () => {
      const { applied, changed } = await correct({ tarief: 250, fuel: 50 }, HELD, "20");

      expect(changed).toEqual([]);
      expect(applied.result.rows[0].differences.some((difference) => difference.component === "Fuel")).toBe(false);
    });

    it("leaves a higher Fuel alone, and reports it", async () => {
      const { applied, changed } = await correct({ tarief: 250, fuel: 60 }, HELD, "20");

      expect(changed).toEqual([]);
      expect(applied.result.rows[0].differences).toEqual(
        expect.arrayContaining([expect.objectContaining({ component: "Fuel", kind: "INVOICE_HIGHER" })]),
      );
    });

    /** A snapshot that recorded no rate: the percentage its own amounts imply, 40 / 200. */
    it("uses the snapshot's own ratio when no rate was recorded, written as an amount", async () => {
      const { after, changed } = await correct({ tarief: 250, fuel: 40 }, HELD);

      expect(changed).toEqual([`M${ROW}`]);
      expect(after.getRow(ROW).getCell(COLUMN.fuel).value).toBe(50);
    });

    it("rounds to the cent, half up", async () => {
      // 20% of 250.33 = 50.066
      const { after } = await correct({ tarief: 250.33, fuel: 40 }, HELD);

      expect(after.getRow(ROW).getCell(COLUMN.fuel).value).toBe(50.07);
    });
  });

  /** A price nobody can stand behind is not compared at all — its Fuel neither. */
  it("compares no Fuel on a line whose price cannot be relied on", async () => {
    const notFound: CurrentTripPricing = {
      ...pricing("0", "0"),
      routeMatch: { ...EXACT_ROUTE_MATCH, method: RouteMatchMethod.NOT_FOUND, routePricingId: null },
    };
    const { applied, after } = await correct({ fuel: 10 }, notFound);

    expect(applied.result.rows[0].pricingStatus).toBe("PRICE_UNRELIABLE");
    expect(after.getRow(ROW).getCell(COLUMN.fuel).value).toBe(10);
    expect(isRed(after, COLUMN.fuel)).toBe(false);
  });
});

async function read(bytes: Buffer): Promise<ExcelJS.Worksheet> {
  const book = new ExcelJS.Workbook();

  await book.xlsx.load(bytes as unknown as ArrayBuffer);

  return book.worksheets[0];
}

/** The cells of the line whose value or style differs: nothing but the corrections. */
function changedCells(before: ExcelJS.Worksheet, after: ExcelJS.Worksheet): string[] {
  const changed: string[] = [];

  for (let column = 1; column <= 21; column += 1) {
    const was = before.getRow(ROW).getCell(column);
    const is = after.getRow(ROW).getCell(column);

    if (!isDeepStrictEqual(was.value, is.value) || !isDeepStrictEqual(was.font?.color, is.font?.color)) {
      changed.push(is.address);
    }
  }

  return changed;
}
