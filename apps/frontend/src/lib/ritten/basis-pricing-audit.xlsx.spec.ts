import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";

import { NO_LABELS, type TripExportLabels } from "@/lib/api/trip-export-labels";
import type { CustomProperty, PricingSnapshot, Trip } from "@/lib/api/types";
import { captureLabels } from "./__fixtures__/capture-labels";
import { buildBasicWorkbook, buildPricingWorkbook } from "./export-workbooks";
import {
  toBasicRow,
  toManualPropertyIds,
  toPricingRow,
  toUnpricedPropertyIds,
} from "./export-rows";

/**
 * The BASIS sheet against the Trip's current pricing, cell by cell.
 *
 * ── WHAT THE SHEET CARRIES ──────────────────────────────────────────────────
 * Nine columns, two of them about money: COMBI EN KOST joins the Trip's
 * stored amounts — Backload, its Custom Properties, its EK — and INFO names
 * them in the same order: COMBI, the operator's properties, TAR, the waiting
 * window, the CC references. There is no Tarief, no total and no EK column on
 * this sheet; PRIJSOVERZICHT has those, and the EK the two print must agree.
 *
 * ── TWO DEFECTS THIS PINS ───────────────────────────────────────────────────
 *   1. A Trip whose EK came from its Cost Confirmations — no charged waiting
 *      time — showed neither the amount nor the CC reference: both cells were
 *      empty for a CLOSED Trip worth €80 in confirmations (a real capture).
 *   2. Property amounts were joined in STORED order. Every property line has
 *      the same calculation order, so the API sorts them by their random item
 *      id — the order of the amounts against INFO's words was chance.
 *
 * Every workbook below is written to disk and read back with a fresh reader:
 * what is asserted is what the file holds.
 * ────────────────────────────────────────────────────────────────────────────
 */

const GENSET = "8b7dec0d-9af2-491c-8ff3-61b082381b49";
const DOUANE = "6d2c3f1a-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const UNPRICED = "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d";
const FREE = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const TAR = "b36469b0-37ec-40ba-81da-9bc272e05d60";
const FLAT = "30e65f2f-9b55-45a7-a53d-73df9930e8ee";

const CATALOG = [
  { id: GENSET, name: "Genset", pricingComponentId: null, isSystemManaged: false, defaultPrice: "35.00" },
  { id: DOUANE, name: "Douane", pricingComponentId: null, isSystemManaged: false, defaultPrice: "12.50" },
  { id: UNPRICED, name: "Label", pricingComponentId: null, isSystemManaged: false, defaultPrice: null },
  { id: FREE, name: "Inbegrepen", pricingComponentId: null, isSystemManaged: false, defaultPrice: "0.00" },
  { id: TAR, name: "TAR", pricingComponentId: null, isSystemManaged: true, defaultPrice: "20.00" },
  { id: FLAT, name: "Flat", pricingComponentId: null, isSystemManaged: true, defaultPrice: "20.00" },
] as unknown as CustomProperty[];

const MANUAL_IDS = toManualPropertyIds(CATALOG);
const UNPRICED_IDS = toUnpricedPropertyIds(CATALOG);

const KOST = 8;
const INFO = 9;
const PRICING_EK = 17;
const PRICING_BACKLOAD = 12;
const PRICING_OTHERS = 15;

type Line = [code: string, amount: string, customPropertyId?: string];

function snapshotOf(...lines: Line[]): PricingSnapshot {
  return {
    pricing: { id: "snapshot-1", tripId: "trip-1" },
    items: lines.map(([code, amount, customPropertyId], index) => ({
      id: `item-${index}`,
      tripPricingId: "snapshot-1",
      pricingComponentId: `component-${code}`,
      pricingComponentCode: code,
      customPropertyId: customPropertyId ?? null,
      description: code,
      amount,
      currency: "EUR",
      calculationOrder: index,
      quantity: null,
      unitPrice: null,
    })),
  } as unknown as PricingSnapshot;
}

