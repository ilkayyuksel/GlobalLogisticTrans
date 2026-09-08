import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";

import { findAutomaticPropertyId, type Setting } from "@/lib/api/settings";
import type { CustomProperty, PricingSnapshot, Trip } from "@/lib/api/types";
import { COMBINATION_COLOR_COUNT } from "./combination";
import { buildBasicWorkbook } from "./export-workbooks";
import { toBasicRow, toManualPropertyIds } from "./export-rows";

/**
 * TAR and group colours, in a REAL workbook built from LIVE data.
 *
 * ── WHAT THE CAPTURE HOLDS ──────────────────────────────────────────────────
 * Twenty disposable Trips closed through the real status endpoint and priced by
 * the real Pricing Engine:
 *
 *   ZZTAR000001  day X, `TARX`      — the Engine CHARGED TAR
 *   ZZTAR000002  day X, `TARX`      — the same-day rule WITHHELD it
 *   ZZTAR000003  day Y, `TARX`      — another day, so charged again
 *   ZZTAR000004  day X, whitespace  — never charged
 *   ZZGRP0000nn  eight genuine Combinations, two legs each, group 1 spanning
 *                two days
 *
 * The Trips were deleted from the database as soon as it was taken; the capture
 * is kept as evidence, like the real transport orders in the parser suite.
 *
 * Nothing here re-decides anything. Whether TAR applied is read out of the
 * stored snapshot, which is the Engine's own answer — same-day rule and
 * Combination allocation already inside it.
 */

interface Capture {
  readonly trips: Trip[];
  readonly snapshots: PricingSnapshot[];
  readonly catalog: CustomProperty[];
  readonly settings: Setting[];
}

const CAPTURE = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "basis-live-tar.json"), "utf8"),
) as Capture;

const TAR_ID = findAutomaticPropertyId(CAPTURE.settings);

/** Row 1 is the date, row 2 the headers. */
const FIRST_ROW = 3;
const KOSTEN = 8;
const INFO = 9;

let sheet: ExcelJS.Worksheet;

beforeAll(async () => {
  const byTrip = new Map(
    CAPTURE.snapshots.map((snapshot) => [snapshot.pricing.tripId, snapshot]),
  );
  const manualPropertyIds = toManualPropertyIds(CAPTURE.catalog);

  const rows = CAPTURE.trips.map((trip) =>
    toBasicRow(
      trip,
      byTrip.get(trip.id) ?? null,
      manualPropertyIds,
      "Wachttijd",
      TAR_ID,
    ),
  );

  const buffer = await buildBasicWorkbook(rows, "nl", {
    start: "2026-11-02",
    end: "2026-11-03",
  });

  const directory = await mkdtemp(join(tmpdir(), "trano-tar-"));
  const file = join(directory, "basis.xlsx");

  await writeFile(file, Buffer.from(buffer));

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(
    (await readFile(file)) as unknown as Parameters<
      typeof reopened.xlsx.load
    >[0],
  );

  sheet = reopened.worksheets[0];
});

function rowOf(booking: string): number {
  for (let index = FIRST_ROW; index <= sheet.rowCount; index += 1) {
    if (sheet.getRow(index).getCell(4).value === booking) {
      return index;
    }
  }

  throw new Error(`${booking} is not in the sheet`);
}

function cellOf(booking: string, column: number): string {
  return String(sheet.getRow(rowOf(booking)).getCell(column).value ?? "");
}

