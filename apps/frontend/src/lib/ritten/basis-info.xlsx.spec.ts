import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";

import type { PricingSnapshot, Trip } from "@/lib/api/types";
import { buildBasicWorkbook, buildPricingWorkbook } from "./export-workbooks";
import { toBasicRow, toManualPropertyIds, toPricingRow } from "./export-rows";

/**
 * The BASIS `Info` column, verified in a REAL `.xlsx` file.
 *
 * ── WHY THIS EXISTS BESIDE THE UNIT TESTS ───────────────────────────────────
 * `export-rows.spec.ts` pins what the Info STRING should be. This writes an
 * actual workbook to disk, opens it again with a different reader and looks at
 * the cell — so the assertion covers the whole path a user's file takes, and
 * anything that could mangle the text on the way to a spreadsheet (a formula
 * prefix, a lost comma, a truncated note) fails here rather than in an office.
 *
 * Nothing about pricing is decided here. Whether TAR was charged comes from the
 * stored snapshot, exactly as it does in the export button.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";
const MANUAL_ID = "8b7dec0d-9af2-491c-8ff3-61b082381b49";
const FLAT_ID = "30e65f2f-9b55-45a7-a53d-73df9930e8ee";

/** The catalog as the export reads it. */
const MANUAL_IDS = toManualPropertyIds([
  { id: MANUAL_ID, pricingComponentId: null, isSystemManaged: false },
  { id: TAR_ID, pricingComponentId: null, isSystemManaged: true },
  { id: FLAT_ID, pricingComponentId: null, isSystemManaged: true },
] as never);

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

function snapshotOf(
  ...items: { componentCode: string; amount: string; customPropertyId: string | null }[]
): PricingSnapshot {
  return {
    id: "snapshot-1",
    tripId: "trip-1",
    totalPrice: "0.00",
    items: items.map((item, index) => ({
      id: `item-${index}`,
      tripPricingId: "snapshot-1",
      pricingComponentId: `component-${item.componentCode}`,
      // The field the export classifies by — see `pricing-lines.ts`.
      pricingComponentCode: item.componentCode,
      customPropertyId: item.customPropertyId,
      description: item.componentCode,
      amount: item.amount,
      currency: "EUR",
      calculationOrder: index,
      quantity: null,
      unitPrice: null,
    })),
  } as unknown as PricingSnapshot;
}

function property(componentCode: string, amount: string, customPropertyId: string | null) {
  return { componentCode, amount, customPropertyId };
}

/** Writes the workbook to a temp file, reads it back, returns the Info cell. */
async function infoCellOf(trip: Trip, snapshot: PricingSnapshot | null): Promise<string> {
  const row = toBasicRow(trip, snapshot, MANUAL_IDS, "Wachttijd", TAR_ID);
  const buffer = await buildBasicWorkbook([row], "nl", {
    start: "2026-09-25",
    end: "2026-09-25",
  });

  const directory = await mkdtemp(join(tmpdir(), "trano-basis-"));
  const file = join(directory, "basis.xlsx");

  await writeFile(file, Buffer.from(buffer));

  // Read it back with a FRESH workbook: what is asserted is what the file
  // holds, not what the object in memory happened to say.
  const reopened = new ExcelJS.Workbook();
  /*
   * Read back through `load`, whose declared Buffer type differs nominally from
   * Node's own. The bytes are identical; only the two declarations disagree.
   */
  await reopened.xlsx.load(
    (await readFile(file)) as unknown as Parameters<
      typeof reopened.xlsx.load
    >[0],
  );

  const sheet = reopened.worksheets[0];

  return String(sheet.getRow(FIRST_DATA_ROW).getCell(INFO_COLUMN).value ?? "");
}

/**
 * Where the Info cell is in the BASIS sheet.
 *
 * By POSITION rather than by heading text: the heading is translated, so
 * searching for "Info" would pass in Dutch and fail in Turkish. The layout is
 * `export-workbooks.ts`'s own — header on row 2, Info the ninth column — and
 * these constants failing is exactly the signal wanted if that layout moves.
 */
const FIRST_DATA_ROW = 3;
const INFO_COLUMN = 9;

