import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";

import { findAutomaticPropertyId } from "@/lib/api/settings";
import type { Setting } from "@/lib/api/settings";
import type { CustomProperty, PricingSnapshot, Trip } from "@/lib/api/types";
import { buildBasicWorkbook } from "./export-workbooks";
import { toBasicRow, toManualPropertyIds } from "./export-rows";

/**
 * A BASIS workbook built from LIVE data, and inspected as a real file.
 *
 * ── WHY THIS IS NOT ANOTHER FIXTURE TEST ────────────────────────────────────
 * The JSON these read was captured from the running backend: five disposable
 * Trips closed through the real status endpoint, priced by the real Pricing
 * Engine, with a real Custom Property assignment and two real Cost Confirmation
 * PDFs imported through the real upload route. The three reads are the ones
 * `ExportButton` makes, in its order, with the server doing the sorting.
 *
 * So what is exercised here is the whole chain — database, API, export code,
 * spreadsheet — and what is asserted is the FILE.
 *
 * The capture is KEPT, in `__fixtures__`, for the same reason the real transport
 * orders are kept: it is evidence rather than an invention, and a rule that was
 * verified once against the running system should stay verified. The Trips it
 * describes were deleted from the database as soon as it was taken.
 *
 * Two captures, differing only in `sortBy`, so the sort mode reaching the export
 * is asserted rather than assumed.
 */

const CAPTURE_DIRECTORY = join(__dirname, "__fixtures__");

interface Capture {
  readonly sortBy: string;
  readonly trips: Trip[];
  readonly snapshots: PricingSnapshot[];
  readonly catalog: CustomProperty[];
  readonly settings: Setting[];
}

function load(name: string): Capture | null {
  const file = join(CAPTURE_DIRECTORY, name);

  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Capture)
    : null;
}

const PLATE = load("basis-live-plate.json");
const TIME = load("basis-live-time.json");

