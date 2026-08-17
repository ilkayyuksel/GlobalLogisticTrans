import type { Trip } from "@/lib/api/types";
import { toPricingRow } from "./export-rows";
import { buildPricingWorkbook } from "./export-workbooks";

/**
 * A whole Combination, from Trips to the cells an operator opens.
 *
 * The two legs here carry the values the real `combination.pdf` produces —
 * DUBANR2598395 as the DELIVERY out of `Quay 869`, ANRBEL2603249 as the
 * COLLECTION from `PSA Quay 869` — so the workbook is exercised on the shape a
 * genuine document actually makes, not on a convenient one.
 */
const GROUP_ID = "97777777-7777-4777-8777-777777777777";

function leg(overrides: Partial<Trip>): Trip {
  return {
    id: `trip-${overrides.bookingNumber}`,
    status: "CLOSED",
    tripGroupId: GROUP_ID,
    planningDate: "2026-06-29",
    startTime: "07:00:00",
    endTime: "15:00:00",
    containerType: "45PH",
    containerNumber: null,
    vehicle: null,
    customProperties: [],
    waitingTimeMinutes: null,
    ...overrides,
  } as Trip;
}

const DELIVERY_LEG = leg({
  bookingNumber: "DUBANR2598395",
  direction: "DELIVERY",
  terminal: "Quay 869",
  destinationCity: "Kallo",
});

const COLLECTION_LEG = leg({
  bookingNumber: "ANRBEL2603249",
  direction: "COLLECTION",
  terminal: "PSA Quay 869",
  destinationCity: "Warneton",
});

async function reopen(buffer: ArrayBuffer) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();

  await workbook.xlsx.load(buffer as never);

  return workbook.worksheets[0];
}

/** The two columns under test, read from the produced file. */
async function routeCellsOf(trips: readonly Trip[]) {
  const rows = trips.map((trip) => toPricingRow(trip, null, 15));
  const sheet = await reopen(await buildPricingWorkbook(rows, "nl"));
  const cells: { booking: unknown; start: unknown; end: unknown }[] = [];

  for (let row = 2; row <= trips.length + 1; row += 1) {
    cells.push({
      booking: sheet.getRow(row).getCell(5).value,
      start: sheet.getRow(row).getCell(7).value,
      end: sheet.getRow(row).getCell(9).value,
    });
  }

  return { sheet, cells };
}

describe("a Combination in the pricing workbook", () => {
  it("writes exactly two rows — one per Trip, and no extra row for the pair", async () => {
    const { sheet } = await routeCellsOf([DELIVERY_LEG, COLLECTION_LEG]);

    // Header plus two legs.
    expect(sheet.rowCount).toBe(3);
  });

  it("labels the delivery leg from the quay to the join", async () => {
    const { cells } = await routeCellsOf([DELIVERY_LEG]);

    expect(cells[0]).toEqual({
      booking: "DUBANR2598395",
      start: "VOYAGE BEQ869",
      end: "COMBINATION",
    });
  });

  it("labels the collection leg from the join back to the quay", async () => {
    const { cells } = await routeCellsOf([COLLECTION_LEG]);

    expect(cells[0]).toEqual({
      booking: "ANRBEL2603249",
      start: "COMBINATION",
      end: "VOYAGE BEQ869",
    });
  });

  /**
   * Both legs name `Quay 869` in some form, and they get different labels. That
   * is the proof the labels follow the stored direction rather than the text of
   * a terminal.
   */
  it("distinguishes the legs by direction, not by terminal", async () => {
    const { cells } = await routeCellsOf([DELIVERY_LEG, COLLECTION_LEG]);

    expect(cells[0].start).not.toBe(cells[1].start);
    expect(cells[0].end).toBe(cells[1].start);
  });

  it("still shows each leg's own stored route in the Trip column", async () => {
    const rows = [DELIVERY_LEG, COLLECTION_LEG].map((trip) =>
      toPricingRow(trip, null, 15),
    );
    const sheet = await reopen(await buildPricingWorkbook(rows, "nl"));

    expect(sheet.getRow(2).getCell(8).value).toBe("Quay 869 -> Kallo");
    expect(sheet.getRow(3).getCell(8).value).toBe("PSA Quay 869 -> Warneton");
  });
});

