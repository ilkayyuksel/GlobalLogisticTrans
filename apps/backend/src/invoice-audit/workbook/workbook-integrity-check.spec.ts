import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";

import { AppLoggerService } from "../../logger/app-logger.service";
import { buildInvoiceWorkbook } from "../__fixtures__/invoice-workbook";
import { markRowsYellow, markTextRed } from "./cell-marking";
import type { ChangePlan, PlannedCell } from "./change-plan";
import { openRowsAt } from "./invoice-row-inserter";
import { InvoiceSheetReader } from "./invoice-sheet.reader";
import { findUnplannedChanges } from "./workbook-integrity-check";

const MONDAY = new Date(Date.UTC(2026, 2, 23));
const SILENT = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as AppLoggerService;

/**
 * The written workbook held against its plan.
 *
 * Each test takes the same received document, changes a fresh copy of it the
 * way a writer might — rightly or wrongly — and asks the check what it sees.
 * Lines on 2–4, totals on 5, summary on 7–16.
 */
describe("findUnplannedChanges", () => {
  let received: Buffer;
  let sheetName: string;

  beforeAll(async () => {
    received = await buildInvoiceWorkbook({
      lines: [
        { planningDate: MONDAY, bookingNumber: "DUBANR2718284", containerNumber: "EUCU 4581604", tarief: 135, fuel: "formula" },
        { planningDate: MONDAY, bookingNumber: "BELANR2720016", containerNumber: "EUCU 2451828", tarief: 200, fuel: "formula" },
        { planningDate: MONDAY, bookingNumber: "ANRDUB2725107", containerNumber: "TLLU 1595717", tarief: 300, fuel: "formula" },
      ],
    });
    sheetName = (await new InvoiceSheetReader(SILENT).open(received, "w.xlsx")).sheet.sheetName;
  });

  /** The plan of a check that decided nothing — every difference is unplanned. */
  function nothingPlanned(overrides: Partial<ChangePlan> = {}): ChangePlan {
    return {
      opening: null,
      cells: new Map(),
      yellowRows: new Set(),
      lastColumnNumber: 21,
      totalsRows: new Set([5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
      addedRows: [],
      identityColumns: { bookingNumber: 5, containerNumber: 6 },
      structureSound: true,
      ...overrides,
    };
  }

  /** The received document, changed by `write`, as both are read from bytes. */
  async function problemsAfter(write: (sheet: ExcelJS.Worksheet) => void, plan: ChangePlan) {
    const original = await load(received);
    const copy = await load(received);

    write(copy.worksheets[0]);

    return findUnplannedChanges(original, await load(Buffer.from(await copy.xlsx.writeBuffer())), sheetName, plan);
  }

  const raisedTarief: PlannedCell = {
    reason: "Tarief RAISE",
    content: { kind: "WRITE", write: { kind: "VALUE", value: new Prisma.Decimal(150) } },
    red: true,
  };

  it("finds nothing in a document written back unchanged", async () => {
    expect(await problemsAfter(() => undefined, nothingPlanned())).toEqual([]);
  });

  it("accepts exactly a planned write, in red", async () => {
    const plan = nothingPlanned({ cells: new Map([["L2", raisedTarief]]) });

    expect(
      await problemsAfter((sheet) => {
        sheet.getCell("L2").value = 150;
        markTextRed(sheet.getCell("L2"));
      }, plan),
    ).toEqual([]);
  });

  it("refuses a value nobody planned", async () => {
    expect(await problemsAfter((sheet) => (sheet.getCell("L3").value = 210), nothingPlanned())).toEqual([
      "L3: waarde gewijzigd zonder plan.",
    ]);
  });

  it("refuses a planned cell that holds something else", async () => {
    const plan = nothingPlanned({ cells: new Map([["L2", raisedTarief]]) });

    expect(
      await problemsAfter((sheet) => {
        sheet.getCell("L2").value = 155;
        markTextRed(sheet.getCell("L2"));
      }, plan),
    ).toEqual(["L2: bevat niet wat gepland was (Tarief RAISE)."]);
  });

  it("refuses a planned raise that was not turned red", async () => {
    const plan = nothingPlanned({ cells: new Map([["L2", raisedTarief]]) });

    expect(await problemsAfter((sheet) => (sheet.getCell("L2").value = 150), plan)).toEqual([
      "L2: opmaak wijkt af van het plan (Tarief RAISE).",
    ]);
  });

  it("refuses a style nobody planned", async () => {
    expect(
      await problemsAfter((sheet) => {
        sheet.getCell("E3").style = { ...sheet.getCell("E3").style, font: { bold: true } };
      }, nothingPlanned()),
    ).toEqual(["E3: opmaak gewijzigd zonder plan."]);
  });

  it("accepts a planned yellow row, and refuses one nobody planned", async () => {
    const paint = (sheet: ExcelJS.Worksheet) => markRowsYellow(sheet, [3], 21);

    expect(await problemsAfter(paint, nothingPlanned({ yellowRows: new Set([3]) }))).toEqual([]);
    expect(await problemsAfter(paint, nothingPlanned())).toContain("A3: opvulkleur gewijzigd zonder plan.");
  });

  it("refuses a totals formula that changed", async () => {
    expect(
      await problemsAfter((sheet) => (sheet.getCell("N5").value = { formula: "SUM(N2:N3)", result: 0 }), nothingPlanned()),
    ).toEqual(["N5: formule of waarde van een totaalcel gewijzigd."]);
  });

  it("refuses a hidden column shown, and a merge added", async () => {
    const problems = await problemsAfter((sheet) => {
      sheet.getColumn(9).hidden = !sheet.getColumn(9).hidden;
      sheet.mergeCells("A18:B18");
    }, nothingPlanned());

    expect(problems).toEqual(expect.arrayContaining(["Kolom I: breedte of zichtbaarheid gewijzigd.", "Samengevoegde cellen gewijzigd."]));
  });

  /** I3 — a row inserted that the plan does not name moves everything below it. */
  it("refuses a row inserted without a plan", async () => {
    const problems = await problemsAfter((sheet) => openRowsAt(sheet, 3, 1), nothingPlanned());

    expect(problems.length).toBeGreaterThan(0);
    expect(problems).toContain("E3: waarde gewijzigd zonder plan.");
  });

  it("accepts the same opening once it is planned, with its line", async () => {
    const plan = nothingPlanned({
      opening: { fromRow: 5, count: 1 },
      totalsRows: new Set([6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
      addedRows: [
        { rowNumber: 5, tripId: "missing-1", bookingNumber: "BELANR2799999", containerNumber: "EUCU2999999", yellow: false },
      ],
    });
    const problems = await problemsAfter((sheet) => {
      openRowsAt(sheet, 5, 1);
      sheet.getCell("E5").value = "BELANR2799999";
      sheet.getCell("F5").value = "EUCU2999999";
      markTextRed(sheet.getCell("E5"));
      markTextRed(sheet.getCell("F5"));
    }, plan);

    // Everything but the record of the added line, which the writer keeps.
    expect(problems).toEqual(["Het register van toegevoegde regels vermeldt niet precies de toegevoegde regels."]);
  });
});

async function load(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);

  return workbook;
}
