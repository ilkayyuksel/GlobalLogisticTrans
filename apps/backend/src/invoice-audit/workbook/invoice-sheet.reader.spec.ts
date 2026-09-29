import { AppLoggerService } from "../../logger/app-logger.service";
import {
  buildInvoiceWorkbook,
  INVOICE_HEADERS,
} from "../__fixtures__/invoice-workbook";
import {
  InvoiceColumnsMissingException,
  UnreadableInvoiceWorkbookException,
} from "../exceptions/invoice-audit.exceptions";
import { InvoiceSheetReader } from "./invoice-sheet.reader";

/**
 * Reading a customer's weekly invoice.
 *
 * ── WHAT THIS GUARDS ────────────────────────────────────────────────────────
 * The reader decides what counts as an invoice LINE, and everything downstream
 * trusts that answer: a totals row read as a transport would be matched, found
 * missing and eventually reported as an unpaid trip nobody drove.
 *
 * So these tests are mostly about what must NOT become a line — the totals row,
 * the summary block, a blank line — and about the row numbers, which are what
 * the corrected document will later be written into.
 */

const LINE = {
  planningDate: new Date(Date.UTC(2026, 2, 23)),
  bookingNumber: "DUBANR2718284",
  containerNumber: "EUCU 4581604",
  tarief: 135,
};

