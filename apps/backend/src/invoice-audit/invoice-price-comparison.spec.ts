import ExcelJS from "exceljs";
import { Prisma, RouteMatchMethod, Trip } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import type { CurrentTripPricing } from "../trip-pricing/effective-pricing.service";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";
import { EXACT_ROUTE_MATCH, fuelRatesOf, reliablyPriced } from "./__fixtures__/invoice-pricing";
import { tripRecord } from "./__fixtures__/invoice-rows";
import { buildInvoiceWorkbook, type InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * The preview's price comparison: per component, the Excel's figure beside
 * Trano's and what the corrected document writes — the check's own comparison,
 * never a second one. Trano: Tarief 475, Fuel 24% = 114, Tol 50.
 */

const MONDAY = new Date(Date.UTC(2026, 9, 5));
const COLUMN = { tarief: 12, fuel: 13, tolB: 16 } as const;

function stored(overrides: Partial<Record<"tarief" | "brandstof" | "tol", string>> = {}): CurrentTripPricing {
  const of = (value: string) => new Prisma.Decimal(value);
  const tarief = of(overrides.tarief ?? "475");
  const brandstof = of(overrides.brandstof ?? "114");
  const tol = of(overrides.tol ?? "50");
  const zero = of("0");

  return reliablyPriced({
    components: [],
    tarief,
    brandstof,
    backload: zero,
    tol,
    tunnel: zero,
    others: zero,
    ek: zero,
    totaal: tarief.add(brandstof).add(tol),
  });
}

describe("the price comparison of a line", () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;
  const trip: Trip = tripRecord({ id: "t1", planningDate: MONDAY, originalPlanningDate: MONDAY });

  async function check(amounts: Partial<InvoiceFixtureLine>, pricing: CurrentTripPricing = stored()) {
    const service = buildInvoiceAuditService({
      logger,
      trips: { findManyForInvoice: jest.fn().mockResolvedValue([trip]), findClosedUnpaidBetween: jest.fn().mockResolvedValue([]) },
      effectivePricing: { findForTrips: jest.fn(async () => new Map([["t1", pricing]])) },
      fuelRates: fuelRatesOf(new Prisma.Decimal(24)),
    });
    const file = await buildInvoiceWorkbook({
      fuelPercentage: 24,
      lines: [{ planningDate: MONDAY, bookingNumber: trip.bookingNumber!, containerNumber: "EUCU 4541197", ...amounts }],
    });
    const applied = await service.apply({ buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length });
    const book = new ExcelJS.Workbook();

    await book.xlsx.load(applied.workbook as unknown as ArrayBuffer);

    return { row: applied.result.rows[0], cell: (column: number) => book.worksheets[0].getRow(2).getCell(column) };
  }

  it("shows a line that agrees: every charged component unchanged, Excel beside Trano", async () => {
    const { row } = await check({ tarief: 475, fuel: 114, tolB: 50 });

    expect(row.comparisons).toEqual([
      { component: "Tarief", outcome: "UNCHANGED", excelValue: "475.00", tranoValue: "475.00", writtenValue: null },
      { component: "Fuel", outcome: "UNCHANGED", excelValue: "114.00", tranoValue: "114.00", writtenValue: null },
      { component: "Tol", outcome: "UNCHANGED", excelValue: "50.00", tranoValue: "50.00", writtenValue: null },
    ]);
  });

  it("shows a raised component with the old and the written value, the others unchanged", async () => {
    const { row, cell } = await check({ tarief: 450, fuel: 114, tolB: 50 });

    expect(row.comparisons[0]).toEqual({
      component: "Tarief",
      outcome: "RAISE",
      excelValue: "450.00",
      tranoValue: "475.00",
      writtenValue: "475.00",
    });
    expect(row.comparisons.find((comparison) => comparison.component === "Tol")).toMatchObject({ outcome: "UNCHANGED" });
    // Exactly what the corrected document carries, red as before.
    expect(cell(COLUMN.tarief).value).toBe(475);
    expect(cell(COLUMN.tarief).font?.color?.argb).toBe(CORRECTED_TEXT_ARGB);
  });

  it("shows several raised components in the invoice's column order", async () => {
    const { row, cell } = await check({ tarief: 450, fuel: 108 });

    expect(row.comparisons.map((comparison) => [comparison.component, comparison.outcome, comparison.writtenValue])).toEqual([
      ["Tarief", "RAISE", "475.00"],
      ["Fuel", "RAISE", "114.00"],
      ["Tol", "RAISE", "50.00"],
    ]);
    expect([cell(COLUMN.tarief).value, cell(COLUMN.tolB).value]).toEqual([475, 50]);
  });

  it("shows an invoice above Trano as not lowered, nothing written", async () => {
    const { row, cell } = await check({ tarief: 500, fuel: 120, tolB: 50 });

    expect(row.comparisons[0]).toEqual({
      component: "Tarief",
      outcome: "INVOICE_HIGHER",
      excelValue: "500.00",
      tranoValue: "475.00",
      writtenValue: null,
    });
    expect(cell(COLUMN.tarief).value).toBe(500);
  });

  it("proposes no Trano figure for a price that cannot be relied on", async () => {
    const unreliable = {
      ...stored(),
      routeMatch: { ...EXACT_ROUTE_MATCH, method: RouteMatchMethod.NOT_FOUND, routePricingId: null },
    };

    const { row } = await check({ tarief: 450 }, unreliable);

    expect(row.pricingStatus).toBe("PRICE_UNRELIABLE");
    expect(row.comparisons).toEqual([]);
  });

  it("shows an unreadable cell without a Trano figure to set against it", async () => {
    const { row } = await check({ tarief: "veertig" as unknown as number, fuel: 114, tolB: 50 });

    expect(row.pricingStatus).toBe("AMOUNT_UNREADABLE");
    expect(row.comparisons).toEqual([
      { component: "Tarief", outcome: "UNREADABLE", excelValue: null, tranoValue: null, writtenValue: null },
    ]);
  });
});
