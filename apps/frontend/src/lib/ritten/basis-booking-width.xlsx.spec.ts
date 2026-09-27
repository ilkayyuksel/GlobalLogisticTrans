import ExcelJS from "exceljs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BasicExportRow } from "./export-rows";
import { buildBasicWorkbook } from "./export-workbooks";

/**
 * The BASIS export: the width of the BOEKING column.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * The column carried the reference workbook's width of 9.63, and a booking number
 * such as `ANRBEL2801529` is thirteen characters: squeezed against the cell edge,
 * and a booking number that cannot be read is the one thing this sheet exists to
 * carry. A larger fixed width would only move the problem to the first longer
 * number, so the width follows the content.
 *
 * ── AND WHAT MUST NOT CHANGE ────────────────────────────────────────────────
 * Every other width is the reference's, measured off the sheet the office has
 * printed for years — a dispatcher finds a value by its POSITION long before they
 * read a header, so moving a column costs real time at a real desk. These tests
 * assert the other eight widths cell by cell, because "only one column changed"
 * is a claim worth checking rather than promising.
 *
 * ── READ BACK FROM A REAL FILE ──────────────────────────────────────────────
 * Every assertion is made against an `.xlsx` written to disk and reopened, so what
 * is measured is what Excel would open — not what the builder intended.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The reference layout, as it stands in the workbook this export copies. */
const REFERENCE_WIDTHS = [
  8.7265625, // NR PLAAT
  8.7265625, // TIJD
  8.7265625, // TIJD
  9.6328125, // BOEKING — the only one that may move
  8.7265625, // TYPE
  11.54296875, // CONT NR
  19.6328125, // PLAATS
  25.90625, // COMBI EN KOST
  41, // INFO
];

/** Column D of the reference layout. */
const BOOKING_COLUMN = 4;

/** The slack the reference gives a column beyond the characters it holds. */
const MARGIN = 0.54296875;

function row(overrides: Partial<BasicExportRow> = {}): BasicExportRow {
  return {
    tripGroupId: null,
    licensePlate: "1-ABC-123",
    startTime: "08:00",
    endTime: "12:30",
    bookingNumber: "ANRBEL2801529",
    containerType: "40HC",
    containerNumber: "EUCU1451295",
    trip: "Quay 869 → Kallo",
    costs: "",
    info: "",
    ...overrides,
  };
}

/** The finished workbook, written to disk and reopened. */
async function sheetOf(rows: readonly BasicExportRow[]) {
  const buffer = await buildBasicWorkbook(rows, "nl", {
    start: "2026-10-01",
    end: "2026-10-01",
  });

  const directory = await mkdtemp(join(tmpdir(), "trano-booking-width-"));
  const file = join(directory, "basis.xlsx");

  await writeFile(file, Buffer.from(buffer));

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(
    (await readFile(file)) as unknown as Parameters<
      typeof reopened.xlsx.load
    >[0],
  );

  return reopened.worksheets[0];
}

/** The width Excel would apply to one column of the reopened file. */
async function widthOf(
  rows: readonly BasicExportRow[],
  column = BOOKING_COLUMN,
): Promise<number> {
  const sheet = await sheetOf(rows);

  return sheet.getColumn(column).width as number;
}