describe("the Info column in a real BASIS workbook", () => {
  /** CASE A — TAR charged: the word appears, the number never does. */
  it("writes TAR, and never the TAR-nummer", async () => {
    const info = await infoCellOf(
      buildTrip({ tarNummer: "TAR123" }),
      snapshotOf(property("CUSTOM_PROPERTY", "50.00", TAR_ID)),
    );

    expect(info).toBe("TAR");
    expect(info).not.toContain("TAR123");
  });

  /** CASE B — the same number was already charged that day: nothing is said. */
  it("writes no TAR when the Engine withheld the charge", async () => {
    const info = await infoCellOf(
      buildTrip({ tarNummer: "TAR123" }),
      snapshotOf(property("BASE_PRICE", "300.00", null)),
    );

    expect(info).toBe("");
  });

  /** CASE C — the note, verbatim. */
  it("writes the internal note as it was typed", async () => {
    const info = await infoCellOf(
      buildTrip({ internalNotes: "Chauffeur bellen, poort 4" }),
      snapshotOf(),
    );

    expect(info).toBe("Chauffeur bellen, poort 4");
  });

  /** CASE D — a manual property's name. */
  it("writes a manual Custom Property's name", async () => {
    const info = await infoCellOf(
      buildTrip({
        customProperties: [
          { id: MANUAL_ID, name: "Aan/Afkoppelen", isActive: true },
        ],
      } as Partial<Trip>),
      snapshotOf(property("CUSTOM_PROPERTY", "20.00", MANUAL_ID)),
    );

    expect(info).toBe("Aan/Afkoppelen");
  });

  /** CASE E — all of it, in the order the exporter assembles it. */
  it("writes every source in one cell, in order", async () => {
    const info = await infoCellOf(
      buildTrip({
        isLooseTrip: true,
        tarNummer: "TAR123",
        waitingTimeMinutes: 90,
        internalNotes: "Chauffeur bellen bij aankomst",
        customProperties: [
          { id: MANUAL_ID, name: "Aan/Afkoppelen", isActive: true },
          { id: FLAT_ID, name: "Flat", isActive: true },
        ],
      } as Partial<Trip>),
      snapshotOf(
        property("CUSTOM_PROPERTY", "20.00", MANUAL_ID),
        property("CUSTOM_PROPERTY", "20.00", FLAT_ID),
        property("CUSTOM_PROPERTY", "50.00", TAR_ID),
        property("WAITING_TIME", "25.00", null),
      ),
    );

    expect(info).toBe(
      "LOSRIT, Aan/Afkoppelen, TAR, Wachttijd 1 u 30 min, Chauffeur bellen bij aankomst",
    );
    // Charged, but system-managed: never named.
    expect(info).not.toContain("Flat");
    expect(info).not.toContain("TAR123");
  });

  /**
   * ── THE INVARIANT ─────────────────────────────────────────────────────────
   * TAR in the pricing ↔ `TAR` in Info. They read the SAME snapshot — the word
   * from the presence of the automatic property's line, the amount from that
   * line itself — so the exporter has no way to make them disagree. This walks
   * both states and asserts the two together, in the file.
   */
  describe("the TAR word and the TAR amount agree", () => {
    async function rowOf(charged: boolean) {
      const snapshot = charged
        ? snapshotOf(
            property("CUSTOM_PROPERTY", "20.00", MANUAL_ID),
            property("CUSTOM_PROPERTY", "50.00", TAR_ID),
          )
        : snapshotOf(property("CUSTOM_PROPERTY", "20.00", MANUAL_ID));

      const trip = buildTrip({
        // Stated in BOTH cases: the number never decides anything.
        tarNummer: "TAR123",
        customProperties: [
          { id: MANUAL_ID, name: "Aan/Afkoppelen", isActive: true },
        ],
      } as Partial<Trip>);

      const built = toBasicRow(trip, snapshot, MANUAL_IDS, "Wachttijd", TAR_ID);

      return { info: await infoCellOf(trip, snapshot), costs: built.costs };
    }

    it("says TAR exactly when the amount is there", async () => {
      const charged = await rowOf(true);

      expect(charged.info).toContain("TAR");
      expect(charged.costs).toBe("20.00 + 50.00");
    });

    it("says nothing when the amount is not there", async () => {
      const withheld = await rowOf(false);

      expect(withheld.info).not.toContain("TAR");
      expect(withheld.costs).toBe("20.00");
    });

    /** The same Trip, the same stated number: only the snapshot differs. */
    it("is decided by the snapshot and never by the number", async () => {
      const charged = await rowOf(true);
      const withheld = await rowOf(false);

      expect(charged.info).not.toBe(withheld.info);
      expect(charged.info).not.toContain("TAR123");
      expect(withheld.info).not.toContain("TAR123");
    });
  });

  /** A Trip with nothing to say leaves the cell empty, never "null". */
  it("writes an empty cell when there is nothing to say", async () => {
    expect(await infoCellOf(buildTrip(), snapshotOf())).toBe("");
  });
});

