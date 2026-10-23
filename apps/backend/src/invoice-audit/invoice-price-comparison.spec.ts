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

function stored(
  overrides: Partial<Record<"tarief" | "brandstof" | "tol" | "tunnel" | "others" | "ek", string>> = {},
): CurrentTripPricing {
  const of = (value: string | undefined, fallback = "0") => new Prisma.Decimal(value ?? fallback);
  const tarief = of(overrides.tarief, "475");
  const brandstof = of(overrides.brandstof, "114");
  const tol = of(overrides.tol, "50");
  const tunnel = of(overrides.tunnel);
  const others = of(overrides.others);
  const ek = of(overrides.ek);

  return reliablyPriced({
    components: [],
    tarief,
    brandstof,
    backload: of(undefined),
    tol,
    tunnel,
    others,
    ek,
    totaal: tarief.add(brandstof).add(tol).add(tunnel).add(others).add(ek),
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

  /**
   * A line of a Trano Trip that states no transport price: Trano's stored
   * prices are FILLED in — through the same writes as any raise — and the
   * preview says so rather than comparing an empty cell.
   */
  describe("a line stating no transport price", () => {
    it("fills every price Trano holds, red, and says the prices come from Trano", async () => {
      const { row, cell } = await check({});

      expect(row).toMatchObject({ status: "MATCHED", pricingStatus: "PRICING_CORRECTED", transportPricesFilled: true });
      expect(row.comparisons).toEqual([
        { component: "Tarief", outcome: "FILLED", excelValue: null, tranoValue: "475.00", writtenValue: "475.00" },
        { component: "Fuel", outcome: "FILLED", excelValue: null, tranoValue: "114.00", writtenValue: "114.00" },
        { component: "Tol", outcome: "FILLED", excelValue: null, tranoValue: "50.00", writtenValue: "50.00" },
      ]);
      expect(cell(COLUMN.tarief).value).toBe(475);
      expect(cell(COLUMN.fuel).value).toEqual({ formula: "24%*L2", result: 114 });
      expect(cell(COLUMN.tolB).value).toBe(50);
      for (const column of [COLUMN.tarief, COLUMN.fuel, COLUMN.tolB]) {
        expect(cell(column).font?.color?.argb).toBe(CORRECTED_TEXT_ARGB);
        // The customer's own number format stays.
        expect(cell(column).numFmt).toContain("€");
      }
    });

    it("fills every component Trano holds — Tunnel, Others and EK too — and leaves a zero empty", async () => {
      const { row, cell } = await check({}, stored({ tunnel: "12", others: "35", ek: "25", tol: "0" }));

      expect(row.comparisons.map((comparison) => [comparison.component, comparison.writtenValue])).toEqual([
        ["Tarief", "475.00"],
        ["Fuel", "114.00"],
        ["Tunnel", "12.00"],
        ["Others", "35.00"],
        ["EK", "25.00"],
      ]);
      expect([cell(18).value, cell(19).value, cell(20).value]).toEqual([12, 35, 25]);
      // Tol is zero in Trano: no figure, no "- €", an empty cell as before.
      expect(cell(COLUMN.tolB).value).toBeNull();
    });

    it("matches with one misprinted value, corrects it and fills the prices", async () => {
      const { row, cell } = await check({ containerNumber: "EUCU 9999999" });

      expect(row).toMatchObject({
        status: "MATCHED",
        containerCorrection: { tripContainerNumber: "EUCU4541197" },
        transportPricesFilled: true,
      });
      expect(cell(COLUMN.tarief).value).toBe(475);
    });

    it("invents nothing for a price that cannot be relied on, and says why", async () => {
      const unreliable = { ...stored(), routeMatch: { ...EXACT_ROUTE_MATCH, method: RouteMatchMethod.NOT_FOUND, routePricingId: null } };

      const { row, cell } = await check({}, unreliable);

      expect(row).toMatchObject({ status: "MATCHED", pricingStatus: "PRICE_UNRELIABLE", transportPricesFilled: false, comparisons: [] });
      expect(row.priceReliability).toMatchObject({ reliable: false });
      expect([cell(COLUMN.tarief).value, cell(COLUMN.fuel).value, cell(COLUMN.tolB).value]).toEqual([null, null, null]);
    });

    it("invents nothing for a Trip that was never priced", async () => {
      const service = buildInvoiceAuditService({
        logger,
        trips: { findManyForInvoice: jest.fn().mockResolvedValue([trip]), findClosedUnpaidBetween: jest.fn().mockResolvedValue([]) },
        effectivePricing: { findForTrips: jest.fn(async () => new Map()) },
      });
      const file = await buildInvoiceWorkbook({
        lines: [{ planningDate: MONDAY, bookingNumber: trip.bookingNumber!, containerNumber: "EUCU 4541197" }],
      });
      const copy = Buffer.from(file);
      const applied = await service.apply({ buffer: file, originalname: "week 41 - 2026 GLT.xlsx", size: file.length });

      expect(applied.result.rows[0]).toMatchObject({ status: "MATCHED", pricingStatus: "PRICE_UNRELIABLE", comparisons: [] });
      // The received file is never written to.
      expect(file.equals(copy)).toBe(true);
    });
  });

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
      // The Excel states no Tol: Trano's is filled in, not compared.
      ["Tol", "FILLED", "50.00"],
    ]);
    expect(row.transportPricesFilled).toBe(false);
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