/** The effective breakdown the API answers with — the backend's EK rule applied. */
function pricingOf(parts: { backload?: string; others?: string; ek?: string }) {
  return {
    tarief: "0.00",
    brandstof: "0.00",
    backload: parts.backload ?? "0.00",
    tol: "0.00",
    tunnel: "0.00",
    others: parts.others ?? "0.00",
    ek: parts.ek ?? "0.00",
    totaal: "0.00",
    components: [],
  } as unknown as Trip["pricing"];
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
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeEndsNextDay: false,
    waitingTimeMinutes: null,
    distanceKm: null,
    latestUpdate: null,
    costConfirmation: null,
    pricing: null,
    ...overrides,
  } as unknown as Trip;
}

const properties = (...ids: string[]) =>
  ids.map((id) => {
    const entry = CATALOG.find((property) => property.id === id)!;
    return { id: entry.id, name: entry.name, isActive: true };
  });

async function reopen(buffer: ArrayBuffer): Promise<ExcelJS.Worksheet> {
  const directory = await mkdtemp(join(tmpdir(), "trano-basis-audit-"));
  const file = join(directory, "export.xlsx");
  await writeFile(file, Buffer.from(buffer));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await readFile(file)) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  return workbook.worksheets[0];
}

/** The BASIS row of one Trip, read back from a real file. */
async function basisCells(
  trip: Trip,
  snapshot: PricingSnapshot | null,
  labels: TripExportLabels = NO_LABELS,
) {
  const sheet = await reopen(
    await buildBasicWorkbook(
      [toBasicRow(trip, snapshot, MANUAL_IDS, labels, UNPRICED_IDS)],
      "nl",
      { start: "2026-09-25", end: "2026-09-25" },
    ),
  );
  const row = sheet.getRow(3);

  return {
    kost: row.getCell(KOST).value,
    info: row.getCell(INFO).value,
    sheet,
  };
}

/** The PRIJSOVERZICHT row of the same Trip. */
async function pricingCells(trip: Trip, snapshot: PricingSnapshot | null) {
  const sheet = await reopen(
    await buildPricingWorkbook([toPricingRow(trip, snapshot)], "nl"),
  );
  const row = sheet.getRow(2);

  return {
    ek: row.getCell(PRICING_EK).value,
    backload: row.getCell(PRICING_BACKLOAD).value,
    others: row.getCell(PRICING_OTHERS).value,
  };
}

const labels = (overrides: Partial<TripExportLabels>): TripExportLabels => ({
  ...NO_LABELS,
  ...overrides,
});