function fillsOf(rowNumber: number): string[] {
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

/** The two legs of each seeded group, by their booking numbers. */
const GROUP_LEGS: readonly (readonly [string, string])[] = [
  ["ZZGRP000010", "ZZGRP000011"],
  ["ZZGRP000012", "ZZGRP000013"],
  ["ZZGRP000014", "ZZGRP000015"],
  ["ZZGRP000016", "ZZGRP000017"],
  ["ZZGRP000018", "ZZGRP000019"],
  ["ZZGRP000020", "ZZGRP000021"],
  ["ZZGRP000022", "ZZGRP000023"],
  ["ZZGRP000024", "ZZGRP000025"],
];

describe("TAR in a real BASIS workbook", () => {
  it("says TAR on the Trip the Engine charged", () => {
    expect(cellOf("ZZTAR000001", INFO)).toBe("TAR");
  });

  it("carries that Trip's TAR amount in the costs column", () => {
    expect(cellOf("ZZTAR000001", KOSTEN)).toBe("50.00");
  });

  /** The same number, the same day: the Engine withheld it. */
  it("says nothing for the Trip the same-day rule blocked", () => {
    expect(cellOf("ZZTAR000002", INFO)).toBe("");
  });

  it("charges nothing on that Trip either", () => {
    expect(cellOf("ZZTAR000002", KOSTEN)).toBe("");
  });

  /** Another day, so the number is free again. */
  it("says TAR again on the next day", () => {
    expect(cellOf("ZZTAR000003", INFO)).toBe("TAR");
    expect(cellOf("ZZTAR000003", KOSTEN)).toBe("50.00");
  });

  it("says nothing for a whitespace-only number", () => {
    expect(cellOf("ZZTAR000004", INFO)).toBe("");
    expect(cellOf("ZZTAR000004", KOSTEN)).toBe("");
  });

  /**
   * THE INVARIANT: the word and the amount are the same fact, read from the
   * same snapshot. Walked across every Trip in the capture.
   */
  it("never lets the word and the amount disagree", () => {
    for (const trip of CAPTURE.trips) {
      const booking = trip.bookingNumber as string;
      const saysTar = cellOf(booking, INFO).split(", ").includes("TAR");
      const charged = CAPTURE.snapshots
        .find((snapshot) => snapshot.pricing.tripId === trip.id)
        ?.items.some((item) => item.customPropertyId === TAR_ID);

      expect(saysTar).toBe(Boolean(charged));
    }
  });

  it("never writes the TAR number anywhere in the file", () => {
    const everything: string[] = [];

    sheet.eachRow((row) =>
      (row.values as unknown[]).forEach((value) =>
        everything.push(String(value ?? "")),
      ),
    );

    expect(everything.join(" ")).not.toContain("TARX");
  });
});

describe("group colours in a real BASIS workbook", () => {
  it("paints every cell of a grouped row", () => {
    const fills = fillsOf(rowOf("ZZGRP000010"));

    expect(new Set(fills).size).toBe(1);
    expect(fills[0]).not.toBe("NONE");
  });

  it("gives both legs of each of the eight groups one colour", () => {
    for (const [legA, legB] of GROUP_LEGS) {
      expect(fillsOf(rowOf(legA))).toEqual(fillsOf(rowOf(legB)));
    }
  });

  /** Group 1's legs sit on different days and still share their colour. */
  it("keeps one colour when a group spans two days", () => {
    const [legA, legB] = GROUP_LEGS[0];
    const dayA = CAPTURE.trips.find((t) => t.bookingNumber === legA);
    const dayB = CAPTURE.trips.find((t) => t.bookingNumber === legB);

    expect(dayA?.planningDate).not.toBe(dayB?.planningDate);
    expect(fillsOf(rowOf(legA))[0]).toBe(fillsOf(rowOf(legB))[0]);
  });

  /**
   * Eight groups, and no two of them share a colour — the palette holds ten,
   * so eight must all be distinct rather than merely mostly so.
   */
  it("gives the eight groups eight different colours", () => {
    const colours = GROUP_LEGS.map(([leg]) => fillsOf(rowOf(leg))[0]);

    expect(new Set(colours).size).toBe(GROUP_LEGS.length);
    expect(GROUP_LEGS.length).toBeLessThanOrEqual(COMBINATION_COLOR_COUNT);
  });

  it("leaves the ungrouped Trips unpainted", () => {
    for (const booking of ["ZZTAR000001", "ZZTAR000002", "ZZTAR000004"]) {
      expect(fillsOf(rowOf(booking)).every((fill) => fill === "NONE")).toBe(
        true,
      );
    }
  });

  it("never gives the header a group colour", () => {
    const group = fillsOf(rowOf("ZZGRP000010"))[0];

    expect(fillsOf(2).every((fill) => fill !== group)).toBe(true);
  });
});
