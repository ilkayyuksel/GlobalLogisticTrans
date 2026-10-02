import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import ExcelJS from "exceljs";
import { Prisma, TripStatus } from "@prisma/client";

import { TripExportLabelsService } from "../trip-export/trip-export-labels.service";
import { AppLoggerService } from "../logger/app-logger.service";
import type { EffectivePricing } from "../trip-pricing/effective-pricing";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { TripRepository } from "../trips/trip.repository";
import { InvoiceAuditService } from "./invoice-audit.service";
import { InvoiceRowMatchingService } from "./matching/invoice-row-matching.service";
import { MissingTripsService } from "./missing/missing-trips.service";
import { InvoicePricingService } from "./pricing/invoice-pricing.service";
import { AUDIT_MARKER_SHEET } from "./workbook/invoice-audit-marker";
import { InvoiceSheetReader } from "./workbook/invoice-sheet.reader";
import { InvoiceSheetWriter } from "./workbook/invoice-sheet.writer";

/**
 * The customer's REAL weekly invoice through the corrected-workbook writer.
 *
 * ── WHY THE REAL FILE ───────────────────────────────────────────────────────
 * Its layout is what every rule here is about, and a fixture can only imitate
 * it: 98 lines, a totals row whose SUMs are ONE shared formula across eight
 * columns, a summary block reading the totals, eleven shared-formula groups in
 * the Fuel column, three hidden columns, and 25 cells the customer filled
 * yellow themselves. It is not in the repository — the figures are the
 * customer's — so this suite runs wherever a copy is present and is skipped
 * where it is not, exactly as the HTTP suite treats it.
 *
 * ── THE LAYOUT, BEFORE AND AFTER ────────────────────────────────────────────
 *   lines 2–99 · totals 100 · blank 101 · summary 102–111
 *   with two transports added:
 *   lines 2–99 · ADDED 100–101 · totals 102 · blank 103 · summary 104–113
 */
const REAL_INVOICE = resolve(
  __dirname,
  "../../../../docs/07-excels/week 13 - 2026 GLT.xlsx",
);

const YELLOW = "FFFFFF00";
const COLUMN = { booking: 5, container: 6, tarief: 12, fuel: 13, backload: 14, tolB: 16, tunnel: 18, others: 19, ek: 20, remarks: 21 } as const;
const LAST_LINE = 99;

const describeWithRealInvoice = existsSync(REAL_INVOICE) ? describe : describe.skip;

function pricing(amounts: Record<string, string>): EffectivePricing {
  const of = (key: string) => new Prisma.Decimal(amounts[key] ?? "0");

  return {
    components: [],
    tarief: of("tarief"),
    brandstof: of("brandstof"),
    backload: of("backload"),
    tol: of("tol"),
    tunnel: of("tunnel"),
    others: of("others"),
    ek: of("ek"),
    totaal: of("totaal"),
  };
}

/** Two finished, unpaid transports of week 13 the invoice never mentions. */
const MISSING = [
  {
    id: "missing-1",
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: new Date(Date.UTC(2026, 2, 25)),
    originalPlanningDate: new Date(Date.UTC(2026, 2, 25)),
    startTime: new Date("1970-01-01T08:30:00.000Z"),
    bookingNumber: "ANRDUB9990001",
    containerNumber: "EUCU1112223",
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "ZEMST",
    direction: "DELIVERY",
    tripGroupId: "group-1",
    distanceKm: new Prisma.Decimal("31"),
  },
  {
    id: "missing-2",
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: new Date(Date.UTC(2026, 2, 26)),
    originalPlanningDate: new Date(Date.UTC(2026, 2, 26)),
    startTime: null,
    bookingNumber: "ANRDUB9990002",
    containerNumber: "TLLU4445556",
    containerType: "20ST",
    terminal: "Quay 869",
    destinationCity: "KALLO",
    direction: "DELIVERY",
    tripGroupId: null,
    distanceKm: null,
  },
];

/** 13% of the Tarief — the percentage the real invoice's Fuel formulas use. */
const MISSING_PRICING = new Map([
  ["missing-1", pricing({ tarief: "200", brandstof: "26", backload: "50", tol: "12.5" })],
  ["missing-2", pricing({ tarief: "150", brandstof: "19.5" })],
]);

/** The export words: none unless a test supplies them. */
const exportLabels = { findForTrips: jest.fn(async () => new Map()) };