describe("BASIS against the Trip's current pricing", () => {
  describe("the real captures", () => {
    const file = join(__dirname, "__fixtures__", "basis-live-plate.json");
    const capture = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as {
          trips: Trip[];
          snapshots: PricingSnapshot[];
          catalog: CustomProperty[];
        })
      : null;
    const run = capture ? it : it.skip;

    function cellsOf(booking: string) {
      const trip = capture!.trips.find((each) => each.bookingNumber === booking)!;
      const snapshot =
        capture!.snapshots.find((each) => each.pricing.tripId === trip.id) ?? null;
      const row = toBasicRow(
        trip,
        snapshot,
        toManualPropertyIds(capture!.catalog),
        captureLabels(trip.id),
      );

      return { trip, snapshot, row };
    }

    /* Defect 1, on the captured Trip: two confirmations, €80, and nothing printed. */
    run("prints the confirmed €80 and both CC references of a CLOSED Trip", async () => {
      const { trip, snapshot } = cellsOf("ANRDUB2792284");

      const { kost, info } = await basisCells(trip, snapshot, captureLabels(trip.id));

      expect(kost).toBe("80.00");
      expect(info).toBe("CC4139509, CC4132482");
      expect((await pricingCells(trip, snapshot)).ek).toBe(80);
    });

    /* ZZ Aan/Afkoppelen is 20.00 and TAR 50.00 on this Trip. */
    run("prints each amount under the word that explains it", async () => {
      const { row } = cellsOf("ZZXL0000001");

      expect(row.info.startsWith("ZZ Aan/Afkoppelen, TAR")).toBe(true);
      expect(row.costs).toBe("20.00 + 50.00");
    });

    run("keeps COMBI and the €50 on each grouped leg", () => {
      for (const booking of ["ZZXL0000003", "ZZXL0000004"]) {
        const { row } = cellsOf(booking);

        expect(row.costs).toBe("50.00");
        expect(row.info).toBe("COMBI");
      }
    });
  });

  describe("Backload and COMBI", () => {
    it("prints €50 and COMBI on a leg the Engine charged", async () => {
      const trip = buildTrip({ tripGroupId: "group-1", pricing: pricingOf({ backload: "50.00" }) });
      const snapshot = snapshotOf(["BASE_PRICE", "300.00"], ["COMBINATION", "50.00"]);

      expect(await basisCells(trip, snapshot)).toMatchObject({ kost: "50.00", info: "COMBI" });
      expect((await pricingCells(trip, snapshot)).backload).toBe(50);
    });

    it("prints neither on a grouped Trip whose current snapshot has no surcharge", async () => {
      const trip = buildTrip({ tripGroupId: "group-1", pricing: pricingOf({}) });

      expect(
        await basisCells(trip, snapshotOf(["BASE_PRICE", "300.00"])),
      ).toMatchObject({ kost: "", info: "" });
    });

    it("drops both once the ungrouped Trip's snapshot has none", async () => {
      const trip = buildTrip({ tripGroupId: null, pricing: pricingOf({}) });

      expect(
        await basisCells(trip, snapshotOf(["BASE_PRICE", "300.00"])),
      ).toMatchObject({ kost: "", info: "" });
    });

    it("treats a stored €0 surcharge as a real zero, not as absent", async () => {
      const trip = buildTrip({ tripGroupId: "group-1", pricing: pricingOf({}) });

      expect(
        await basisCells(trip, snapshotOf(["COMBINATION", "0.00"])),
      ).toMatchObject({ kost: "0.00", info: "COMBI" });
    });
  });

  describe("Custom Properties", () => {
    it("prints one priced property under its name", async () => {
      const trip = buildTrip({
        customProperties: properties(GENSET),
        pricing: pricingOf({ others: "35.00" }),
      });

      expect(
        await basisCells(trip, snapshotOf(["CUSTOM_PROPERTY", "35.00", GENSET])),
      ).toMatchObject({ kost: "35.00", info: "Genset" });
    });

    it("prints several in the order INFO names them, whatever the stored order", async () => {
      const trip = buildTrip({
        customProperties: properties(GENSET, DOUANE),
        pricing: pricingOf({ others: "47.50" }),
      });
      const snapshot = snapshotOf(
        ["CUSTOM_PROPERTY", "12.50", DOUANE],
        ["CUSTOM_PROPERTY", "35.00", GENSET],
      );

      expect(await basisCells(trip, snapshot)).toMatchObject({
        kost: "35.00 + 12.50",
        info: "Genset, Douane",
      });
      expect((await pricingCells(trip, snapshot)).others).toBe(47.5);
    });

    it("prints a €0 property as 0.00", async () => {
      const trip = buildTrip({ customProperties: properties(FREE), pricing: pricingOf({}) });

      expect(
        await basisCells(trip, snapshotOf(["CUSTOM_PROPERTY", "0.00", FREE])),
      ).toMatchObject({ kost: "0.00", info: "Inbegrepen" });
    });

    /* The Engine stores no line for it; nothing is invented here either. */
    it("names a property without a price but prints no amount for it", async () => {
      const trip = buildTrip({
        customProperties: properties(GENSET, UNPRICED),
        pricing: pricingOf({ others: "35.00" }),
      });

      expect(
        await basisCells(trip, snapshotOf(["CUSTOM_PROPERTY", "35.00", GENSET])),
      ).toMatchObject({ kost: "35.00", info: "Genset, Label" });
    });

    it("prints a removed property neither in Kost nor in INFO", async () => {
      const trip = buildTrip({ customProperties: [], pricing: pricingOf({}) });

      expect(await basisCells(trip, snapshotOf(["BASE_PRICE", "300.00"]))).toMatchObject({
        kost: "",
        info: "",
      });
    });

    it("prints system-managed charges after the named ones, TAR named once", async () => {
      const trip = buildTrip({
        customProperties: properties(GENSET),
        pricing: pricingOf({ others: "75.00" }),
      });
      const snapshot = snapshotOf(
        ["CUSTOM_PROPERTY", "20.00", FLAT],
        ["CUSTOM_PROPERTY", "20.00", TAR],
        ["CUSTOM_PROPERTY", "35.00", GENSET],
      );

      expect(
        await basisCells(trip, snapshot, labels({ tarCharged: true })),
      ).toMatchObject({ kost: "35.00 + 20.00 + 20.00", info: "Genset, TAR" });
    });
  });

  describe("waiting time and Cost Confirmations", () => {
    const WINDOW = {
      waitingTimeStart: "10:00:00",
      waitingTimeEnd: "13:00:00",
      waitingTimeMinutes: 180,
    };

    it("1. no waiting time, no confirmation: no EK at all", async () => {
      const trip = buildTrip({ pricing: pricingOf({}) });

      expect(await basisCells(trip, snapshotOf(["BASE_PRICE", "300.00"]))).toMatchObject({
        kost: "",
        info: "",
      });
      expect((await pricingCells(trip, snapshotOf(["BASE_PRICE", "300.00"]))).ek).toBeNull();
    });

    it("2. one confirmation and no waiting time: the confirmation is the EK", async () => {
      const trip = buildTrip({ pricing: pricingOf({ ek: "25.00" }) });
      const snapshot = snapshotOf(["COST_CONFIRMATION", "25.00"]);

      expect(
        await basisCells(trip, snapshot, labels({ costConfirmations: ["CC4132482"] })),
      ).toMatchObject({ kost: "25.00", info: "CC4132482" });
      expect((await pricingCells(trip, snapshot)).ek).toBe(25);
    });

    it("3. several confirmations: their sum, once, and every reference", async () => {
      const trip = buildTrip({ pricing: pricingOf({ ek: "66.25" }) });
      const snapshot = snapshotOf(["COST_CONFIRMATION", "66.25"]);

      expect(
        await basisCells(
          trip,
          snapshot,
          labels({ costConfirmations: ["CC4139509", "CC4132482"] }),
        ),
      ).toMatchObject({ kost: "66.25", info: "CC4139509, CC4132482" });
    });

    it("4. a charged waiting time is the EK; the confirmation is named, not added", async () => {
      const trip = buildTrip({ ...WINDOW, pricing: pricingOf({ ek: "55.00" }) });
      const snapshot = snapshotOf(["WAITING_TIME", "55.00"], ["COST_CONFIRMATION", "0.00"]);

      expect(
        await basisCells(
          trip,
          snapshot,
          labels({
            waitingLabel: "Wachttijd 10:00-13:00",
            costConfirmations: ["CC4132482"],
          }),
        ),
      ).toMatchObject({ kost: "55.00", info: "Wachttijd 10:00-13:00, CC4132482" });
      expect((await pricingCells(trip, snapshot)).ek).toBe(55);
    });

    it("5. a waiting time priced at €0 leaves the EK to the confirmation", async () => {
      const trip = buildTrip({
        waitingTimeStart: "10:00:00",
        waitingTimeEnd: "12:15:00",
        waitingTimeMinutes: 135,
        pricing: pricingOf({ ek: "25.00" }),
      });
      const snapshot = snapshotOf(["COST_CONFIRMATION", "25.00"]);

      expect(
        await basisCells(
          trip,
          snapshot,
          labels({
            waitingLabel: "Wachttijd 10:00-12:15",
            costConfirmations: ["CC4132482"],
          }),
        ),
      ).toMatchObject({ kost: "25.00", info: "Wachttijd 10:00-12:15, CC4132482" });
    });

    /* 6–9: what the export reads after each change is the Trip's current state. */
    it("8. after the waiting time is removed, the confirmation is the EK again", async () => {
      const trip = buildTrip({ pricing: pricingOf({ ek: "25.00" }) });

      expect(
        await basisCells(
          trip,
          snapshotOf(["COST_CONFIRMATION", "25.00"]),
          labels({ costConfirmations: ["CC4132482"] }),
        ),
      ).toMatchObject({ kost: "25.00", info: "CC4132482" });
    });

    /*
     * A snapshot written before the EK rule still carries the full confirmation
     * beside the waiting time. The amount printed is the backend's EK, so it
     * counts once.
     */
    it("never adds a waiting time and a confirmation together", async () => {
      const trip = buildTrip({ ...WINDOW, pricing: pricingOf({ ek: "55.00" }) });
      const legacy = snapshotOf(["WAITING_TIME", "55.00"], ["COST_CONFIRMATION", "25.00"]);

      expect((await basisCells(trip, legacy)).kost).toBe("55.00");
    });

    it("11. Backload, properties and EK together, each once and in order", async () => {
      const trip = buildTrip({
        ...WINDOW,
        tripGroupId: "group-1",
        customProperties: properties(GENSET),
        pricing: pricingOf({ backload: "50.00", others: "35.00", ek: "55.00" }),
      });
      const snapshot = snapshotOf(
        ["BASE_PRICE", "300.00"],
        ["COMBINATION", "50.00"],
        ["WAITING_TIME", "55.00"],
        ["CUSTOM_PROPERTY", "35.00", GENSET],
        ["COST_CONFIRMATION", "0.00"],
      );

      const { kost, info } = await basisCells(
        trip,
        snapshot,
        labels({
          waitingLabel: "Wachttijd 10:00-13:00",
          costConfirmations: ["CC4132482"],
        }),
      );

      expect(kost).toBe("50.00 + 35.00 + 55.00");
      expect(info).toBe("COMBI, Genset, Wachttijd 10:00-13:00, CC4132482");
    });
  });

  /*
   * ── A PROPERTY WITHOUT A PRICE IS A REMARK ─────────────────────────────────
   * It has no amount, so it is named after every word that has one — never
   * among the priced properties, where it would seem to own the next amount.
   */
  describe("Custom Properties without a price", () => {
    const priced = snapshotOf(
      ["CUSTOM_PROPERTY", "12.50", DOUANE],
      ["CUSTOM_PROPERTY", "35.00", GENSET],
    );

    it("puts a lone unpriced property in INFO with nothing in Kost", async () => {
      const trip = buildTrip({ customProperties: properties(UNPRICED), pricing: pricingOf({}) });

      expect(await basisCells(trip, snapshotOf(["BASE_PRICE", "300.00"]))).toMatchObject({
        kost: "",
        info: "Label",
      });
    });

    it.each([
      ["before", [UNPRICED, GENSET, DOUANE]],
      ["between", [GENSET, UNPRICED, DOUANE]],
      ["after", [GENSET, DOUANE, UNPRICED]],
    ])("keeps every amount under its own name with the unpriced one %s them", async (_where, order) => {
      const trip = buildTrip({
        customProperties: properties(...order),
        pricing: pricingOf({ others: "47.50" }),
      });

      expect(await basisCells(trip, priced)).toMatchObject({
        kost: "35.00 + 12.50",
        info: "Genset, Douane, Label",
      });
    });

    it("tells an explicit €0 price apart from no price", async () => {
      const trip = buildTrip({
        customProperties: properties(UNPRICED, FREE),
        pricing: pricingOf({}),
      });

      expect(
        await basisCells(trip, snapshotOf(["CUSTOM_PROPERTY", "0.00", FREE])),
      ).toMatchObject({ kost: "0.00", info: "Inbegrepen, Label" });
    });

    it("keeps system-managed charges in step, the unpriced name last", async () => {
      const trip = buildTrip({
        customProperties: properties(UNPRICED, GENSET),
        pricing: pricingOf({ others: "75.00" }),
      });
      const snapshot = snapshotOf(
        ["CUSTOM_PROPERTY", "20.00", FLAT],
        ["CUSTOM_PROPERTY", "20.00", TAR],
        ["CUSTOM_PROPERTY", "35.00", GENSET],
      );

      expect(
        await basisCells(trip, snapshot, labels({ tarCharged: true })),
      ).toMatchObject({ kost: "35.00 + 20.00 + 20.00", info: "Genset, TAR, Label" });
    });

    it("stays last beside COMBI, a waiting time and a confirmation", async () => {
      const trip = buildTrip({
        waitingTimeStart: "10:00:00",
        waitingTimeEnd: "13:00:00",
        waitingTimeMinutes: 180,
        tripGroupId: "group-1",
        customProperties: properties(UNPRICED, GENSET),
        internalNotes: "Bellen bij aankomst",
        pricing: pricingOf({ backload: "50.00", others: "35.00", ek: "55.00" }),
      });
      const snapshot = snapshotOf(
        ["COMBINATION", "50.00"],
        ["WAITING_TIME", "55.00"],
        ["CUSTOM_PROPERTY", "35.00", GENSET],
        ["COST_CONFIRMATION", "0.00"],
      );

      expect(
        await basisCells(
          trip,
          snapshot,
          labels({ waitingLabel: "Wachttijd 10:00-13:00", costConfirmations: ["CC4132482"] }),
        ),
      ).toMatchObject({
        kost: "50.00 + 35.00 + 55.00",
        info: "COMBI, Genset, Wachttijd 10:00-13:00, CC4132482, Label, Bellen bij aankomst",
      });
    });

    it("adds nothing to the price columns of the price list", async () => {
      const trip = buildTrip({
        customProperties: properties(UNPRICED, GENSET),
        pricing: pricingOf({ others: "35.00" }),
      });

      expect(
        (await pricingCells(trip, snapshotOf(["CUSTOM_PROPERTY", "35.00", GENSET]))).others,
      ).toBe(35);
    });
  });

  /*
   * ── AN OPEN TRIP HAS NO CURRENT PRICE ──────────────────────────────────────
   * The backend answers an OPEN Trip with no pricing and leaves its old
   * snapshot out of the snapshots read (see `current-pricing.ts` there). These
   * pin what the sheets then print: no amount anywhere, no COMBI and no TAR —
   * they describe a charge — while the remarks about the work itself stay.
   */
  describe("an OPEN Trip", () => {
    const OPEN_GROUPED = buildTrip({
      status: "OPEN",
      tripGroupId: "group-1",
      customProperties: properties(GENSET, UNPRICED),
      waitingTimeStart: "10:00:00",
      waitingTimeEnd: "13:00:00",
      waitingTimeMinutes: 180,
      pricing: null,
    });

    it("12. prints no amount, no COMBI and no TAR in BASIS", async () => {
      const { kost, info } = await basisCells(
        OPEN_GROUPED,
        null,
        labels({ waitingLabel: "Wachttijd 10:00-13:00", costConfirmations: ["CC4132482"] }),
      );

      expect(kost).toBe("");
      expect(info).toBe("Genset, Wachttijd 10:00-13:00, CC4132482, Label");
    });

    /*
     * The references come from the Trip's confirmation records, whatever its
     * status — only the price follows the status.
     */
    it.each([
      ["no confirmation", [], "Genset, Wachttijd 10:00-13:00, Label"],
      ["one confirmation", ["CC4132482"], "Genset, Wachttijd 10:00-13:00, CC4132482, Label"],
      [
        "several confirmations",
        ["CC4152218", "CC4139509", "CC4132482"],
        "Genset, Wachttijd 10:00-13:00, CC4152218, CC4139509, CC4132482, Label",
      ],
    ])("names %s in INFO, with no amount", async (_label, references, info) => {
      const cells = await basisCells(
        OPEN_GROUPED,
        null,
        labels({ waitingLabel: "Wachttijd 10:00-13:00", costConfirmations: references }),
      );

      expect(cells).toMatchObject({ kost: "", info });
    });

    it("prints no amount in any money column of the price list", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([toPricingRow(OPEN_GROUPED, null)], "nl"),
      );
      const row = sheet.getRow(2);

      for (let column = 10; column <= 17; column += 1) {
        expect(row.getCell(column).value).toBeNull();
      }
    });
  });

  describe("the sheet itself", () => {
    it("keeps the reference's nine columns and headers", async () => {
      const { sheet } = await basisCells(buildTrip(), null);

      expect(sheet.getRow(2).values).toEqual([
        undefined,
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
      expect(sheet.getColumn(KOST).width).toBeCloseTo(25.90625);
      expect(sheet.getColumn(INFO).width).toBe(41);
    });

    it("leaves both money cells empty for a Trip never priced", async () => {
      expect(await basisCells(buildTrip(), null)).toMatchObject({ kost: "", info: "" });
    });
  });
});
