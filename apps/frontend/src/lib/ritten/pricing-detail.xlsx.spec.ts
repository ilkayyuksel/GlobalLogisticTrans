import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";

import type { PricingSnapshot, Trip } from "@/lib/api/types";
import { combinationFillArgb } from "./combination";
import type { TripExportLabels } from "@/lib/api/trip-export-labels";
import { toPricingRow } from "./export-rows";
import { buildPricingWorkbook } from "./export-workbooks";

/**
 * The detailed pricing sheet, verified in a REAL `.xlsx` file.
 *
 * ── THE THREE THINGS IT HAD TO LEARN ────────────────────────────────────────
 * Brandstof printed the configured percentage and nothing else, so the column
 * that should have carried a cost carried `23%` — a figure nobody can add to a
 * Tarief. A Cost Confirmation changed the EK total and left no trace of WHICH
 * document produced it. And a Combination, which the Ritten list and the BASIS
 * sheet both colour, arrived here as plain white rows.
 *
 * ── AND WHERE EACH ANSWER COMES FROM ────────────────────────────────────────
 * Nothing in this sheet is calculated. The amount is the Engine's own stored
 * line with the operator's corrections applied; the rate beside it is the one
 * that line recorded for itself; the references are the ones the Engine wrote
 * on the EK line; and the colour is `combinationFillArgb`, the same mapping the
 * Ritten list's group tag uses. This file opens the finished workbook and reads
 * all four back.
 * ────────────────────────────────────────────────────────────────────────────
 */

/*
 * Two groups that land on DIFFERENT colours. The palette holds ten and repeats
 * beyond them by design — two ids can legitimately share one — so a test about
 * telling groups apart has to pick ids that do not collide, rather than assume
 * every pair differs.
 */
const GROUP_A = "5a1e7c1e-0000-4000-8000-00000000c0b1";
const GROUP_B = "7fd2a904-0000-4000-8000-00000000d0c3";

interface Line {
  readonly code: string;
  readonly amount: string;
  /** The line's own rate — the percentage, on a fuel line. */
  readonly unitPrice?: string;
  readonly description?: string;
  /** Which Custom Property a CUSTOM_PROPERTY line charges. */
  readonly customPropertyId?: string;
}

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: "CLOSED",
    bookingNumber: "ANRDUB2602247",
    containerNumber: "MSKU1234567",
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "Lokeren",
    destinationCountry: "Belgium",
    planningDate: "2026-09-25",
    startTime: "07:00:00",
    endTime: "15:00:00",
    direction: "DELIVERY",
    tripGroupId: null,
    pdfDocumentId: "pdf-1",
    vehicle: null,
    effectiveDriver: null,
    customProperties: [],
    isLooseTrip: false,
    isPaid: false,
    tarNummer: null,
    internalNotes: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    latestUpdate: null,
    costConfirmation: null,
    pricing: null,
    ...overrides,
  } as unknown as Trip;
}

function snapshotOf(...lines: Line[]): PricingSnapshot {
  return {
    pricing: {
      id: "snapshot-1",
      tripId: "trip-1",
      totalPrice: "0.00",
      currency: "EUR",
    },
    items: lines.map((line, index) => ({
      id: `item-${index}`,
      tripPricingId: "snapshot-1",
      pricingComponentId: `component-${line.code}`,
      pricingComponentCode: line.code,
      customPropertyId: line.customPropertyId ?? null,
      description: line.description ?? line.code,
      amount: line.amount,
      currency: "EUR",
      calculationOrder: index,
      quantity: null,
      unitPrice: line.unitPrice ?? null,
      notes: null,
    })),
  } as unknown as PricingSnapshot;
}

/** The Engine's own wording for the EK line. See `cost-confirmation.calculator.ts`. */
function confirmedBy(...ccNumbers: string[]): string {
  return ccNumbers.length === 1
    ? `Cost confirmation ${ccNumbers[0]}`
    : `Cost confirmations ${ccNumbers.join(", ")}`;
}

interface Sheet {
  /** A cell of the first data row, by its column heading. */
  cell(header: string, rowOffset?: number): ExcelJS.Cell;
  /** The fill of a whole data row: one entry per column. */
  fillsOf(rowOffset: number): string[];
  headers: string[];
}