describe("the BOEKING column's width", () => {
  /**
   * The number the complaint was about. Thirteen characters, which needs more
   * than the reference's 9.63.
   */
  it("fits a normal booking number", async () => {
    const width = await widthOf([row({ bookingNumber: "ANRBEL2801529" })]);

    expect(width).toBeGreaterThanOrEqual("ANRBEL2801529".length);
    expect(width).toBe("ANRBEL2801529".length + MARGIN);
  });

  /** And is no narrower than it was for a short one. */
  it("keeps the reference width for a short booking number", async () => {
    expect(await widthOf([row({ bookingNumber: "ABC123" })])).toBe(
      REFERENCE_WIDTHS[BOOKING_COLUMN - 1],
    );
  });

  it("grows for a booking number longer than the reference width", async () => {
    const long = "ANRBELXX2801529-REV2";

    const width = await widthOf([row({ bookingNumber: long })]);

    expect(width).toBe(long.length + MARGIN);
    expect(width).toBeGreaterThan(REFERENCE_WIDTHS[BOOKING_COLUMN - 1]);
  });

  /** The longest one decides, wherever it sits in the export. */
  it("follows the longest booking number of several Trips", async () => {
    const width = await widthOf([
      row({ bookingNumber: "ABC123" }),
      row({ bookingNumber: "ANRBELXX2801529-REV2" }),
      row({ bookingNumber: "ANRBEL2801529" }),
    ]);

    expect(width).toBe("ANRBELXX2801529-REV2".length + MARGIN);
  });

  it("is unaffected by where the longest number sits", async () => {
    const first = await widthOf([
      row({ bookingNumber: "ANRBELXX2801529-REV2" }),
      row({ bookingNumber: "ABC123" }),
    ]);
    const last = await widthOf([
      row({ bookingNumber: "ABC123" }),
      row({ bookingNumber: "ANRBELXX2801529-REV2" }),
    ]);

    expect(first).toBe(last);
  });

  /**
   * A day nobody booked keeps the width the sheet has always had, rather than
   * collapsing to the header — and does not fail.
   */
  it("keeps the reference width when a Trip has no booking number", async () => {
    expect(await widthOf([row({ bookingNumber: "" })])).toBe(
      REFERENCE_WIDTHS[BOOKING_COLUMN - 1],
    );
  });

  it("keeps the reference width for an export with no Trips at all", async () => {
    expect(await widthOf([])).toBe(REFERENCE_WIDTHS[BOOKING_COLUMN - 1]);
  });

  it("is never narrower than the header itself", async () => {
    const width = await widthOf([row({ bookingNumber: "" })]);

    expect(width).toBeGreaterThanOrEqual("BOEKING".length);
  });

  /**
   * Not a workaround: a thirteen-character number gets thirteen characters of
   * width and a little slack, not a round number chosen to be safe.
   */
  it("is no wider than the content needs", async () => {
    const width = await widthOf([row({ bookingNumber: "ANRBEL2801529" })]);

    expect(width).toBeLessThan("ANRBEL2801529".length + 1);
  });

  /** The number sits on one line: nothing here relies on wrapping. */
  it("does not wrap the booking cell", async () => {
    const sheet = await sheetOf([row({ bookingNumber: "ANRBELXX2801529-REV2" })]);
    const cell = sheet.getRow(3).getCell(BOOKING_COLUMN);

    expect(cell.alignment?.wrapText).toBeFalsy();
    expect(cell.value).toBe("ANRBELXX2801529-REV2");
  });
});

describe("every other column", () => {
  /*
   * ── THE REFERENCE LAYOUT IS UNTOUCHED ─────────────────────────────────────
   * Asserted per column rather than as a whole, so a failure names the column
   * that moved. `CONT NR` in particular is 11.54296875 because an eleven
   * character container number has to sit on one line.
   */
  it.each([
    [1, "NR PLAAT"],
    [2, "TIJD"],
    [3, "TIJD"],
    [5, "TYPE"],
    [6, "CONT NR"],
    [7, "PLAATS"],
    [8, "COMBI EN KOST"],
    [9, "INFO"],
  ])("keeps column %i (%s) at its reference width", async (column, _name) => {
    const width = await widthOf(
      [row({ bookingNumber: "ANRBELXX2801529-REV2" })],
      column as number,
    );

    expect(width).toBe(REFERENCE_WIDTHS[(column as number) - 1]);
  });

  /** Including when the booking column grows a long way. */
  it("keeps CONT NR at 11.54296875 beside a very long booking number", async () => {
    const width = await widthOf(
      [row({ bookingNumber: "A".repeat(40) })],
      6,
    );

    expect(width).toBe(11.54296875);
  });

  it("still writes nine columns", async () => {
    const sheet = await sheetOf([row()]);

    expect(sheet.getRow(2).getCell(9).value).toBe("INFO");
    expect(sheet.getRow(2).getCell(10).value).toBeNull();
  });
});
