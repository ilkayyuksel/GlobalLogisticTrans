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
 * The Combination surcharge — Backload — in real workbooks built from LIVE data.
 *
 * ── THE CAPTURE ─────────────────────────────────────────────────────────────
 * Two REAL Combination orders imported through the real upload route —
 * `NEW/combination.pdf` and `UPDATE/transportorder1347531.pdf` — so each pair
 * is genuine by construction: one group, one document, one DELIVERY and one
 * COLLECTION. Every leg was closed and priced by the real Engine; the second
 * pair's COLLECTION leg was then moved to the next day and priced again, so the
 * pair spans two dates. The configured surcharge was €50.
 *
 * The Engine stored a COMBINATION line of €50 on EACH of the four legs. The
 * PRICING sheet showed it in its Backload column; the BASIS sheet did not —
 * its COMBI EN KOST column listed only Custom Properties and waiting time, and
 * the office sheet it reproduces prints the surcharge there. That is what these
 * tests pin.
 *
 * The Trips were deleted from the database once this was taken.
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
    join(__dirname, "__fixtures__", "basis-live-combination-backload.json"),
    "utf8",
  ),
) as Capture;

const LEGS = ["DUBANR2598395", "ANRBEL2603249", "DUBANR2761223", "ANRDUB2763318"];

async function reopen(buffer: ArrayBuffer): Promise<ExcelJS.Worksheet> {
  const directory = await mkdtemp(join(tmpdir(), "trano-backload-"));
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

function tripOf(booking: string): Trip {
  const trip = CAPTURE.trips.find((candidate) => candidate.bookingNumber === booking);

  if (!trip) {
    throw new Error(`${booking} is not in the capture`);
  }

  return trip;
}

async function basisCosts(): Promise<Map<string, string>> {
  const sheet = await reopen(
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
      { start: "2025-05-22", end: "2026-06-20" },
    ),
  );
  const costs = new Map<string, string>();

  for (let index = 3; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);

    costs.set(String(row.getCell(4).value), String(row.getCell(8).value ?? ""));
  }

  return costs;
}

async function pricingBackload(): Promise<Map<string, unknown>> {
  const sheet = await reopen(
    await buildPricingWorkbook(
      CAPTURE.trips.map((trip) => toPricingRow(trip, snapshotOf(trip), 15)),
      "nl",
    ),
  );
  const header = sheet.getRow(1).values as unknown[];
  const backload = new Map<string, unknown>();

  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);

    backload.set(
      String(row.getCell(header.indexOf("Bookingnr")).value),
      row.getCell(header.indexOf("Backload")).value,
    );
  }

  return backload;
}

describe("the Combination surcharge in real workbooks", () => {
  describe("what the Engine stored", () => {
    it("is two genuine pairs: one group and one document each", () => {
      for (const [delivery, collection] of [LEGS.slice(0, 2), LEGS.slice(2)]) {
        const a = tripOf(delivery);
        const b = tripOf(collection);

        expect(a.tripGroupId).not.toBeNull();
        expect(a.tripGroupId).toBe(b.tripGroupId);
        expect(a.pdfDocumentId).toBe(b.pdfDocumentId);
        expect([a.direction, b.direction]).toEqual(["DELIVERY", "COLLECTION"]);
      }
    });

    it("gives every leg its OWN €50 line", () => {
      for (const booking of LEGS) {
        const lines = (snapshotOf(tripOf(booking))?.items ?? []).filter(
          (item) => item.pricingComponentCode === "COMBINATION",
        );

        expect(lines).toHaveLength(1);
        expect(lines[0].amount).toBe("50.00");
      }
    });

    it("carries one pair across two dates", () => {
      expect(tripOf("DUBANR2761223").planningDate).toBe("2026-06-19");
      expect(tripOf("ANRDUB2763318").planningDate).toBe("2026-06-20");
    });
  });

  describe("the BASIS sheet", () => {
    it.each(LEGS)("prints €50 in COMBI EN KOST for %s", async (booking) => {
      expect((await basisCosts()).get(booking)).toBe("50.00");
    });

    it("sums to €100 per pair", async () => {
      const costs = await basisCosts();

      for (const pair of [LEGS.slice(0, 2), LEGS.slice(2)]) {
        expect(pair.reduce((sum, booking) => sum + Number(costs.get(booking)), 0)).toBe(100);
      }
    });
  });

  describe("the PRICING sheet", () => {
    it.each(LEGS)("shows Backload 50 for %s", async (booking) => {
      expect((await pricingBackload()).get(booking)).toBe(50);
    });
  });
});
