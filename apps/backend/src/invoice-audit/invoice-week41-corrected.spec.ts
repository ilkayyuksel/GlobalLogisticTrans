import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import ExcelJS from "exceljs";
import { Prisma, Trip } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { reliablyPriced } from "./__fixtures__/invoice-pricing";
import { invoiceReads } from "./__fixtures__/invoice-reads";
import { tripRecord } from "./__fixtures__/invoice-rows";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";
import { buildInvoiceAuditService } from "./__fixtures__/invoice-audit-service";

/**
 * The customer's week 41 invoice, corrected — on a COPY in memory.
 *
 * The file on disk is only read, and its hash is checked at the end. The
 * database is a double: every line of the invoice is a finished Trip of its
 * own, none of them grouped, every one priced at nothing (so nothing is ever
 * raised) and every Cost Confirmation line names a confirmation of its own
 * line's amount. What changes in the document is therefore exactly what phase
 * 3 decides on its own: the 13 Combinations the Excel marks are GEEN COMBI.
 *
 * What it proves: every cell that changed is one this check planned — a
 * Backload removed and Remarks completed on those 26 lines — and no other cell,
 * value or style, moved.
 */
const WEEK_41 = resolve(__dirname, "../../../../docs/07-excels/week 41 - 2026 GLT.xlsx");
const describeWithWeek41 = existsSync(WEEK_41) ? describe : describe.skip;
const COLUMN = { backload: 14, remarks: 21 } as const;
const TOTALS_ROW = 128;
const MISSING_ID = "missing-41";