describe("InvoiceSheetReader", () => {
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let reader: InvoiceSheetReader;

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    reader = new InvoiceSheetReader(logger as unknown as AppLoggerService);
  });

  describe("the workbook itself", () => {
    it("reads a valid invoice", async () => {
      const file = await buildInvoiceWorkbook({ lines: [LINE] });

      const sheet = await reader.read(file, "week 13 - 2026 GLT.xlsx");

      expect(sheet.sheetName).toBe("Sheet1");
      expect(sheet.headerRowNumber).toBe(1);
      expect(sheet.rows).toHaveLength(1);
    });

    it("refuses a file that is not a workbook at all", async () => {
      await expect(
        reader.read(Buffer.from("this is not a workbook"), "notes.txt"),
      ).rejects.toBeInstanceOf(UnreadableInvoiceWorkbookException);
    });

    /** A .xlsx is a ZIP; a truncated one opens as neither. */
    it("refuses a truncated workbook", async () => {
      const file = await buildInvoiceWorkbook({ lines: [LINE] });

      await expect(
        reader.read(file.subarray(0, 200), "week 13.xlsx"),
      ).rejects.toBeInstanceOf(UnreadableInvoiceWorkbookException);
    });
  });

  describe("recognising the columns", () => {
    it("reads them by header text rather than by position", async () => {
      // Two columns the check does not read, inserted before the ones it does.
      const headers = ["Reference", "Cost centre", ...INVOICE_HEADERS];
      const file = await buildInvoiceWorkbook({ lines: [LINE], headers });

      const sheet = await reader.read(file, "shifted.xlsx");

      // Nothing is read from the shifted columns, so the fixture's own values
      // land elsewhere; what matters is that the header row was understood.
      expect(sheet.columns.planningDate).toBe(3);
      expect(sheet.columns.bookingNumber).toBe(7);
      expect(sheet.columns.ek).toBe(22);
    });

    it("recognises the Fuel column whatever percentage it charges", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [LINE],
        fuelPercentage: 12.5,
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.columns.fuel).toBe(13);
    });

    it("refuses a workbook missing a required column, and names it", async () => {
      const headers = INVOICE_HEADERS.filter((header) => header !== "Tol B");
      const file = await buildInvoiceWorkbook({ lines: [LINE], headers });

      await expect(reader.read(file, "week 13.xlsx")).rejects.toMatchObject({
        response: { details: ["missing column: Tol B"] },
      });
    });

    it("names every missing column at once", async () => {
      const headers = INVOICE_HEADERS.filter(
        (header) => header !== "Bookingnr" && header !== "EK",
      );
      const file = await buildInvoiceWorkbook({ lines: [LINE], headers });

      await expect(reader.read(file, "week 13.xlsx")).rejects.toMatchObject({
        response: {
          details: ["missing column: Bookingnr", "missing column: EK"],
        },
      });
    });

    it("refuses a sheet with no header row at all", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [LINE],
        headers: ["a", "b", "c"],
      });

      await expect(reader.read(file, "week 13.xlsx")).rejects.toBeInstanceOf(
        InvoiceColumnsMissingException,
      );
    });

    /** A title above the header is ordinary in a sheet a human maintains. */
    it("finds a header row below a title row", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [LINE],
        rowsAboveHeader: [["Weekfactuur GLT"], []],
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.headerRowNumber).toBe(3);
      expect(sheet.rows[0].rowNumber).toBe(4);
    });
  });

  describe("which rows are transports", () => {
    it("keeps each line's own Excel row number", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [LINE, { ...LINE, bookingNumber: "ANRDUB2725107" }],
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
    });

    /**
     * ── THE ROW THAT LOOKS MOST LIKE DATA ───────────────────────────────────
     * The totals row carries money in every amount column. It is not a
     * transport, it states no booking and no container, and counting it as one
     * would invent a line the customer never sent.
     */
    it("does not read the totals row as a transport", async () => {
      const file = await buildInvoiceWorkbook({ lines: [LINE] });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows).toHaveLength(1);
      expect(sheet.totalsRowNumber).toBe(3);
      expect(sheet.rows.map((row) => row.rowNumber)).not.toContain(3);
    });

    it("does not read the summary block as transports", async () => {
      const file = await buildInvoiceWorkbook({ lines: [LINE, LINE] });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows).toHaveLength(2);
      // Ten labels, after the totals row and the blank line beneath it.
      expect(sheet.summaryRowNumbers).toHaveLength(10);
      expect(sheet.summaryRowNumbers.every((row) => row > sheet.totalsRowNumber!)).toBe(
        true,
      );
    });

    it("reports a row that states too little to be a transport", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [LINE],
        // A booking with no date and no container: not a line, not nothing.
        incompleteLines: [[null, "GLT", null, null, "ANRDUB2725107"]],
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows).toHaveLength(1);
      expect(sheet.incompleteRowNumbers).toEqual([3]);
    });
  });

  describe("the planning date", () => {
    it("reads a real Excel date cell", async () => {
      const file = await buildInvoiceWorkbook({ lines: [LINE] });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows[0].planningDate).toBe("2026-03-23");
    });

    it("reads a date written as text", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [{ ...LINE, planningDate: "2026-03-24" }],
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows[0].planningDate).toBe("2026-03-24");
    });

    /** Excel's own serial, as another system's export writes it. */
    it("reads a date written as an Excel serial number", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [{ ...LINE, planningDate: 46106 }],
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows[0].planningDate).toBe("2026-03-25");
    });

    it("keeps different days apart", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [
          LINE,
          { ...LINE, planningDate: new Date(Date.UTC(2026, 2, 27)) },
        ],
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows.map((row) => row.planningDate)).toEqual([
        "2026-03-23",
        "2026-03-27",
      ]);
    });

    /** A day nobody can read is not guessed at: the row is not a line. */
    it("does not read an unreadable date as a transport", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [{ ...LINE, planningDate: "vorige week" }],
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows).toHaveLength(0);
      expect(sheet.incompleteRowNumbers).toEqual([2]);
    });
  });

  describe("the container number", () => {
    it("keeps the sheet's own spelling and adds the normalised one", async () => {
      const file = await buildInvoiceWorkbook({ lines: [LINE] });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows[0].containerNumber).toBe("EUCU 4581604");
      expect(sheet.rows[0].normalizedContainerNumber).toBe("EUCU4581604");
    });
  });

  describe("lines sharing one key", () => {
    /**
     * A weekly invoice prints one line per Cost Confirmation, each under the
     * booking and container of a transport that already has a line. They are
     * charges, not duplicates.
     */
    it("keeps both rows, each with its own row number", async () => {
      const file = await buildInvoiceWorkbook({
        lines: [
          LINE,
          { ...LINE, tarief: null, ek: 273.76, remarks: "EC 3631683" },
          { ...LINE, tarief: null, ek: 27.5, remarks: "EC 3640867" },
        ],
      });

      const sheet = await reader.read(file, "week 13.xlsx");

      expect(sheet.rows).toHaveLength(3);
      expect(sheet.rows.map((row) => row.rowNumber)).toEqual([2, 3, 4]);
      expect(
        new Set(sheet.rows.map((row) => row.normalizedContainerNumber)).size,
      ).toBe(1);
    });
  });
});
