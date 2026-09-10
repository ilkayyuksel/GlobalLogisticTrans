import { readFileSync } from "node:fs";
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
 * A genuine Combination whose legs run on DIFFERENT days, exported per period.
 *
 * ── THE CAPTURE ─────────────────────────────────────────────────────────────
 * The real `NEW/combination.pdf`, imported through the real upload route, so
 * the pair is genuine: one group, one document, one DELIVERY and one
 * COLLECTION. The COLLECTION leg was moved to the next day, both legs were
 * closed and priced by the real Engine, the day-2 leg was given a waiting
 * window and the day-1 leg a TAR-nummer. Then the export button's own chain —
 * `periodQuery` → `fetchTripsForExport` → `fetchPricingSnapshots` — was run
 * against the live backend for three periods, and each answer saved here:
 *
 *   day 1 only   2025-05-22        the DELIVERY leg alone
 *   day 2 only   2025-05-23        the COLLECTION leg alone
 *   the week     2025-05-19..25    both
 *
 * The configured surcharge and TAR were both €50. The Trips were deleted once
 * this was taken.
 *
 * ── WHAT IT PINS ────────────────────────────────────────────────────────────
 * Each leg's €50 comes from its OWN stored COMBINATION line, so it appears
 * whether or not the other leg is in the exported period. Nothing in the
 * export reconstructs the pair from the rows it happens to hold.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface Capture {
  readonly trips: Trip[];
  readonly snapshots: PricingSnapshot[];
  readonly catalog: CustomProperty[];
  readonly settings: Setting[];
  readonly query: Record<string, string>;
}

function load(range: "day1" | "day2" | "week"): Capture {
  return JSON.parse(
    readFileSync(
      join(__dirname, "__fixtures__", `basis-live-crossday-${range}.json`),
      "utf8",
    ),
  ) as Capture;
}

const DELIVERY = "DUBANR2598395";
const COLLECTION = "ANRBEL2603249";

async function sheetOf(capture: Capture): Promise<ExcelJS.Worksheet> {
  const buffer = await buildBasicWorkbook(
    capture.trips.map((trip) =>
      toBasicRow(
        trip,
        capture.snapshots.find((s) => s.pricing.tripId === trip.id) ?? null,
        toManualPropertyIds(capture.catalog),
        "Wachttijd",
        findAutomaticPropertyId(capture.settings),
      ),
    ),
    "nl",
    { start: "2025-05-19", end: "2025-05-25" },
  );
  const directory = await mkdtemp(join(tmpdir(), "trano-crossday-"));
  const file = join(directory, "basis.xlsx");

  await writeFile(file, Buffer.from(buffer));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await readFile(file)) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );

  return workbook.worksheets[0];
}

/** Every data row of a sheet, by booking number. */
async function rowsOf(capture: Capture) {
  const sheet = await sheetOf(capture);
  const rows = new Map<string, { costs: string; info: string; fill: string }>();

  for (let index = 3; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const fill = row.getCell(1).fill as
      | { fgColor?: { argb?: string } }
      | undefined;

    rows.set(String(row.getCell(4).value), {
      costs: String(row.getCell(8).value ?? ""),
      info: String(row.getCell(9).value ?? ""),
      fill: fill?.fgColor?.argb ?? "NONE",
    });
  }

  return rows;
}

function tripOf(capture: Capture, booking: string): Trip {
  const trip = capture.trips.find(
    (candidate) => candidate.bookingNumber === booking,
  );

  if (!trip) {
    throw new Error(`${booking} is not in this capture`);
  }

  return trip;
}

function combinationLineOf(capture: Capture, booking: string) {
  const trip = tripOf(capture, booking);
  const snapshot = capture.snapshots.find((s) => s.pricing.tripId === trip.id);

  return snapshot?.items.find(
    (item) => item.pricingComponentCode === "COMBINATION",
  )?.amount;
}

describe("a cross-day Combination, exported per period", () => {
  describe("what the backend returned", () => {
    it("asked for exactly the period each export covers", () => {
      expect(load("day1").query.planningDate).toBe("2025-05-22");
      expect(load("day2").query.planningDate).toBe("2025-05-23");
      expect(load("week").query).toMatchObject({
        planningDateFrom: "2025-05-19",
        planningDateTo: "2025-05-25",
      });
    });

    it("returned only the legs inside each period", () => {
      expect(load("day1").trips.map((trip) => trip.bookingNumber)).toEqual([
        DELIVERY,
      ]);
      expect(load("day2").trips.map((trip) => trip.bookingNumber)).toEqual([
        COLLECTION,
      ]);
      expect(load("week").trips).toHaveLength(2);
    });

    it("is one genuine pair across two days", () => {
      const week = load("week");
      const delivery = tripOf(week, DELIVERY);
      const collection = tripOf(week, COLLECTION);

      expect(delivery.tripGroupId).not.toBeNull();
      expect(delivery.tripGroupId).toBe(collection.tripGroupId);
      expect(delivery.pdfDocumentId).toBe(collection.pdfDocumentId);
      expect([delivery.planningDate, collection.planningDate]).toEqual([
        "2025-05-22",
        "2025-05-23",
      ]);
      expect(tripOf(load("day1"), DELIVERY).tripGroupId).toBe(
        tripOf(load("day2"), COLLECTION).tripGroupId,
      );
    });

    it("stored a €50 COMBINATION line on each leg", () => {
      expect(combinationLineOf(load("week"), DELIVERY)).toBe("50.00");
      expect(combinationLineOf(load("week"), COLLECTION)).toBe("50.00");
    });
  });

  describe("the BASIS sheet", () => {
    /** The partner is outside the period, and the €50 is still there. */
    it("shows the day-1 leg's €50 in a day-1 export", async () => {
      const rows = await rowsOf(load("day1"));

      expect(rows.get(DELIVERY)?.costs).toBe("50.00 + 50.00");
      expect(rows.has(COLLECTION)).toBe(false);
    });

    it("shows the day-2 leg's €50 in a day-2 export", async () => {
      const rows = await rowsOf(load("day2"));

      expect(rows.get(COLLECTION)?.costs).toBe("50.00 + 55.00");
      expect(rows.has(DELIVERY)).toBe(false);
    });

    it("shows both legs' €50 when the period holds both", async () => {
      const rows = await rowsOf(load("week"));

      expect(rows.get(DELIVERY)?.costs).toBe("50.00 + 50.00");
      expect(rows.get(COLLECTION)?.costs).toBe("50.00 + 55.00");
    });

    /** Backload first, then each leg's own TAR or waiting time. */
    it("keeps TAR and waiting time on their own legs", async () => {
      const rows = await rowsOf(load("week"));

      expect(rows.get(DELIVERY)?.info).toBe("TAR");
      expect(rows.get(COLLECTION)?.info).toBe("Wachttijd 07:00-10:00");
    });

    it("paints both legs with the same group colour", async () => {
      const rows = await rowsOf(load("week"));

      expect(rows.get(DELIVERY)?.fill).not.toBe("NONE");
      expect(rows.get(DELIVERY)?.fill).toBe(rows.get(COLLECTION)?.fill);
    });

    it("never prints the TAR number", async () => {
      for (const range of ["day1", "day2", "week"] as const) {
        for (const row of (await rowsOf(load(range))).values()) {
          expect(`${row.costs} ${row.info}`).not.toContain("TARXD1");
        }
      }
    });
  });
});
