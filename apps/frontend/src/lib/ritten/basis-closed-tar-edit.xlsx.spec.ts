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
 * A TAR-nummer edited on a CLOSED Trip, as the BASIS and PRICING sheets show it.
 *
 * ── THE BUG BEHIND THIS CAPTURE ─────────────────────────────────────────────
 * The update endpoint used to reprice only when the waiting-time window was
 * sent, so a number added to a CLOSED Trip was stored but never charged — until
 * the Trip was reopened and closed again. The sheets read the stored snapshot,
 * so they showed no TAR either.
 *
 * This capture was taken from the running backend AFTER the fix, with every
 * Trip closed first and its number edited afterwards, never reopened:
 *
 *   ZZTF0000002  number stored under the OLD build, never priced; healed by
 *                its next edit on the fixed build            -> €50
 *   ZZTF0000004  closed, number added, removed, added again  -> €50
 *   ZZTF0000005  closed, then given TARA — already charged
 *                that day on ZZTF0000001                     -> €0 (same-day)
 *   ZZTF0000006  closed, number added                        -> €50
 *
 * The configured TAR on that system was €50. The Trips were deleted once this
 * was taken.
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
    join(__dirname, "__fixtures__", "basis-live-closed-tar-edit.json"),
    "utf8",
  ),
) as Capture;

async function reopen(buffer: ArrayBuffer): Promise<ExcelJS.Worksheet> {
  const directory = await mkdtemp(join(tmpdir(), "trano-closed-tar-"));
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

async function basisRow(booking: string) {
  const manual = toManualPropertyIds(CAPTURE.catalog);
  const tarId = findAutomaticPropertyId(CAPTURE.settings);
  const sheet = await reopen(
    await buildBasicWorkbook(
      CAPTURE.trips.map((trip) =>
        toBasicRow(trip, snapshotOf(trip), manual, "Wachttijd", tarId),
      ),
      "nl",
      { start: "2027-01-11", end: "2027-01-15" },
    ),
  );

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

async function pricingSheet(): Promise<ExcelJS.Worksheet> {
  return reopen(
    await buildPricingWorkbook(
      CAPTURE.trips.map((trip) => toPricingRow(trip, snapshotOf(trip), 15)),
      "nl",
    ),
  );
}

async function othersOf(booking: string): Promise<unknown> {
  const sheet = await pricingSheet();
  const header = sheet.getRow(1).values as unknown[];

  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);

    if (row.getCell(header.indexOf("Bookingnr")).value === booking) {
      return row.getCell(header.indexOf("Others")).value;
    }
  }

  throw new Error(`${booking} is not in the PRICING sheet`);
}

describe("a TAR-nummer edited on a CLOSED Trip, in real workbooks", () => {
  it("has only CLOSED Trips, every one priced", () => {
    expect(CAPTURE.trips.every((trip) => trip.status === "CLOSED")).toBe(true);
    expect(CAPTURE.snapshots).toHaveLength(CAPTURE.trips.length);
  });

  it("charges a number added after closing, without a reopen", async () => {
    expect(await basisRow("ZZTF0000006")).toEqual({
      costs: "50.00",
      info: "TAR",
    });
    expect(await othersOf("ZZTF0000006")).toBe(50);
  });

  it("charges a number that was removed and added again", async () => {
    expect(await basisRow("ZZTF0000004")).toEqual({
      costs: "50.00",
      info: "TAR",
    });
    expect(await othersOf("ZZTF0000004")).toBe(50);
  });

  /** Stored under the old build and never priced; its next edit fixed it. */
  it("charges the Trip the bug had left unpriced", async () => {
    expect(await basisRow("ZZTF0000002")).toEqual({
      costs: "50.00",
      info: "TAR",
    });
  });

  /** The same-day rule still decides, through the same recalculation. */
  it("charges nothing when the number was already charged that day", async () => {
    expect(await basisRow("ZZTF0000005")).toEqual({ costs: "", info: "" });
    expect(await othersOf("ZZTF0000005")).toBeNull();
  });

  it("never prints a TAR number in either sheet", async () => {
    const text: string[] = [];
    const basis = await reopen(
      await buildBasicWorkbook(
        CAPTURE.trips.map((trip) =>
          toBasicRow(
            trip,
            snapshotOf(trip),
            toManualPropertyIds(CAPTURE.catalog),
            "Wachttijd",
            findAutomaticPropertyId(CAPTURE.settings),
          ),
        ),
        "nl",
        { start: "2027-01-11", end: "2027-01-15" },
      ),
    );

    for (const sheet of [basis, await pricingSheet()]) {
      sheet.eachRow((row) =>
        (row.values as unknown[]).forEach((value) =>
          text.push(String(value ?? "")),
        ),
      );
    }

    for (const number of ["TARA", "TARB", "TARC", "TAR1", "TAR6"]) {
      expect(text.join(" ")).not.toContain(number);
    }
  });
});
