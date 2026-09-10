import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";

import { findAutomaticPropertyId } from "@/lib/api/settings";
import type { Setting } from "@/lib/api/settings";
import type { CustomProperty, PricingSnapshot, Trip } from "@/lib/api/types";
import { buildBasicWorkbook, buildPricingWorkbook } from "./export-workbooks";
import { toBasicRow, toManualPropertyIds, toPricingRow } from "./export-rows";

/**
 * The automatic TAR and the manual one, in real workbooks built from LIVE data.
 *
 * ── THE CAPTURE ─────────────────────────────────────────────────────────────
 * Five disposable Trips on one day, closed through the real status endpoint
 * and priced by the real Engine, then given a manual TAR through the real
 * assignment endpoint — the call that returned 409 before TAR became
 * assignable. The configured TAR on that system was €50:
 *
 *   ZZTM0000001  no number, no manual TAR           -> €0
 *   ZZTM0000002  number TARB, no manual TAR         -> €50 automatic
 *   ZZTM0000003  no number, manual TAR              -> €50 manual
 *   ZZTM0000004  number TARD, manual TAR            -> €50 + €50
 *   ZZTM0000005  number TARB (already charged that
 *                day by 0002), manual TAR           -> €50 manual only
 *
 * The Trips were deleted from the database once this was taken.
 *
 * ── WHAT IS ASSERTED ────────────────────────────────────────────────────────
 * That the sheets carry exactly what the Engine stored — both amounts where
 * there are two — and that Info says `TAR` ONCE however many TAR charges a Trip
 * has. The word says "TAR was charged"; the amounts say how much. A second
 * `TAR` would be a new representation nobody asked for, and the number is
 * never printed at all.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface Capture {
  readonly trips: Trip[];
  readonly snapshots: PricingSnapshot[];
  readonly catalog: CustomProperty[];
  readonly settings: Setting[];
}

const CAPTURE = JSON.parse(
  readFileSync(
    join(__dirname, "__fixtures__", "basis-live-manual-tar.json"),
    "utf8",
  ),
) as Capture;

async function reopen(buffer: ArrayBuffer): Promise<ExcelJS.Worksheet> {
  const directory = await mkdtemp(join(tmpdir(), "trano-manual-tar-"));
  const file = join(directory, "sheet.xlsx");

  await writeFile(file, Buffer.from(buffer));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await readFile(file)) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );

  return workbook.worksheets[0];
}

function snapshotOf(trip: Trip): PricingSnapshot | null {
  return (
    CAPTURE.snapshots.find((snapshot) => snapshot.pricing.tripId === trip.id) ??
    null
  );
}

async function basisSheet(): Promise<ExcelJS.Worksheet> {
  const manual = toManualPropertyIds(CAPTURE.catalog);
  const tarId = findAutomaticPropertyId(CAPTURE.settings);

  return reopen(
    await buildBasicWorkbook(
      CAPTURE.trips.map((trip) =>
        toBasicRow(trip, snapshotOf(trip), manual, "Wachttijd", tarId),
      ),
      "nl",
      { start: "2026-12-01", end: "2026-12-01" },
    ),
  );
}

async function pricingSheet(): Promise<ExcelJS.Worksheet> {
  return reopen(
    await buildPricingWorkbook(
      CAPTURE.trips.map((trip) => toPricingRow(trip, snapshotOf(trip), 15)),
      "nl",
    ),
  );
}

/** Cell values of one BASIS row, found by booking number. */
async function basisRow(booking: string) {
  const sheet = await basisSheet();

  for (let index = 3; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);

    if (row.getCell(4).value === booking) {
      return {
        costs: String(row.getCell(8).value ?? ""),
        info: String(row.getCell(9).value ?? ""),
      };
    }
  }

  throw new Error(`${booking} is not in the BASIS sheet`);
}

/** The PRICING sheet's Others cell for one booking. */
async function othersOf(booking: string): Promise<unknown> {
  const sheet = await pricingSheet();
  const header = sheet.getRow(1).values as unknown[];
  const others = header.indexOf("Others");
  const booked = header.indexOf("Bookingnr");

  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);

    if (row.getCell(booked).value === booking) {
      return row.getCell(others).value;
    }
  }

  throw new Error(`${booking} is not in the PRICING sheet`);
}

describe("the automatic and the manual TAR, in real workbooks", () => {
  it("has five Trips, all priced", () => {
    expect(CAPTURE.trips).toHaveLength(5);
    expect(CAPTURE.snapshots).toHaveLength(5);
  });

  it("A — no number, nothing assigned: no charge and no word", async () => {
    expect(await basisRow("ZZTM0000001")).toEqual({ costs: "", info: "" });
    expect(await othersOf("ZZTM0000001")).toBeNull();
  });

  it("B — the automatic charge alone", async () => {
    expect(await basisRow("ZZTM0000002")).toEqual({
      costs: "50.00",
      info: "TAR",
    });
    expect(await othersOf("ZZTM0000002")).toBe(50);
  });

  it("C — the manual charge alone, on a Trip with no number", async () => {
    expect(await basisRow("ZZTM0000003")).toEqual({
      costs: "50.00",
      info: "TAR",
    });
    expect(await othersOf("ZZTM0000003")).toBe(50);
  });

  /** The case the rule exists for: both amounts, one word. */
  it("D — both charges: two amounts, and TAR said once", async () => {
    expect(await basisRow("ZZTM0000004")).toEqual({
      costs: "50.00 + 50.00",
      info: "TAR",
    });
    expect(await othersOf("ZZTM0000004")).toBe(100);
  });

  /** The same-day rule withheld the automatic one; the manual one stands. */
  it("E — automatic withheld by the same-day rule, manual kept", async () => {
    expect(await basisRow("ZZTM0000005")).toEqual({
      costs: "50.00",
      info: "TAR",
    });
    expect(await othersOf("ZZTM0000005")).toBe(50);
  });

  it("never prints a TAR number anywhere in either sheet", async () => {
    const text: string[] = [];

    for (const sheet of [await basisSheet(), await pricingSheet()]) {
      sheet.eachRow((row) =>
        (row.values as unknown[]).forEach((value) =>
          text.push(String(value ?? "")),
        ),
      );
    }

    expect(text.join(" ")).not.toMatch(/TARB|TARD/);
  });
});