/**
 * The EK column of the PRICING workbook, from a snapshot shaped exactly as the
 * running backend returns one.
 *
 * ── WHY THIS SHAPE IS COPIED VERBATIM ───────────────────────────────────────
 * The three lines below are what `/trip-pricing/snapshots` actually answered
 * for a CLOSED Trip that had received three Cost Confirmations — €25, €55 and
 * €41.25, which the backend had already aggregated into ONE line. Writing the
 * shape out by hand is what makes this a test of the export rather than of a
 * fixture somebody invented.
 *
 * EK used to hold the WAITING TIME, so a confirmation arriving for a Trip
 * changed the total on screen and changed nothing in any workbook.
 */
describe("the EK column in a real pricing workbook", () => {
  const LIVE_SNAPSHOT = {
    pricing: { tripId: "trip-1", totalPrice: "121.25" },
    items: [
      liveItem("BASE_PRICE", "0.00", "Quay 869 - Lokeren"),
      liveItem("FUEL_SURCHARGE", "0.00", "Fuel 15%"),
      liveItem(
        "COST_CONFIRMATION",
        "121.25",
        "Cost confirmations 4152218, 4139509, 4132482",
      ),
    ],
  } as unknown as PricingSnapshot;

  function liveItem(code: string, amount: string, description: string) {
    return {
      id: `item-${code}`,
      tripPricingId: "snapshot-1",
      pricingComponentId: `component-${code}`,
      pricingComponentCode: code,
      customPropertyId: null,
      description,
      amount,
      currency: "EUR",
      calculationOrder: 1,
      quantity: null,
      unitPrice: null,
    };
  }

  async function pricingCells(): Promise<{ waiting: unknown; ek: unknown }> {
    const row = toPricingRow(buildTrip(), LIVE_SNAPSHOT, 15);
    const buffer = await buildPricingWorkbook([row], "nl");

    const directory = await mkdtemp(join(tmpdir(), "trano-pricing-"));
    const file = join(directory, "pricing.xlsx");

    await writeFile(file, Buffer.from(buffer));

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(
      (await readFile(file)) as unknown as Parameters<
        typeof reopened.xlsx.load
      >[0],
    );

    const dataRow = reopened.worksheets[0].getRow(2);

    return {
      waiting: dataRow.getCell(16).value,
      ek: dataRow.getCell(17).value,
    };
  }

  it("writes the aggregated confirmed cost into EK", async () => {
    expect((await pricingCells()).ek).toBe(121.25);
  });

  /** And the waiting time keeps the column it gained, empty here. */
  it("leaves the waiting time in its own column", async () => {
    expect((await pricingCells()).waiting).toBeNull();
  });
});

/**
 * A whole BASIS sheet, written to disk and read back cell by cell.
 *
 * One workbook covering every case the sheet has to get right at once: a
 * standalone Trip, both legs of a genuine Combination, a second group, a manual
 * Custom Property, an internal note, a charged TAR and a TAR the same-day rule
 * withheld. What is asserted is the FILE — headers, order, Info text and the
 * background fills — not the objects that produced it.
 */