/**
 * Writes the workbook, reopens it with a fresh reader and addresses it BY
 * HEADING — so a column added tomorrow moves these tests rather than breaking
 * them, and what is asserted is what the file holds.
 */
async function writeSheet(
  trips: {
    trip: Trip;
    snapshot: PricingSnapshot | null;
    /** The backend's words for this Trip; none unless a test supplies them. */
    labels?: TripExportLabels;
  }[],
): Promise<Sheet> {
  const rows = trips.map(({ trip, snapshot, labels }) =>
    toPricingRow(trip, snapshot, labels),
  );
  const buffer = await buildPricingWorkbook(rows, "nl");

  const directory = await mkdtemp(join(tmpdir(), "trano-pricing-detail-"));
  const file = join(directory, "pricing.xlsx");

  await writeFile(file, Buffer.from(buffer));

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(
    (await readFile(file)) as unknown as Parameters<
      typeof reopened.xlsx.load
    >[0],
  );

  const sheet = reopened.worksheets[0];
  const headers = (sheet.getRow(1).values as unknown[])
    .slice(1)
    .map((header) => String(header));

  return {
    headers,
    cell: (header: string, rowOffset = 0) =>
      sheet.getRow(2 + rowOffset).getCell(headers.indexOf(header) + 1),
    fillsOf: (rowOffset: number) =>
      headers.map((_, index) => {
        const fill = sheet.getRow(2 + rowOffset).getCell(index + 1).fill as
          | { fgColor?: { argb?: string } }
          | undefined;

        return fill?.fgColor?.argb ?? "NONE";
      }),
  };
}

describe("Brandstof is a price, not a percentage", () => {
  it("prints what the fuel cost, in euros", async () => {
    const sheet = await writeSheet([
      {
        trip: buildTrip(),
        snapshot: snapshotOf(
          { code: "BASE_PRICE", amount: "100.00" },
          { code: "FUEL_SURCHARGE", amount: "23.00", unitPrice: "23" },
        ),
      },
    ]);

    expect(sheet.cell("Brandstof").value).toBe(23);
    expect(sheet.cell("Brandstof").numFmt).toContain("€");
  });

  /** The rate is not a column of this sheet: a price list carries prices. */
  it("has no percentage column at all", async () => {
    const sheet = await writeSheet([{ trip: buildTrip(), snapshot: null }]);

    expect(sheet.headers).toContain("Brandstof");
    expect(sheet.headers.some((header) => header.includes("%"))).toBe(false);
  });

  /**
   * 137.50 at 23% is 31.625, and the Engine stores money at two places. The
   * export prints what was stored; it rounds nothing itself, because a second
   * opinion about a half cent is how two systems start disagreeing.
   */
  it("prints the Engine's own rounding, never its own", async () => {
    const sheet = await writeSheet([
      {
        trip: buildTrip(),
        snapshot: snapshotOf(
          { code: "BASE_PRICE", amount: "137.50" },
          { code: "FUEL_SURCHARGE", amount: "31.63", unitPrice: "23" },
        ),
      },
    ]);

    expect(sheet.cell("Brandstof").value).toBe(31.63);
  });

  /** A Trip priced at nothing is charged no fuel — a real zero, not an absence. */
  it("prints 0.00 for a Trip with no Tarief", async () => {
    const sheet = await writeSheet([
      {
        trip: buildTrip(),
        snapshot: snapshotOf(
          { code: "BASE_PRICE", amount: "0.00" },
          { code: "FUEL_SURCHARGE", amount: "0.00", unitPrice: "23" },
        ),
      },
    ]);

    expect(sheet.cell("Tarief").value).toBe(0);
    expect(sheet.cell("Brandstof").value).toBe(0);
  });

  /**
   * An operator corrected the Tarief to 137.50. The backend recalculates the
   * fuel from that corrected figure and both travel together, so the sheet
   * cannot print a new Tarief beside the fuel the old one produced.
   */
  it("follows an overridden Tarief", async () => {
    const sheet = await writeSheet([
      {
        trip: buildTrip({
          pricing: {
            tarief: "137.50",
            brandstof: "31.63",
            backload: "0.00",
            tol: "0.00",
            tunnel: "0.00",
            others: "0.00",
            ek: "0.00",
            totaal: "169.13",
            components: [],
          },
        } as Partial<Trip>),
        snapshot: snapshotOf(
          { code: "BASE_PRICE", amount: "100.00" },
          { code: "FUEL_SURCHARGE", amount: "23.00", unitPrice: "23" },
        ),
      },
    ]);

    expect(sheet.cell("Tarief").value).toBe(137.5);
    expect(sheet.cell("Brandstof").value).toBe(31.63);
  });

  /**
   * ── HISTORY IS NOT REPRICED BY AN EXPORT ──────────────────────────────────
   * This Trip was closed when fuel stood at 19%. The configuration says 23%
   * today, and the sheet must still say what was charged — amount AND rate.
   */
  it("leaves a Trip closed at an older rate exactly as it was charged", async () => {
    const sheet = await writeSheet([
      {
        trip: buildTrip(),
        snapshot: snapshotOf(
          { code: "BASE_PRICE", amount: "100.00" },
          { code: "FUEL_SURCHARGE", amount: "19.00", unitPrice: "19" },
        ),
      },
    ]);

    expect(sheet.cell("Brandstof").value).toBe(19);
  });

  /** Never priced is not priced at zero. */
  it("leaves the fuel cell empty for an unpriced Trip", async () => {
    const sheet = await writeSheet([{ trip: buildTrip(), snapshot: null }]);

    expect(sheet.cell("Brandstof").value).toBeNull();
  });
});