describe("a normal imported Trip in the workbook", () => {
  it("sends a delivery to its destination rather than to a join", async () => {
    const { cells } = await routeCellsOf([
      leg({
        bookingNumber: "ANRBEL2790641",
        direction: "DELIVERY",
        terminal: "Quay 869",
        destinationCity: "Gent",
        tripGroupId: null,
      }),
    ]);

    expect(cells[0]).toEqual({
      booking: "ANRBEL2790641",
      start: "VOYAGE BEQ869",
      end: "Gent",
    });
  });

  it("releases a collection at the quay and hands it over there", async () => {
    const { cells } = await routeCellsOf([
      leg({
        bookingNumber: "ANRDUB2789898",
        direction: "COLLECTION",
        terminal: "Quay 869",
        destinationCity: "Dourges",
        tripGroupId: null,
      }),
    ]);

    expect(cells[0]).toEqual({
      booking: "ANRDUB2789898",
      start: "RELEASE BEQ869",
      end: "VOYAGE BEQ869",
    });
  });

  /**
   * The Trip column still carries the real route, so a collection whose two
   * ends both name the quay has not lost where it actually went.
   */
  it("keeps the collection's real route in the Trip column", async () => {
    const rows = [
      leg({
        bookingNumber: "ANRDUB2789898",
        direction: "COLLECTION",
        terminal: "Quay 869",
        destinationCity: "Dourges",
        tripGroupId: null,
      }),
    ].map((trip) => toPricingRow(trip, null, 15));
    const sheet = await reopen(await buildPricingWorkbook(rows, "nl"));

    expect(sheet.getRow(2).getCell(8).value).toBe("Quay 869 -> Dourges");
  });
});

/**
 * The two delivery rows exactly as the operator's sheet shows them, read back
 * out of a produced file — Startpoint, Trip and Endpoint together, since it is
 * their combination that the sheet is recognised by.
 */
describe("the operator's delivery rows in the workbook", () => {
  async function deliveryRow(city: string) {
    const trip = leg({
      bookingNumber: `ANRBEL27906${city.length}`,
      direction: "DELIVERY",
      terminal: "Quay 869",
      destinationCity: city,
      tripGroupId: null,
    });
    const sheet = await reopen(
      await buildPricingWorkbook([toPricingRow(trip, null, 15)], "nl"),
    );

    return [7, 8, 9].map((cell) => sheet.getRow(2).getCell(cell).value);
  }

  it("writes the Zeebrugge row", async () => {
    expect(await deliveryRow("ZEEBRUGGE")).toEqual([
      "VOYAGE BEQ869",
      "Quay 869 -> ZEEBRUGGE",
      "LOCATION BEQ869",
    ]);
  });

  it("writes the Lessines row", async () => {
    expect(await deliveryRow("LESSINES")).toEqual([
      "VOYAGE BEQ869",
      "Quay 869 -> LESSINES",
      "LOCATION BEBAXLES",
    ]);
  });

  it("writes the stored city for a destination with no code", async () => {
    expect(await deliveryRow("Grobbendonk")).toEqual([
      "VOYAGE BEQ869",
      "Quay 869 -> Grobbendonk",
      "Grobbendonk",
    ]);
  });
});

describe("a manual Trip in the workbook", () => {
  it("shows its stored route and no invented vocabulary", async () => {
    const { cells } = await routeCellsOf([
      leg({
        bookingNumber: "",
        direction: null,
        tripGroupId: null,
        terminal: "Quay 869",
        destinationCity: "Gent",
      }),
    ]);

    expect(cells[0].start).toBe("Quay 869");
    expect(cells[0].end).toBe("Gent");
    expect(String(cells[0].start)).not.toMatch(/VOYAGE|BEQ/);
  });

  it("leaves both ends empty when the Trip holds neither", async () => {
    const { cells } = await routeCellsOf([
      leg({
        bookingNumber: "",
        direction: null,
        tripGroupId: null,
        terminal: null,
        destinationCity: null,
      }),
    ]);

    expect(cells[0].start ?? "").toBe("");
    expect(cells[0].end ?? "").toBe("");
  });
});