describeWithRealInvoice("the real week 13 invoice, corrected", () => {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  let original: ExcelJS.Worksheet;
  let originalBytes: Buffer;

  beforeAll(async () => {
    originalBytes = readFileSync(REAL_INVOICE);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(originalBytes as unknown as ArrayBuffer);
    original = book.worksheets[0];
  });

  /**
   * The check, with a database holding a CLOSED Trip for every line of the
   * invoice except `problemBooking` — so exactly one line is a problem — and
   * the given transports missing from it.
   */
  async function run(
    bytes: Buffer,
    options: { problemBooking?: string | null; missing?: typeof MISSING; paidIds?: string[] } = {},
  ) {
    const sheet = await new InvoiceSheetReader(logger).read(bytes, "week 13 - 2026 GLT.xlsx");
    const lines = sheet.rows
      .filter((row) => row.bookingNumber !== (options.problemBooking ?? null))
      .map((row, index) => ({
        id: `line-${index}`,
        status: TripStatus.CLOSED,
        isPaid: (options.paidIds ?? []).includes(`line-${index}`),
        planningDate: new Date(`${row.planningDate}T00:00:00.000Z`),
        originalPlanningDate: new Date(`${row.planningDate}T00:00:00.000Z`),
        bookingNumber: row.bookingNumber,
        containerNumber: row.normalizedContainerNumber,
      }));
    const missing = options.missing ?? MISSING;
    const trips = {
      findManyForInvoice: jest.fn().mockResolvedValue(lines),
      findClosedUnpaidBetween: jest.fn().mockResolvedValue(missing),
      setPaidMany: jest.fn(async (ids: readonly string[]) => ids.length),
    };
    const effective = {
      // Only the missing transports are priced: no line of the invoice is
      // corrected, so every difference below is the writer's own doing.
      findForTrips: jest.fn(async (ids: readonly string[]) =>
        new Map(ids.filter((id) => MISSING_PRICING.has(id)).map((id) => [id, MISSING_PRICING.get(id)!])),
      ),
    };

    const service = new InvoiceAuditService(
      new InvoiceSheetReader(logger),
      new InvoiceRowMatchingService(trips as unknown as TripRepository, logger),
      new InvoicePricingService(effective as unknown as EffectivePricingService, logger),
      new MissingTripsService(
        trips as unknown as TripRepository,
        effective as unknown as EffectivePricingService,
        exportLabels as unknown as TripExportLabelsService,
        logger,
      ),
      new InvoiceSheetWriter(logger),
      trips as unknown as TripRepository,
      logger,
    );

    return service.apply({ buffer: bytes, originalname: "week 13 - 2026 GLT.xlsx", size: bytes.length });
  }

  async function load(bytes: Buffer) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ArrayBuffer);

    return book;
  }

  /** Written, read, written again and read again — what a re-saved file is. */
  async function roundTripped(bytes: Buffer) {
    const once = await load(bytes);

    return load(Buffer.from(await once.xlsx.writeBuffer()));
  }

  const isYellow = (cell: ExcelJS.Cell) =>
    (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb === YELLOW;

  function yellowAddresses(sheet: ExcelJS.Worksheet): Set<string> {
    const found = new Set<string>();

    sheet.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (isYellow(cell)) found.add(cell.address);
      }),
    );

    return found;
  }

  const formulaAt = (sheet: ExcelJS.Worksheet, address: string) =>
    (sheet.getCell(address).value as { formula?: string } | null)?.formula ?? null;
  const resultAt = (sheet: ExcelJS.Worksheet, address: string) =>
    (sheet.getCell(address).value as { result?: number } | null)?.result;

  // ── THE YELLOW ──────────────────────────────────────────────────────────────

  describe("yellow", () => {
    /** B — one problem line paints one line, not the workbook. */
    it("paints only the problem line, not the whole workbook", async () => {
      const problem = original.getRow(50).getCell(COLUMN.booking).value as string;
      const applied = await run(originalBytes, { problemBooking: problem, missing: [] });
      const sheet = (await load(applied.workbook)).worksheets[0];

      expect(applied.rowsMarked).toBe(1);

      const before = yellowAddresses(original);
      const after = yellowAddresses(sheet);
      const added = [...after].filter((address) => !before.has(address));

      // Every NEW yellow cell is on row 50, and there are only a row's worth.
      expect(added.length).toBeGreaterThan(0);
      expect(added.every((address) => /^[A-Z]+50$/.test(address))).toBe(true);
      expect(after.size).toBeLessThan(before.size + 30);
    });

    /** C — the customer's own yellow stays exactly where they put it. */
    it("keeps every cell the customer filled yellow themselves", async () => {
      const applied = await run(originalBytes, { problemBooking: null });
      const sheet = (await load(applied.workbook)).worksheets[0];

      for (const address of yellowAddresses(original)) {
        expect(isYellow(sheet.getCell(address))).toBe(true);
      }
    });

    /** A — an ordinary line keeps its formatting exactly. */
    it("leaves an ordinary line's formatting exactly as it was", async () => {
      const applied = await run(originalBytes, { problemBooking: null });
      const sheet = (await load(applied.workbook)).worksheets[0];

      for (const rowNumber of [3, 40, LAST_LINE]) {
        for (let column = 1; column <= 21; column += 1) {
          expect(sheet.getRow(rowNumber).getCell(column).style).toEqual(
            original.getRow(rowNumber).getCell(column).style,
          );
        }
      }
    });
  });

  // ── WHERE THE ADDED LINES GO ───────────────────────────────────────────────

  describe("the added transports", () => {
    /** E + F — directly below the last line, directly above the totals. */
    it("sits directly below the last line and directly above the totals", async () => {
      const applied = await run(originalBytes);
      const sheet = (await load(applied.workbook)).worksheets[0];

      expect(applied.result.missingTrips.map((trip) => trip.rowNumber)).toEqual([100, 101]);
      expect(sheet.getRow(LAST_LINE).getCell(COLUMN.booking).value).toBe(
        original.getRow(LAST_LINE).getCell(COLUMN.booking).value,
      );
      expect(sheet.getRow(100).getCell(COLUMN.booking).value).toBe("ANRDUB9990001");
      expect(sheet.getRow(101).getCell(COLUMN.booking).value).toBe("ANRDUB9990002");
      expect(formulaAt(sheet, "L102")).toBe("SUM(L2:L101)");
    });

    /** G — the summary block follows the totals, unchanged in content. */
    it("keeps the summary block below the totals, every label in place", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];

      for (let offset = 0; offset < 10; offset += 1) {
        expect(sheet.getRow(104 + offset).getCell(11).value).toBe(
          original.getRow(102 + offset).getCell(11).value,
        );
      }
      // Nothing under the summary block any more.
      expect(sheet.getRow(115).getCell(COLUMN.booking).value).toBeNull();
    });

    /** D — the look of an ordinary line, and no problem colour. */
    it("takes the look of an ordinary line, not a highlighted one", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];
      const added = sheet.getRow(100);

      for (let column = 1; column <= 21; column += 1) {
        expect(isYellow(added.getCell(column))).toBe(false);
      }
      expect(added.getCell(COLUMN.tarief).numFmt).toBe(original.getRow(40).getCell(COLUMN.tarief).numFmt);
      expect(added.getCell(COLUMN.booking).font).toEqual(original.getRow(40).getCell(COLUMN.booking).font);
    });

    /** 7 — the effective pricing, and the document's own Fuel convention. */
    it("writes this system's pricing, and Fuel as the document's 13% formula", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];

      expect(sheet.getCell("L100").value).toBe(200);
      expect(formulaAt(sheet, "M100")).toBe("13%*L100");
      expect(sheet.getCell("N100").value).toBe(50);
      expect(sheet.getCell("P100").value).toBe(12.5);
    });

    /** P — a component costing nothing is an empty cell, never a written 0. */
    it("leaves every zero component empty", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];

      for (const address of ["R100", "S100", "T100", "N101", "P101", "R101", "S101", "T101", "O100", "Q100"]) {
        expect(sheet.getCell(address).value).toBeNull();
      }
    });
  });

  // ── THE TOTALS ─────────────────────────────────────────────────────────────

  describe("the totals", () => {
    /** H — every original line and every added one, each once. */
    it("covers every original and added line, exactly", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];

      let originalTarief = new Prisma.Decimal(0);
      for (let rowNumber = 2; rowNumber <= LAST_LINE; rowNumber += 1) {
        originalTarief = originalTarief.plus(
          (original.getRow(rowNumber).getCell(COLUMN.tarief).value as number | null) ?? 0,
        );
      }

      expect(formulaAt(sheet, "L102")).toBe("SUM(L2:L101)");
      expect(resultAt(sheet, "L102")).toBe(Number(originalTarief.plus(350).toFixed(2)));

      for (const column of ["M", "N", "O", "P", "Q", "R", "S", "T"]) {
        expect(formulaAt(sheet, `${column}102`)).toBe(`SUM(${column}2:${column}101)`);
      }
      expect(formulaAt(sheet, "U102")).toBe("SUM(L102:T102)");
    });

    /** The grand total adds up what the columns add up to. */
    it("keeps the grand total equal to the sum of the column totals", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];

      const columns = ["L", "M", "N", "O", "P", "Q", "R", "S", "T"]
        .map((column) => resultAt(sheet, `${column}102`) ?? 0)
        .reduce((total, amount) => total.plus(amount), new Prisma.Decimal(0));

      expect(resultAt(sheet, "U102")).toBe(Number(columns.toFixed(2)));
    });

    /** I — the summary reads the totals where they now are. */
    it("points the summary block at the moved totals", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];

      expect(formulaAt(sheet, "L104")).toBe("L102");
      expect(formulaAt(sheet, "L105")).toBe("M102");
      expect(formulaAt(sheet, "L113")).toBe("U102");
      expect(resultAt(sheet, "L104")).toBe(resultAt(sheet, "L102"));
      expect(resultAt(sheet, "L113")).toBe(resultAt(sheet, "U102"));
    });

    /** P — a total of nothing prints as nothing; every other section is kept. */
    it("shows a zero total as nothing, keeping the rest of the format", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];
      const customer = original.getCell("L102").numFmt.split(";");

      expect(sheet.getCell("L106").numFmt.split(";")).toEqual([customer[0], customer[1], "", customer[3]]);
    });

    /** The invoice's own Fuel formulas, above the opening, stay formulas. */
    it("leaves the lines' own Fuel formulas as formulas", async () => {
      const sheet = (await load((await run(originalBytes)).workbook)).worksheets[0];

      expect(sheet.getCell("M2").formula).toBe("13%*L2");
      expect(sheet.getCell("M99").formula).toBe("13%*L99");
    });
  });

  // ── THE FILE ITSELF ────────────────────────────────────────────────────────

  describe("the file", () => {
    /** J + K — formulas, layout and marker survive two full round trips. */
    it("survives save, read, save, read with formulas and marker intact", async () => {
      const book = await roundTripped((await run(originalBytes)).workbook);
      const sheet = book.worksheets[0];

      expect(formulaAt(sheet, "L102")).toBe("SUM(L2:L101)");
      expect(formulaAt(sheet, "L113")).toBe("U102");
      expect(formulaAt(sheet, "M100")).toBe("13%*L100");
      expect(sheet.columns.filter((column) => column.hidden).map((column) => column.letter)).toEqual(["I", "O", "Q"]);
      expect(book.getWorksheet(AUDIT_MARKER_SHEET)?.state).toBe("veryHidden");
    });

    /** R — the added lines are recognised on re-upload and nothing is added twice. */
    it("recognises its own lines on the next upload, adding nothing twice", async () => {
      const first = await run(originalBytes);
      const again = await run(first.workbook, { missing: [] });

      expect(again.rowsAdded).toBe(0);
      expect(
        again.result.rows.filter((row) => row.status === "ADDED_MISSING").map((row) => row.rowNumber),
      ).toEqual([100, 101]);
      expect(again.paidTripIds).not.toContain("missing-1");
      expect(again.paidTripIds).not.toContain("missing-2");
    });

    /**
     * R, again — a later run adding ANOTHER transport opens room below the
     * first run's lines; their records are untouched and still recognised.
     */
    it("adds a later transport below the earlier added ones, records intact", async () => {
      const first = await run(originalBytes);
      const later = {
        ...MISSING[1],
        id: "missing-3",
        bookingNumber: "ANRDUB9990003",
        containerNumber: "MSKU7778889",
      };
      const second = await run(first.workbook, { missing: [later] });
      const sheet = (await load(second.workbook)).worksheets[0];

      expect(second.result.missingTrips.map((trip) => trip.rowNumber)).toEqual([102]);
      expect(sheet.getRow(102).getCell(COLUMN.booking).value).toBe("ANRDUB9990003");
      expect(formulaAt(sheet, "L103")).toBe("SUM(L2:L102)");
      expect(
        second.result.rows.filter((row) => row.status === "ADDED_MISSING").map((row) => row.rowNumber),
      ).toEqual([100, 101]);

      const third = await run(second.workbook, { missing: [] });

      expect(
        third.result.rows.filter((row) => row.status === "ADDED_MISSING").map((row) => row.rowNumber),
      ).toEqual([100, 101, 102]);
    });
  });
});