/**
 * ── REMARKS: THE BACKEND'S WORDS, PLACED ────────────────────────────────────
 * What Remarks SAYS — the properties, TAR, the waiting window, every Cost
 * Confirmation reference, and their order — is composed by the backend
 * (`trip-export-labels.ts`), whose own tests hold every case this file used to.
 * What is tested here is the browser's part: the text lands in the Remarks
 * column of its OWN Trip's row, exactly as given.
 */
describe("the Remarks column", () => {
  const SAID: TripExportLabels = {
    remarks: "Aan/Afkoppelen | TAR | Wachttijd 07:00-10:00 | CC4139505",
    waitingLabel: "Wachttijd 07:00-10:00",
    tarCharged: true,
    costConfirmations: ["CC4139505"],
  };

  it("prints the backend's Remarks text exactly as given", async () => {
    const sheet = await writeSheet([
      { trip: buildTrip(), snapshot: snapshotOf({ code: "BASE_PRICE", amount: "100.00" }), labels: SAID },
    ]);

    expect(sheet.cell("Remarks").value).toBe(SAID.remarks);
  });

  it("leaves Remarks empty when there is nothing to say", async () => {
    const sheet = await writeSheet([
      { trip: buildTrip(), snapshot: snapshotOf({ code: "BASE_PRICE", amount: "100.00" }) },
    ]);

    expect(sheet.cell("Remarks").value).toBe("");
  });

  /** Each row carries its OWN Trip's words, never its neighbour's. */
  it("keeps each Trip's Remarks on its own row", async () => {
    const sheet = await writeSheet([
      { trip: buildTrip(), snapshot: null, labels: { ...SAID, remarks: "CC4139505" } },
      { trip: buildTrip({ id: "trip-2" }), snapshot: null, labels: { ...SAID, remarks: "CC4156173" } },
    ]);

    expect(sheet.cell("Remarks", 0).value).toBe("CC4139505");
    expect(sheet.cell("Remarks", 1).value).toBe("CC4156173");
  });

  /** EK is an amount, and the browser still reads it off the stored line. */
  it("prints the sum of every confirmation in EK", async () => {
    const sheet = await writeSheet([
      {
        trip: buildTrip(),
        snapshot: snapshotOf(
          { code: "BASE_PRICE", amount: "100.00" },
          {
            code: "COST_CONFIRMATION",
            amount: "165.00",
            description: confirmedBy("4139505", "4156173", "4161980"),
          },
        ),
      },
    ]);

    expect(sheet.cell("EK").value).toBe(165);
  });

  /** The waiting time's own column is the stored amount, whatever Remarks says. */
  it("prints the waiting time's price in its own column", async () => {
    const sheet = await writeSheet([
      {
        trip: buildTrip(),
        snapshot: snapshotOf(
          { code: "BASE_PRICE", amount: "100.00" },
          { code: "WAITING_TIME", amount: "55.00" },
        ),
        labels: SAID,
      },
    ]);

    expect(sheet.cell("Wachttijd").value).toBe(55);
  });
});