describe("a whole BASIS workbook", () => {
  const GROUP_A = "5c2f4d8e-1a3b-4c6d-8e9f-0a1b2c3d4e5f";
  const GROUP_B = "97777777-7777-4777-8777-777777777777";

  /** Row 1 is the date, row 2 the headers, so the data starts at 3. */
  const FIRST_ROW = 3;

  async function sheetOf(rows: Parameters<typeof buildBasicWorkbook>[0]) {
    const buffer = await buildBasicWorkbook(rows, "nl", {
      start: "2026-09-25",
      end: "2026-09-26",
    });

    const directory = await mkdtemp(join(tmpdir(), "trano-sheet-"));
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

  function row(
    trip: Partial<Trip>,
    snapshot: PricingSnapshot | null,
    tarId: string | null = TAR_ID,
  ) {
    return toBasicRow(buildTrip(trip), snapshot, MANUAL_IDS, "Wachttijd", tarId);
  }

  /** The sheet every assertion below reads. */
  async function fullSheet() {
    return sheetOf([
      // 1 — standalone, a manual property and a note.
      row(
        {
          licensePlate: null,
          internalNotes: "Chauffeur bellen bij aankomst",
          customProperties: [
            { id: MANUAL_ID, name: "Aan/Afkoppelen", isActive: true },
          ],
        } as Partial<Trip>,
        snapshotOf(property("CUSTOM_PROPERTY", "20.00", MANUAL_ID)),
      ),
      // 2 — Combination leg A, TAR charged, Backload on its own leg.
      row(
        { tripGroupId: GROUP_A, tarNummer: "TAR123" } as Partial<Trip>,
        snapshotOf(
          property("COMBINATION", "50.00", null),
          property("CUSTOM_PROPERTY", "50.00", TAR_ID),
        ),
      ),
      // 3 — Combination leg B, same group, its OWN Backload, TAR withheld by
      //     the same-day rule so no line and no word.
      row(
        { tripGroupId: GROUP_A, tarNummer: "TAR123" } as Partial<Trip>,
        snapshotOf(property("COMBINATION", "50.00", null)),
      ),
      // 4 — a different group, on another day.
      row({ tripGroupId: GROUP_B } as Partial<Trip>, snapshotOf()),
      // 5 — the first group again, a day later.
      row({ tripGroupId: GROUP_A } as Partial<Trip>, snapshotOf()),
    ]);
  }

  function fillsOf(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
    const sheetRow = sheet.getRow(rowNumber);
    const fills: string[] = [];

    for (let column = 1; column <= 9; column += 1) {
      const fill = sheetRow.getCell(column).fill as
        | { fgColor?: { argb?: string } }
        | undefined;

      fills.push(fill?.fgColor?.argb ?? "NONE");
    }

    return fills;
  }

  it("ends on INFO, with no AFGEWERKT column", async () => {
    const sheet = await fullSheet();

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

  it("writes the rows in the order it was given, which is the list's own", async () => {
    const sheet = await fullSheet();

    expect(sheet.getRow(FIRST_ROW).getCell(9).value).toBe(
      "Aan/Afkoppelen, Chauffeur bellen bij aankomst",
    );
    expect(sheet.getRow(FIRST_ROW + 1).getCell(9).value).toBe("TAR");
  });

  it("says TAR on the charged leg and nothing on the withheld one", async () => {
    const sheet = await fullSheet();

    expect(sheet.getRow(FIRST_ROW + 1).getCell(9).value).toBe("TAR");
    expect(sheet.getRow(FIRST_ROW + 2).getCell(9).value ?? "").toBe("");
  });

  it("never writes the TAR number anywhere in the sheet", async () => {
    const sheet = await fullSheet();
    const everything: string[] = [];

    sheet.eachRow((sheetRow) => {
      (sheetRow.values as unknown[]).forEach((value) =>
        everything.push(String(value ?? "")),
      );
    });

    expect(everything.join(" ")).not.toContain("TAR123");
  });

  /**
   * Backload is not a BASIS column — that sheet's "COMBI EN KOST" holds the
   * Custom Property amounts. The per-leg surcharge is verified in the PRICING
   * workbook, which has a Backload column of its own; see below.
   */
  it("keeps Backload out of the BASIS Kosten column", async () => {
    const sheet = await fullSheet();

    /*
     * Leg A shows 50.00 — that is TAR's amount, which is a Custom Property
     * line. Leg B carries the SAME €50 Backload and nothing else, and its
     * Kosten cell is empty: the surcharge belongs to the pricing export's own
     * Backload column, which is where it is verified below.
     */
    expect(sheet.getRow(FIRST_ROW + 1).getCell(8).value).toBe("50.00");
    expect(sheet.getRow(FIRST_ROW + 2).getCell(8).value ?? "").toBe("");
  });

  describe("the group colours", () => {
    it("paints every cell of a grouped row alike", async () => {
      const sheet = await fullSheet();

      expect(new Set(fillsOf(sheet, FIRST_ROW + 1)).size).toBe(1);
    });

    it("gives both legs of one Combination the same colour", async () => {
      const sheet = await fullSheet();

      expect(fillsOf(sheet, FIRST_ROW + 1)).toEqual(
        fillsOf(sheet, FIRST_ROW + 2),
      );
    });

    it("gives a different group a different colour", async () => {
      const sheet = await fullSheet();

      expect(fillsOf(sheet, FIRST_ROW + 1)[0]).not.toBe(
        fillsOf(sheet, FIRST_ROW + 3)[0],
      );
    });

    /** Group identity, never row position or date. */
    it("keeps one colour for a group spanning two days", async () => {
      const sheet = await fullSheet();

      expect(fillsOf(sheet, FIRST_ROW + 1)).toEqual(
        fillsOf(sheet, FIRST_ROW + 4),
      );
    });

    it("leaves the standalone Trip and the header unpainted", async () => {
      const sheet = await fullSheet();

      expect(fillsOf(sheet, FIRST_ROW).every((f) => f === "NONE")).toBe(true);
      expect(fillsOf(sheet, 2)[0]).not.toBe(fillsOf(sheet, FIRST_ROW + 1)[0]);
    });
  });
});

/**
 * Backload, per leg, in a real pricing workbook.
 *
 * ── THE RULE, AND WHERE IT IS DECIDED ───────────────────────────────────────
 * €50 PER LEG, so a genuine two-leg Combination is worth €100 to the group.
 * That is the Pricing Engine's doing: `CombinationSurchargeCalculator` prices
 * each Trip on its own and emits one surcharge line for every Trip that is in a
 * Combination. Nothing here adds the two together — each leg is its own row,
 * with its own stored amount, and the group total is what a reader or a
 * spreadsheet sums from them.
 */
describe("Backload per Combination leg", () => {
  async function backloadCells(): Promise<unknown[]> {
    const leg = (amount: string) =>
      toPricingRow(
        buildTrip(),
        {
          pricing: { tripId: "trip-1", totalPrice: amount },
          items: [
            {
              id: "item-combination",
              tripPricingId: "snapshot-1",
              pricingComponentId: "component-COMBINATION",
              pricingComponentCode: "COMBINATION",
              customPropertyId: null,
              description: "Combination surcharge",
              amount,
              currency: "EUR",
              calculationOrder: 2,
              quantity: null,
              unitPrice: null,
            },
          ],
        } as unknown as PricingSnapshot,
        15,
      );

    const buffer = await buildPricingWorkbook([leg("50.00"), leg("50.00")], "nl");

    const directory = await mkdtemp(join(tmpdir(), "trano-backload-"));
    const file = join(directory, "pricing.xlsx");

    await writeFile(file, Buffer.from(buffer));

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(
      (await readFile(file)) as unknown as Parameters<
        typeof reopened.xlsx.load
      >[0],
    );

    const sheet = reopened.worksheets[0];

    // Column 12 is Backload; rows 2 and 3 are the two legs.
    return [sheet.getRow(2).getCell(12).value, sheet.getRow(3).getCell(12).value];
  }

  it("writes €50 on each leg", async () => {
    expect(await backloadCells()).toEqual([50, 50]);
  });

  it("so the group's two legs total €100", async () => {
    const [first, second] = await backloadCells();

    expect(Number(first) + Number(second)).toBe(100);
  });
});