/** Builds the sheet exactly as `ExportButton` does, then reads the file back. */
async function sheetFrom(capture: Capture): Promise<ExcelJS.Worksheet> {
  const byTrip = new Map(
    capture.snapshots.map((snapshot) => [snapshot.pricing.tripId, snapshot]),
  );
  const manualPropertyIds = toManualPropertyIds(capture.catalog);
  const automaticPropertyId = findAutomaticPropertyId(capture.settings);

  const rows = capture.trips.map((trip) =>
    toBasicRow(
      trip,
      byTrip.get(trip.id) ?? null,
      manualPropertyIds,
      "Wachttijd",
      automaticPropertyId,
    ),
  );

  const buffer = await buildBasicWorkbook(rows, "nl", {
    start: "2026-10-01",
    end: "2026-10-01",
  });

  const directory = await mkdtemp(join(tmpdir(), "trano-live-"));
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

/** Row 1 is the date, row 2 the headers. */
const FIRST_ROW = 3;
const INFO = 9;

function fillsOf(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const row = sheet.getRow(rowNumber);
  const fills: string[] = [];

  for (let column = 1; column <= 9; column += 1) {
    const fill = row.getCell(column).fill as
      | { fgColor?: { argb?: string } }
      | undefined;

    fills.push(fill?.fgColor?.argb ?? "NONE");
  }

  return fills;
}

/** The row a booking number landed on, so order is asserted rather than assumed. */
function rowOf(sheet: ExcelJS.Worksheet, booking: string): number {
  for (let index = FIRST_ROW; index <= sheet.rowCount; index += 1) {
    if (sheet.getRow(index).getCell(4).value === booking) {
      return index;
    }
  }

  throw new Error(`${booking} is not in the sheet`);
}

describe("a BASIS workbook built from live data", () => {
  it("has its captures", () => {
    expect(PLATE).not.toBeNull();
    expect(TIME).not.toBeNull();
  });

  it("ends on INFO, with no AFGEWERKT column", async () => {
    const sheet = await sheetFrom(PLATE as Capture);

    expect((sheet.getRow(2).values as unknown[]).filter(Boolean)).toEqual([
      "NR PLAAT",
      "TIJD",
      "TIJD",
      "BOEKING",
      "TYPE",
      "CONT NR",
      "PLAATS",
      "COMBI EN KOST",
      "INFO",
    ]);
    expect(sheet.getRow(FIRST_ROW).getCell(10).value).toBeNull();
  });

  describe("Info, from what the Engine actually decided", () => {
    it("names the manual property and the note, and says TAR", async () => {
      const sheet = await sheetFrom(PLATE as Capture);

      expect(sheet.getRow(rowOf(sheet, "ZZXL0000001")).getCell(INFO).value).toBe(
        "ZZ Aan/Afkoppelen, TAR, Chauffeur bellen bij aankomst",
      );
    });

    /** Same number, same day: the Engine withheld the charge, so no word. */
    it("says nothing for the Trip the same-day rule blocked", async () => {
      const sheet = await sheetFrom(PLATE as Capture);

      expect(
        sheet.getRow(rowOf(sheet, "ZZXL0000002")).getCell(INFO).value ?? "",
      ).toBe("");
    });

    it("never writes the TAR number anywhere in the file", async () => {
      const sheet = await sheetFrom(PLATE as Capture);
      const everything: string[] = [];

      sheet.eachRow((row) =>
        (row.values as unknown[]).forEach((value) =>
          everything.push(String(value ?? "")),
        ),
      );

      expect(everything.join(" ")).not.toContain("TAR900");
    });
  });

  describe("the Combination", () => {
    it("gives both legs the same colour, across every cell", async () => {
      const sheet = await sheetFrom(PLATE as Capture);
      const legA = fillsOf(sheet, rowOf(sheet, "ZZXL0000003"));
      const legB = fillsOf(sheet, rowOf(sheet, "ZZXL0000004"));

      expect(new Set(legA).size).toBe(1);
      expect(legA[0]).not.toBe("NONE");
      expect(legA).toEqual(legB);
    });

    it("leaves a standalone Trip unpainted", async () => {
      const sheet = await sheetFrom(PLATE as Capture);

      expect(
        fillsOf(sheet, rowOf(sheet, "ZZXL0000001")).every((f) => f === "NONE"),
      ).toBe(true);
    });

    /**
     * The header keeps its own grey band — the reference sheet's, applied by
     * `applyReferenceLook`. What matters is that no GROUP colour reaches it.
     */
    it("never gives the header a group colour", async () => {
      const sheet = await sheetFrom(PLATE as Capture);
      const group = fillsOf(sheet, rowOf(sheet, "ZZXL0000003"))[0];

      expect(fillsOf(sheet, 2).every((fill) => fill !== group)).toBe(true);
    });
  });

  /**
   * The order is the SERVER's. Both captures asked for the same five Trips and
   * differ only in `sortBy`, so a different row order is the sort reaching the
   * export — and both contain the CLOSED Trips, which is what makes the time
   * mode work for finished work.
   */
  describe("the selected sort mode", () => {
    it("carries the mode the list asked for", () => {
      expect((PLATE as Capture).sortBy).toBe("licensePlate");
      expect((TIME as Capture).sortBy).toBe("startTime");
    });

    it("exports every Trip in both modes, CLOSED included", async () => {
      for (const capture of [PLATE, TIME] as Capture[]) {
        const sheet = await sheetFrom(capture);

        expect(capture.trips).toHaveLength(5);
        expect(capture.trips.every((trip) => trip.status === "CLOSED")).toBe(
          true,
        );
        expect(rowOf(sheet, "ZZXL0000001")).toBeGreaterThanOrEqual(FIRST_ROW);
      }
    });

    /** The rows follow the order the server returned, row for row. */
    it("writes the rows in the server's order", async () => {
      for (const capture of [PLATE, TIME] as Capture[]) {
        const sheet = await sheetFrom(capture);

        capture.trips.forEach((trip, index) => {
          expect(sheet.getRow(FIRST_ROW + index).getCell(4).value).toBe(
            trip.bookingNumber,
          );
        });
      }
    });
  });

  /** EK is the aggregate of both imported confirmations: 25.00 + 55.00. */
  it("carries the aggregated EK on the Cost Confirmation Trip", () => {
    const capture = PLATE as Capture;
    const trip = capture.trips.find(
      (candidate) => candidate.bookingNumber === "ANRDUB2792284",
    );
    const snapshot = capture.snapshots.find(
      (candidate) => candidate.pricing.tripId === trip?.id,
    );
    const ek = snapshot?.items.find(
      (item) => item.pricingComponentCode === "COST_CONFIRMATION",
    );

    expect(ek?.amount).toBe("80.00");
  });
});