describe("the group colour, the same one the Ritten list shows", () => {
  const grouped = (id: string, tripGroupId: string | null) => ({
    trip: buildTrip({ id, tripGroupId } as Partial<Trip>),
    snapshot: snapshotOf(
      { code: "BASE_PRICE", amount: "100.00" },
      { code: "COMBINATION", amount: "50.00" },
    ),
  });

  it("paints every cell of a grouped Trip's row", async () => {
    const sheet = await writeSheet([grouped("trip-1", GROUP_A)]);

    expect(sheet.fillsOf(0)).toEqual(
      sheet.headers.map(() => combinationFillArgb(GROUP_A)),
    );
  });

  it("gives both members of one group the same colour", async () => {
    const sheet = await writeSheet([
      grouped("trip-1", GROUP_A),
      grouped("trip-2", GROUP_A),
    ]);

    expect(sheet.fillsOf(0)).toEqual(sheet.fillsOf(1));
  });

  it("gives two different groups their own colours", async () => {
    const sheet = await writeSheet([
      grouped("trip-1", GROUP_A),
      grouped("trip-2", GROUP_B),
    ]);

    expect(sheet.fillsOf(0)[0]).toBe(combinationFillArgb(GROUP_A));
    expect(sheet.fillsOf(1)[0]).toBe(combinationFillArgb(GROUP_B));
    expect(sheet.fillsOf(0)[0]).not.toBe(sheet.fillsOf(1)[0]);
  });

  it("leaves a Trip in no group unpainted", async () => {
    const sheet = await writeSheet([grouped("trip-1", null)]);

    expect(sheet.fillsOf(0)).toEqual(sheet.headers.map(() => "NONE"));
  });

  /**
   * The colour follows the group id and nothing else — not the row order, not
   * the day exported, not how many Trips the export happened to hold.
   */
  it("does not depend on the order the rows were written in", async () => {
    const forwards = await writeSheet([
      grouped("trip-1", GROUP_A),
      grouped("trip-2", GROUP_B),
    ]);
    const backwards = await writeSheet([
      grouped("trip-2", GROUP_B),
      grouped("trip-1", GROUP_A),
    ]);

    expect(forwards.fillsOf(0)[0]).toBe(backwards.fillsOf(1)[0]);
    expect(forwards.fillsOf(1)[0]).toBe(backwards.fillsOf(0)[0]);
  });

  it("gives the same group the same colour on another day", async () => {
    const monday = await writeSheet([
      {
        ...grouped("trip-1", GROUP_A),
        trip: buildTrip({ tripGroupId: GROUP_A, planningDate: "2026-09-21" } as Partial<Trip>),
      },
    ]);
    const friday = await writeSheet([
      {
        ...grouped("trip-9", GROUP_A),
        trip: buildTrip({ tripGroupId: GROUP_A, planningDate: "2026-09-25" } as Partial<Trip>),
      },
    ]);

    expect(monday.fillsOf(0)[0]).toBe(friday.fillsOf(0)[0]);
  });

  /** Each grouped Trip carries its own €50, whoever else is in the export. */
  it("prints each member's own Backload", async () => {
    const sheet = await writeSheet([
      grouped("trip-1", GROUP_A),
      grouped("trip-2", GROUP_A),
    ]);

    expect(sheet.cell("Backload", 0).value).toBe(50);
    expect(sheet.cell("Backload", 1).value).toBe(50);
  });

  /**
   * The partner is not in this export at all. The exported leg still carries
   * its own surcharge: the Engine decided it per Trip and stored it there.
   */
  it("prints the Backload of a leg whose partner is absent", async () => {
    const sheet = await writeSheet([grouped("trip-1", GROUP_A)]);

    expect(sheet.cell("Backload").value).toBe(50);
  });

  /** Taken out of its group, the Trip is repriced without the line — and so is the sheet. */
  it("prints no Backload once the ungrouped Trip's snapshot has none", async () => {
    const sheet = await writeSheet([
      {
        trip: buildTrip({ tripGroupId: null } as Partial<Trip>),
        snapshot: snapshotOf({ code: "BASE_PRICE", amount: "100.00" }),
      },
    ]);

    expect(sheet.cell("Backload").value).toBeNull();
    expect(sheet.fillsOf(0)[0]).toBe("NONE");
  });
});