describeWithWeek41("the real week 41 invoice, corrected on a copy", () => {
  /** I4 — taken before the first test and compared after the last. */
  let hashBeforeTheSuite: string;

  beforeAll(() => {
    hashBeforeTheSuite = createHash("sha256").update(readFileSync(WEEK_41)).digest("hex");
  });

  afterAll(() => {
    expect(createHash("sha256").update(readFileSync(WEEK_41)).digest("hex")).toBe(hashBeforeTheSuite);
  });

  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as AppLoggerService;
  const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

  async function correctACopy(missing: readonly Trip[] = []) {
    const original = readFileSync(WEEK_41);
    const sheet = await new InvoiceSheetReader(logger).read(Buffer.from(original), "week 41 - 2026 GLT.xlsx");
    const tripOf = new Map<number, Trip>(
      sheet.rows.map((row) => [
        row.rowNumber,
        tripRecord({
          id: `line-${row.rowNumber}`,
          planningDate: new Date(`${row.planningDate}T00:00:00.000Z`),
          originalPlanningDate: new Date(`${row.planningDate}T00:00:00.000Z`),
          bookingNumber: row.bookingNumber,
          containerNumber: row.normalizedContainerNumber || "TLLU1609235",
        }),
      ]),
    );
    const transports = sheet.rows.filter((row) => row.costLine === null);
    const costLines = sheet.rows.filter((row) => row.costLine !== null);
    const reads = invoiceReads();

    reads.findCostConfirmationsByNumbers.mockResolvedValue(
      costLines.map((row) => ({
        tripId: tripOf.get(row.rowNumber)!.id,
        ccNumber: row.costLine!.ccNumbers[0],
        amount: row.amounts.ek!.value!,
      })),
    );
    reads.findTripsByIds.mockResolvedValue(costLines.map((row) => tripOf.get(row.rowNumber)!));

    const trips = {
      findManyForInvoice: jest.fn().mockResolvedValue(transports.map((row) => tripOf.get(row.rowNumber)!)),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue(missing),
      setPaidMany: jest.fn(async (ids: readonly string[]) => ids.length),
    };
    const zero = new Prisma.Decimal(0);
    const effective = {
      findForTrips: jest.fn(async (ids: readonly string[]) =>
        new Map(
          ids.map((id) => [
            id,
            reliablyPriced({
              components: [],
              tarief: id === MISSING_ID ? new Prisma.Decimal(200) : zero,
              brandstof: zero,
              backload: zero,
              tol: zero,
              tunnel: zero,
              others: zero,
              ek: zero,
              totaal: id === MISSING_ID ? new Prisma.Decimal(200) : zero,
            }),
          ]),
        ),
      ),
    } as unknown as EffectivePricingService;

    const service = buildInvoiceAuditService({
      trips,
      effectivePricing: effective,
      logger,
      reads,
    });
    const applied = await service.apply({
      buffer: Buffer.from(original),
      originalname: "week 41 - 2026 GLT.xlsx",
      size: original.length,
    });
    // The corrected file, uploaded again against the same database.
    const again = (corrected: Buffer) =>
      service.apply({ buffer: corrected, originalname: "week 41 - 2026 GLT - gecorrigeerd.xlsx", size: corrected.length });

    return { original, applied, again };
  }

  async function firstSheet(bytes: Buffer): Promise<ExcelJS.Worksheet> {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ArrayBuffer);

    return book.worksheets[0];
  }

  it("changes exactly the planned cells: the Backload and Remarks of the 26 GEEN COMBI lines", async () => {
    const { original, applied } = await correctACopy();
    const before = await firstSheet(original);
    const after = await firstSheet(applied.workbook);
    const geenCombiRows = applied.result.rows
      .filter((row) => row.combination?.verdict === "GEEN_COMBI")
      .map((row) => row.rowNumber);
    const planned = new Set(
      geenCombiRows.flatMap((rowNumber) => [`${rowNumber}:${COLUMN.backload}`, `${rowNumber}:${COLUMN.remarks}`]),
    );
    const changed: string[] = [];

    // Every line and the header. The totals row and the summary are checked on
    // their own below: their cached results rightly follow the removed Backloads.
    for (let rowNumber = 1; rowNumber < TOTALS_ROW; rowNumber += 1) {
      for (let column = 1; column <= 21; column += 1) {
        const was = before.getRow(rowNumber).getCell(column);
        const is = after.getRow(rowNumber).getCell(column);

        // Compared as values, not as text: a save may write a style's keys in
        // another order without changing anything.
        if (!isDeepStrictEqual(was.value, is.value) || !isDeepStrictEqual(was.style, is.style)) {
          changed.push(`${rowNumber}:${column}`);
        }
      }
    }

    expect(geenCombiRows).toHaveLength(26);
    expect(applied.rowsMarked).toBe(0);
    expect(changed.filter((address) => !planned.has(address))).toEqual([]);
    expect(changed.sort()).toEqual([...planned].sort());
    // R3 / R4: out to Lessines, back from Harnes.
    expect(after.getRow(3).getCell(COLUMN.remarks).value).toBe("GEEN COMBI");
    expect(after.getRow(4).getCell(COLUMN.remarks).value).toBe("tar,EC 4220979,GEEN COMBI");
    expect(after.getRow(4).getCell(COLUMN.backload).value).toBeNull();
  });

  /** 26 Backloads of 50 removed: the Backload total goes from 1300 to 0. */
  it("keeps the totals as formulas, their results following the change", async () => {
    const { applied } = await correctACopy();
    const after = await firstSheet(applied.workbook);
    const total = (address: string) => after.getCell(address).value as { formula: string; result: number };

    // ExcelJS stores no cached result of exactly 0; Excel recalculates on open.
    expect(total("N128").formula).toBe("SUM(N2:N127)");
    expect(total("N128").result ?? 0).toBe(0);
    expect(total("L128")).toMatchObject({ formula: "SUM(L2:L127)", result: 29210.3 });
    expect(total("U128").formula).toBe("SUM(L128:T128)");
    expect(total("L132").formula).toBe("N128");
    expect(total("L132").result ?? 0).toBe(0);
    expect(applied.cellsWritten).toBe(26);
  });

  it("finds the totals sound, and leaves the Fuel header as the customer wrote it", async () => {
    const { applied } = await correctACopy();

    expect(applied.result.totalsStructure).toEqual({ sound: true, problems: [] });
    expect(applied.result.fuelHeader).toBeNull();
  });

  /** One forgotten transport: room opens at 128, everything below moves one down. */
  it("adds a forgotten transport above the totals, which grow over it", async () => {
    const { applied } = await correctACopy([
      tripRecord({
        id: MISSING_ID,
        planningDate: new Date("2026-10-06T00:00:00.000Z"),
        originalPlanningDate: new Date("2026-10-06T00:00:00.000Z"),
        bookingNumber: "ANRDUB2899999",
        containerNumber: "TLLU1999999",
        startTime: null,
        containerType: "45PH",
      }),
    ]);
    const after = await firstSheet(applied.workbook);
    const formulaAt = (address: string) => after.getCell(address).formula;

    expect(applied.rowsAdded).toBe(1);
    expect(applied.result.missingTrips[0].rowNumber).toBe(TOTALS_ROW);
    expect(after.getCell(`E${TOTALS_ROW}`).value).toBe("ANRDUB2899999");
    expect(after.getCell(`L${TOTALS_ROW}`).value).toBe(200);
    expect(formulaAt("L129")).toBe("SUM(L2:L128)");
    expect(formulaAt("U129")).toBe("SUM(L129:T129)");
    expect(formulaAt("L133")).toBe("N129");
  });

  /** I1 — the corrected file, checked again, needs nothing more. */
  it("changes nothing more when the corrected file is processed again", async () => {
    const { applied, again } = await correctACopy();
    const second = await again(applied.workbook);

    expect(second.cellsWritten).toBe(0);
    expect(second.rowsAdded).toBe(0);
    expect(second.rowsMarked).toBe(0);
    expect(second.result.rows.filter((row) => (row.remarks?.added.length ?? 0) > 0)).toEqual([]);
    expect(second.result.fuelHeader).toBeNull();
  });

  it("leaves the file on disk exactly as it was", async () => {
    const before = sha256(readFileSync(WEEK_41));

    await correctACopy();

    expect(sha256(readFileSync(WEEK_41))).toBe(before);
  });
});
