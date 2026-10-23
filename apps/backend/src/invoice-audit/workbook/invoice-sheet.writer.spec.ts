import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../../logger/app-logger.service";
import {
  InvoicePricingStatus,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import type { InvoiceSheet } from "./invoice-sheet";
import { InvoiceSheetWriter } from "./invoice-sheet.writer";

/**
 * The writer, on its own.
 *
 * What the corrected document looks like is proved against real bytes in
 * `invoice-corrected-workbook.spec.ts`. What is proved HERE is the writer's own
 * two promises, which that file cannot see: that it writes only what the
 * pricing check corrected, and that it asks Excel to recalculate — a flag
 * ExcelJS writes into the workbook but does not read back.
 */

const COLUMNS = { tarief: 12, fuel: 13 } as const;

function sheetOf(rowNumbers: readonly number[]): InvoiceSheet {
  return {
    sheetName: "Sheet1",
    headerRowNumber: 1,
    lastColumnNumber: 13,
    columns: COLUMNS,
    rows: rowNumbers.map((rowNumber) => ({
      rowNumber,
      planningDate: "2026-03-23",
      bookingNumber: "DUBANR2718284",
      containerNumber: "EUCU 4581604",
      normalizedContainerNumber: "EUCU4581604",
      startPoint: "",
      endPoint: "",
      remarks: "",
      costLine: null,
      amounts: {},
    })),
    totalsRowNumber: null,
    summaryRowNumbers: [],
    incompleteRowNumbers: [],
    incompleteRows: [],
    // Nothing in this document was written by a previous run.
    addedByAudit: new Map(),
  };
}

function correction(
  rowNumber: number,
  status: InvoicePricingStatus,
): InvoiceRowPricing {
  return {
    rowNumber,
    status,
    differences: [
      {
        component: "Tarief",
        kind: "RAISE",
        column: "tarief",
        invoiceValue: new Prisma.Decimal("364"),
        expectedValue: new Prisma.Decimal("370"),
        difference: new Prisma.Decimal("6"),
        correctionRowNumber: rowNumber,
        correctedValue: new Prisma.Decimal("370"),
        keepsFormula: false,
        write: { kind: "VALUE", value: new Prisma.Decimal("370") },
        problem: null,
      },
    ],
    reliability: null,
  };
}

describe("InvoiceSheetWriter", () => {
  let workbook: ExcelJS.Workbook;
  let worksheet: ExcelJS.Worksheet;
  let writer: InvoiceSheetWriter;

  beforeEach(() => {
    workbook = new ExcelJS.Workbook();
    worksheet = workbook.addWorksheet("Sheet1");
    worksheet.getRow(2).getCell(COLUMNS.tarief).value = 364;
    worksheet.getRow(3).getCell(COLUMNS.tarief).value = 364;

    writer = new InvoiceSheetWriter({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as AppLoggerService);
  });

  it("writes the corrected amount", () => {
    const written = writer.apply(
      workbook,
      worksheet,
      sheetOf([2]),
      new Map([[2, correction(2, InvoicePricingStatus.PRICING_CORRECTED)]]),
    );

    expect(written).toMatchObject({ cellsWritten: 1, rowsCorrected: 1 });
    expect(worksheet.getRow(2).getCell(COLUMNS.tarief).value).toBe(370);
  });

  /**
   * ── THE HARD RULE ───────────────────────────────────────────────────────
   * A line that is a problem in any way is never written to. Even handed a
   * planned write, a row in one of these states is left exactly as it was —
   * the status is what decides, not the presence of a figure.
   */
  it.each([
    InvoicePricingStatus.NOT_COMPARED,
    InvoicePricingStatus.PRICE_UNRELIABLE,
    InvoicePricingStatus.AMOUNT_UNREADABLE,
  ])("writes nothing for a row that is %s", (status) => {
    const written = writer.apply(
      workbook,
      worksheet,
      sheetOf([2]),
      new Map([[2, correction(2, status)]]),
    );

    expect(written.cellsWritten).toBe(0);
    expect(worksheet.getRow(2).getCell(COLUMNS.tarief).value).toBe(364);
  });

  /*
   * NOT_DISTRIBUTABLE keeps a planned write only when the line's EK alone
   * could not be placed: its transport prices (`reconcileLine`). Without one,
   * it writes nothing.
   */
  it("writes a NOT_DISTRIBUTABLE row's transport price, and nothing when it carries no write", () => {
    const planned = correction(2, InvoicePricingStatus.NOT_DISTRIBUTABLE);
    const withoutWrite = {
      ...correction(3, InvoicePricingStatus.NOT_DISTRIBUTABLE),
      differences: correction(3, InvoicePricingStatus.NOT_DISTRIBUTABLE).differences.map((difference) => ({
        ...difference,
        correctedValue: null,
        write: null,
      })),
    };

    const written = writer.apply(workbook, worksheet, sheetOf([2, 3]), new Map([[2, planned], [3, withoutWrite]]));

    expect(written.cellsWritten).toBe(1);
    expect(worksheet.getRow(2).getCell(COLUMNS.tarief).value).toBe(370);
    expect(worksheet.getRow(3).getCell(COLUMNS.tarief).value).toBe(364);
  });

  it("writes nothing for a row the check said nothing about", () => {
    const written = writer.apply(workbook, worksheet, sheetOf([2, 3]), new Map());

    expect(written.cellsWritten).toBe(0);
    expect(worksheet.getRow(3).getCell(COLUMNS.tarief).value).toBe(364);
  });

  it("asks Excel to recalculate once something changed", () => {
    writer.apply(
      workbook,
      worksheet,
      sheetOf([2]),
      new Map([[2, correction(2, InvoicePricingStatus.PRICING_CORRECTED)]]),
    );

    expect(workbook.calcProperties.fullCalcOnLoad).toBe(true);
  });

  /**
   * A line whose amounts did not go up can still need a cell rewritten — a
   * Fuel formula frozen to the amount it shows (`KEEP_AMOUNT`). The planned
   * write is carried out; a difference without one never is.
   */
  it.each([
    InvoicePricingStatus.MATCHED_NO_CHANGES,
    InvoicePricingStatus.INVOICE_HIGHER,
  ])("carries out a planned write on a row that is %s", (status) => {
    const written = writer.apply(
      workbook,
      worksheet,
      sheetOf([2]),
      new Map([[2, correction(2, status)]]),
    );

    expect(written.cellsWritten).toBe(1);
  });

  it("never writes a difference that only reports", () => {
    const reported = correction(2, InvoicePricingStatus.INVOICE_HIGHER);
    const written = writer.apply(
      workbook,
      worksheet,
      sheetOf([2]),
      new Map([
        [
          2,
          {
            ...reported,
            differences: reported.differences.map((difference) => ({
              ...difference,
              kind: "INVOICE_HIGHER" as const,
              correctedValue: null,
              write: null,
            })),
          },
        ],
      ]),
    );

    expect(written.cellsWritten).toBe(0);
    expect(worksheet.getRow(2).getCell(COLUMNS.tarief).value).toBe(364);
    expect(workbook.calcProperties.fullCalcOnLoad).toBeUndefined();
  });
});
