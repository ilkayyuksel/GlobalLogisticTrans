import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExcelJS from "exceljs";

import { buildTrip } from "@/app/trips/ritten-test-support";
import { request } from "@/lib/api/client";
import type { PricingSnapshot, Trip } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { downloadWorkbook } from "@/lib/ritten/export-workbook";
import {
  periodEnd,
  periodQuery,
  periodStart,
  type RittenView,
} from "@/lib/ritten/period";
import { ExportButton } from "./export-button";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

// The workbook the button would have saved, captured instead of downloaded.
jest.mock("@/lib/ritten/export-workbook", () => ({
  ...jest.requireActual("@/lib/ritten/export-workbook"),
  downloadWorkbook: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;
const downloadMock = downloadWorkbook as jest.MockedFunction<
  typeof downloadWorkbook
>;

/**
 * A Combination leg's Backload in BASIS, whatever the exported period holds.
 *
 * ── THE INVARIANT ───────────────────────────────────────────────────────────
 * A Trip whose OWN stored snapshot holds a COMBINATION line prints that amount
 * in COMBI EN KOST. Whether the other leg is in the export, on another day,
 * outside the range or filtered away is irrelevant: the Engine already decided
 * the Combination, per leg, and the export only reads what it stored.
 *
 * ── WHY THROUGH THE BUTTON ──────────────────────────────────────────────────
 * The whole production chain runs here: `periodQuery` → `fetchTripsForExport`
 * → `fetchPricingSnapshots` → `toBasicRow` → `toCostsLabel` →
 * `buildBasicWorkbook`, and the .xlsx it produced is read back from disk. Only
 * the transport is faked, and the fake backend FILTERS like the real one: a
 * leg outside the period is genuinely absent from the Trips the export
 * receives, and its snapshot is never asked for. So a mapper that rebuilt the
 * Combination from the exported rows — "show 50 only when the partner is here"
 * — would fail every single-leg case below.
 * ────────────────────────────────────────────────────────────────────────────
 */

const DAY_1 = "2026-09-10";
const DAY_2 = "2026-09-11";
const NEXT_WEEK = "2026-09-14";

const GROUP = "5a1e7c1e-0000-4000-8000-00000000c0b1";
const DOCUMENT = "pdf-combination";
const TAR_PROPERTY_ID = "4446fdc0-0000-4000-8000-000000000001";

const DELIVERY = "DUBANR2598395";
const COLLECTION = "ANRBEL2603249";

type Line = readonly [code: string, amount: string, customPropertyId?: string];

/** A stored snapshot, shaped exactly as `GET /trip-pricing/snapshots` sends it. */
function snapshotOf(tripId: string, lines: readonly Line[]): PricingSnapshot {
  const pricingId = `pricing-${tripId}`;
  const stamp = "2026-09-10T15:00:00.000Z";

  return {
    pricing: {
      id: pricingId,
      tripId,
      totalPrice: "0.00",
      currency: "EUR",
      calculatedAt: stamp,
      pricingEngineVersion: "1.0.0",
      pricingRuleVersion: "2026.1",
      calculationStatus: "CALCULATED",
      notes: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
    items: lines.map(([code, amount, customPropertyId], index) => ({
      id: `${pricingId}-${index}`,
      tripPricingId: pricingId,
      pricingComponentId: `component-${code}`,
      pricingComponentCode: code,
      customPropertyId: customPropertyId ?? null,
      description: code,
      amount,
      currency: "EUR",
      calculationOrder: index + 1,
      quantity: null,
      unitPrice: null,
      notes: null,
      createdAt: stamp,
      updatedAt: stamp,
    })),
  };
}

/** What the Engine stores for a genuine leg: its own €50 Backload. */
const COMBINATION_LEG: readonly Line[] = [
  ["BASE_PRICE", "0.00"],
  ["COMBINATION", "50.00"],
  ["FUEL_SURCHARGE", "0.00"],
];

/** One genuine Combination: one group, one document, DELIVERY + COLLECTION. */
function genuinePair(deliveryDate: string, collectionDate: string) {
  const delivery = buildTrip({
    id: "leg-delivery",
    bookingNumber: DELIVERY,
    direction: "DELIVERY",
    tripGroupId: GROUP,
    pdfDocumentId: DOCUMENT,
    status: "CLOSED",
    planningDate: deliveryDate,
    originalPlanningDate: deliveryDate,
  });
  const collection = buildTrip({
    id: "leg-collection",
    bookingNumber: COLLECTION,
    direction: "COLLECTION",
    tripGroupId: GROUP,
    pdfDocumentId: DOCUMENT,
    status: "CLOSED",
    planningDate: collectionDate,
    originalPlanningDate: deliveryDate,
  });

  return { delivery, collection };
}

interface Backend {
  readonly trips: readonly Trip[];
  readonly snapshots: readonly PricingSnapshot[];
}

/** Every request the export made, so a spec can say what was — and was not — asked. */
let asked: { tripQueries: Record<string, unknown>[]; snapshotIds: string[] };

function inQuery(trip: Trip, query: Record<string, unknown>): boolean {
  const date = trip.planningDate ?? "";
  const inPeriod =
    typeof query.planningDate === "string"
      ? date === query.planningDate
      : date >= String(query.planningDateFrom) &&
        date <= String(query.planningDateTo);
  const matchesSearch =
    typeof query.search !== "string" ||
    (trip.bookingNumber ?? "").includes(query.search);

  return inPeriod && matchesSearch;
}

/** Answers the client the way the backend does: filtered, and by Trip id. */
function serve(backend: Backend): void {
  requestMock.mockImplementation(((path: string, options?: { query?: Record<string, unknown> }) => {
    const query = options?.query ?? {};

    if (path === "/api/v1/trips") {
      asked.tripQueries.push(query);
      const items = backend.trips.filter((trip) => inQuery(trip, query));

      return Promise.resolve({
        items,
        meta: { page: 1, pageSize: 200, totalItems: items.length, totalPages: 1 },
      });
    }

    if (path === "/api/v1/trip-pricing/snapshots") {
      const ids = String(query.tripIds).split(",");

      asked.snapshotIds.push(...ids);

      return Promise.resolve(
        backend.snapshots.filter((snapshot) => ids.includes(snapshot.pricing.tripId)),
      );
    }

    if (path === "/api/v1/custom-properties") {
      const tar = {
        id: TAR_PROPERTY_ID,
        name: "TAR",
        description: null,
        pricingComponentId: null,
        defaultPrice: "50.00",
        isActive: true,
        isSystemManaged: true,
      };

      return Promise.resolve({
        items: [tar],
        meta: { page: 1, pageSize: 200, totalItems: 1, totalPages: 1 },
      });
    }

    if (path === "/api/v1/settings") {
      return Promise.resolve([
        {
          id: "setting-automatic",
          category: "PRICING",
          key: "AUTOMATIC_CUSTOM_PROPERTY_ID",
          value: TAR_PROPERTY_ID,
          valueType: "STRING",
          description: null,
        },
      ]);
    }

    return Promise.reject(new Error(`unexpected request: ${path}`));
  }) as unknown as typeof request);
}

interface SheetRow {
  readonly costs: string;
  readonly info: string;
  readonly fill: string;
}

/**
 * Presses "Excel — Basis" for a period and reads the REAL file back.
 *
 * The buffer handed to `downloadWorkbook` is written to disk and reopened, so
 * what is asserted is the workbook an operator would open.
 */
async function exportBasis(
  backend: Backend,
  view: RittenView,
  anchor: string,
  filters: { search?: string } = {},
): Promise<Map<string, SheetRow>> {
  serve(backend);
  render(
    <LanguageProvider>
      <ExportButton
        query={{
          ...periodQuery(view, anchor),
          ...filters,
          sortBy: "licensePlate",
          sortDirection: "asc",
        }}
        periodStart={periodStart(view, anchor)}
        periodEnd={periodEnd(view, anchor)}
      />
    </LanguageProvider>,
  );

  await userEvent.click(screen.getByRole("button", { name: "Excel — Basis" }));
  await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));

  const directory = await mkdtemp(join(tmpdir(), "trano-basis-period-"));
  const file = join(directory, "basis.xlsx");

  await writeFile(file, Buffer.from(downloadMock.mock.calls[0][0]));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await readFile(file)) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  const sheet = workbook.worksheets[0];
  const header = (sheet.getRow(2).values as unknown[]).slice(1).map(String);
  const column = (name: string) => header.indexOf(name) + 1;
  const rows = new Map<string, SheetRow>();

  for (let index = 3; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const fill = row.getCell(1).fill as { fgColor?: { argb?: string } } | undefined;

    rows.set(String(row.getCell(column("BOEKING")).value), {
      costs: String(row.getCell(column("COMBI EN KOST")).value ?? ""),
      info: String(row.getCell(column("INFO")).value ?? ""),
      fill: fill?.fgColor?.argb ?? "NONE",
    });
  }

  return rows;
}

describe("BASIS Backload comes from each Trip's own snapshot", () => {
  beforeEach(() => {
    requestMock.mockReset();
    downloadMock.mockReset();
    asked = { tripQueries: [], snapshotIds: [] };
  });

  function pairBackend(deliveryDate: string, collectionDate: string): Backend {
    const { delivery, collection } = genuinePair(deliveryDate, collectionDate);

    return {
      trips: [delivery, collection],
      snapshots: [
        snapshotOf(delivery.id, COMBINATION_LEG),
        snapshotOf(collection.id, COMBINATION_LEG),
      ],
    };
  }

  it("1. same-day Combination, both legs exported → €50 on each", async () => {
    const rows = await exportBasis(pairBackend(DAY_1, DAY_1), "day", DAY_1);

    expect(rows.get(DELIVERY)?.costs).toBe("50.00");
    expect(rows.get(COLLECTION)?.costs).toBe("50.00");
  });

  it("2. cross-day Combination, both days exported → €50 on each", async () => {
    const rows = await exportBasis(pairBackend(DAY_1, DAY_2), "week", DAY_1);

    expect([...rows.keys()].sort()).toEqual([COLLECTION, DELIVERY]);
    expect(rows.get(DELIVERY)?.costs).toBe("50.00");
    expect(rows.get(COLLECTION)?.costs).toBe("50.00");
  });

  it("3. cross-day, DAY 1 only → the DAY 1 leg still prints €50", async () => {
    const rows = await exportBasis(pairBackend(DAY_1, DAY_2), "day", DAY_1);

    expect([...rows.keys()]).toEqual([DELIVERY]);
    expect(rows.get(DELIVERY)?.costs).toBe("50.00");
  });

  it("4. cross-day, DAY 2 only → the DAY 2 leg still prints €50", async () => {
    const rows = await exportBasis(pairBackend(DAY_1, DAY_2), "day", DAY_2);

    expect([...rows.keys()]).toEqual([COLLECTION]);
    expect(rows.get(COLLECTION)?.costs).toBe("50.00");
  });

  it("5. partner outside the export range → the exported leg prints €50", async () => {
    // The collection runs next week; the export covers this week only.
    const rows = await exportBasis(pairBackend(DAY_2, NEXT_WEEK), "week", DAY_1);

    expect([...rows.keys()]).toEqual([DELIVERY]);
    expect(rows.get(DELIVERY)?.costs).toBe("50.00");
  });

  it("6. partner filtered out of the export query → the exported leg prints €50", async () => {
    // Same day, but the search matches only the delivery leg.
    const rows = await exportBasis(pairBackend(DAY_1, DAY_1), "day", DAY_1, {
      search: "DUBANR",
    });

    expect([...rows.keys()]).toEqual([DELIVERY]);
    expect(rows.get(DELIVERY)?.costs).toBe("50.00");
  });

  it("7. Combination + Waiting Time → `50.00 + 55.00`", async () => {
    const { delivery, collection } = genuinePair(DAY_1, DAY_2);
    const waited = {
      ...collection,
      waitingTimeStart: "07:00:00",
      waitingTimeEnd: "10:00:00",
      waitingTimeMinutes: 180,
    };

    const rows = await exportBasis(
      {
        trips: [delivery, waited],
        snapshots: [
          snapshotOf(delivery.id, COMBINATION_LEG),
          snapshotOf(waited.id, [...COMBINATION_LEG, ["WAITING_TIME", "55.00"]]),
        ],
      },
      "day",
      DAY_2,
    );

    expect(rows.get(COLLECTION)).toMatchObject({
      costs: "50.00 + 55.00",
      info: "Wachttijd 07:00-10:00",
    });
  });

  describe("8. Combination + automatic TAR on one leg", () => {
    function tarBackend(): Backend {
      const { delivery, collection } = genuinePair(DAY_1, DAY_2);
      const numbered = { ...delivery, tarNummer: "TARXD1" };

      return {
        trips: [numbered, collection],
        snapshots: [
          snapshotOf(numbered.id, [
            ...COMBINATION_LEG,
            ["CUSTOM_PROPERTY", "50.00", TAR_PROPERTY_ID],
          ]),
          snapshotOf(collection.id, COMBINATION_LEG),
        ],
      };
    }

    it("DAY 1 only: Backload first, TAR beside it, TAR named in Info", async () => {
      const rows = await exportBasis(tarBackend(), "day", DAY_1);

      expect(rows.get(DELIVERY)).toMatchObject({ costs: "50.00 + 50.00", info: "TAR" });
    });

    it("DAY 2 only: the leg without TAR still prints its €50", async () => {
      const rows = await exportBasis(tarBackend(), "day", DAY_2);

      expect(rows.get(COLLECTION)).toMatchObject({ costs: "50.00", info: "" });
    });

    it("never prints the TAR number", async () => {
      const rows = await exportBasis(tarBackend(), "week", DAY_1);

      for (const row of rows.values()) {
        expect(`${row.costs} ${row.info}`).not.toContain("TARXD1");
      }
    });
  });

  it("9. a standalone Trip prints no Combination amount", async () => {
    const standalone = buildTrip({
      id: "standalone",
      bookingNumber: "ANRDUB0000001",
      status: "CLOSED",
      planningDate: DAY_1,
    });

    const rows = await exportBasis(
      {
        trips: [standalone],
        snapshots: [
          snapshotOf(standalone.id, [
            ["BASE_PRICE", "300.00"],
            ["FUEL_SURCHARGE", "45.00"],
          ]),
        ],
      },
      "day",
      DAY_1,
    );

    expect(rows.get("ANRDUB0000001")).toMatchObject({ costs: "", fill: "NONE" });
  });

  it("10. a manual group without a COMBINATION line prints no Backload — but keeps its colour", async () => {
    const first = buildTrip({
      id: "manual-1",
      bookingNumber: "MANUAL0000001",
      tripGroupId: GROUP,
      pdfDocumentId: "pdf-one",
      status: "CLOSED",
      planningDate: DAY_1,
    });
    const second = buildTrip({
      id: "manual-2",
      bookingNumber: "MANUAL0000002",
      tripGroupId: GROUP,
      pdfDocumentId: "pdf-two",
      status: "CLOSED",
      planningDate: DAY_1,
    });

    const rows = await exportBasis(
      {
        trips: [first, second],
        snapshots: [
          snapshotOf(first.id, [["BASE_PRICE", "300.00"]]),
          snapshotOf(second.id, [["BASE_PRICE", "300.00"]]),
        ],
      },
      "day",
      DAY_1,
    );

    expect(rows.get("MANUAL0000001")?.costs).toBe("");
    expect(rows.get("MANUAL0000002")?.costs).toBe("");
    // Colour follows the group; money does not.
    expect(rows.get("MANUAL0000001")?.fill).not.toBe("NONE");
    expect(rows.get("MANUAL0000001")?.fill).toBe(rows.get("MANUAL0000002")?.fill);
  });

  describe("what the export asks the backend", () => {
    /*
     * No partner lookup and no widened range: the Trip query is exactly the
     * requested period, and snapshots are asked for the exported Trips only.
     */
    it("asks for the period as requested and only the exported Trips' snapshots", async () => {
      await exportBasis(pairBackend(DAY_1, DAY_2), "day", DAY_1);

      expect(asked.tripQueries).toHaveLength(1);
      expect(asked.tripQueries[0]).toMatchObject({ planningDate: DAY_1 });
      expect(asked.tripQueries[0].planningDateFrom).toBeUndefined();
      expect(asked.snapshotIds).toEqual(["leg-delivery"]);
    });

    /** Each leg reads ONLY its own line: a partner without one changes nothing. */
    it("prints a leg's €50 even when the partner's snapshot holds no COMBINATION line", async () => {
      const { delivery, collection } = genuinePair(DAY_1, DAY_1);

      const rows = await exportBasis(
        {
          trips: [delivery, collection],
          snapshots: [
            snapshotOf(delivery.id, COMBINATION_LEG),
            snapshotOf(collection.id, [["BASE_PRICE", "0.00"]]),
          ],
        },
        "day",
        DAY_1,
      );

      expect(rows.get(DELIVERY)?.costs).toBe("50.00");
      expect(rows.get(COLLECTION)?.costs).toBe("");
    });

    it("paints a lone leg in its group colour without that deciding its amount", async () => {
      const day1 = await exportBasis(pairBackend(DAY_1, DAY_2), "day", DAY_1);

      expect(day1.get(DELIVERY)?.fill).not.toBe("NONE");
      expect(day1.get(DELIVERY)?.costs).toBe("50.00");
    });
  });

  /**
   * After a regrouping the backend reprices the affected legs, and BASIS just
   * reads what it stored. Nothing here knows a group changed: a leg grouped
   * into a Combination has a COMBINATION line and prints it, a leg taken out
   * was repriced without one and prints nothing.
   */
  describe("after grouping or ungrouping", () => {
    it("22. prints €50 for a leg repriced into a Combination", async () => {
      const rows = await exportBasis(pairBackend(DAY_1, DAY_2), "day", DAY_1);

      expect(rows.get(DELIVERY)?.costs).toBe("50.00");
    });

    it("23. prints no €50 for a leg repriced out of its Combination", async () => {
      const { delivery, collection } = genuinePair(DAY_1, DAY_1);
      const alone = { ...delivery, tripGroupId: null };

      const rows = await exportBasis(
        {
          trips: [alone, { ...collection, tripGroupId: null }],
          snapshots: [
            snapshotOf(alone.id, [["BASE_PRICE", "0.00"], ["FUEL_SURCHARGE", "0.00"]]),
            snapshotOf(collection.id, [["BASE_PRICE", "0.00"]]),
          ],
        },
        "day",
        DAY_1,
      );

      expect(rows.get(DELIVERY)).toMatchObject({ costs: "", fill: "NONE" });
      expect(rows.get(COLLECTION)).toMatchObject({ costs: "", fill: "NONE" });
    });

    it("24. prints each repriced leg's €50 in a cross-day export of either day", async () => {
      const dayOne = await exportBasis(pairBackend(DAY_1, DAY_2), "day", DAY_1);

      // A second, separate export: its own button, its own file.
      cleanup();
      downloadMock.mockReset();

      const dayTwo = await exportBasis(pairBackend(DAY_1, DAY_2), "day", DAY_2);

      expect(dayOne.get(DELIVERY)?.costs).toBe("50.00");
      expect(dayTwo.get(COLLECTION)?.costs).toBe("50.00");
    });
  });
});
