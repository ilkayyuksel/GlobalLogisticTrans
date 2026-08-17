import ExcelJS from "exceljs";

import { buildTripWorkbook, exportFileName } from "./export-workbook";
import type { Trip } from "@/lib/api/types";

/**
 * The exported file.
 *
 * The point of these tests is that this is a REAL workbook: it is written by a
 * spreadsheet library and read back by one, which a CSV under an .xlsx name
 * could never survive.
 */

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    tripGroupId: null,
    status: "OPEN",
    bookingNumber: "ANRDUB2602247",
    containerNumber: "MSKU1234567",
    containerType: "45PH",
    terminal: "PSA Quay 869",
    destinationCity: "Dourges",
    destinationCountry: "France",
    planningDate: "2026-08-13",
    startTime: "10:00:00",
    endTime: "16:00:00",
    waitingTimeMinutes: null,
    vehicle: {
      id: "vehicle-1",
      licensePlate: "1-ABC-123",
      displayColor: "#2563eb",
      isActive: true,
    },
    effectiveDriver: {
      id: "driver-1",
      name: "Piet Janssens",
      isActive: true,
      source: "VEHICLE_ASSIGNMENT",
    },
    ...overrides,
  } as Trip;
}

async function readBack(buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  return workbook.worksheets[0];
}

describe("The Ritten export workbook", () => {
  it("is a real xlsx file, not a renamed CSV", async () => {
    const buffer = await buildTripWorkbook([trip()], "nl");
    const firstBytes = new Uint8Array(buffer).slice(0, 2);

    // Every xlsx is a zip archive, and every zip starts with "PK".
    expect(String.fromCharCode(...firstBytes)).toBe("PK");
  });

  it("can be reopened as a workbook", async () => {
    const sheet = await readBack(await buildTripWorkbook([trip()], "nl"));

    expect(sheet.name).toBe("Ritten");
    expect(sheet.rowCount).toBe(2);
  });

  it("heads the columns in the operator's language", async () => {
    const sheet = await readBack(await buildTripWorkbook([trip()], "nl"));
    const header = sheet.getRow(1).values as string[];

    expect(header).toContain("Booking");
    expect(header).toContain("Nummerplaat");
    expect(header).toContain("Chauffeur");
    expect(header).toContain("Wachttijd");
  });

  it("is written in Turkish when that is the language", async () => {
    const sheet = await readBack(await buildTripWorkbook([trip()], "tr"));
    const header = sheet.getRow(1).values as string[];

    expect(sheet.name).toBe("Seferler");
    expect(header).toContain("Plaka");
    expect(header).toContain("Şoför");
  });

  it("writes the values the backend supplied", async () => {
    const sheet = await readBack(
      await buildTripWorkbook([trip({ waitingTimeMinutes: 45 })], "nl"),
    );
    const row = sheet.getRow(2).values as unknown[];

    expect(row).toContain("ANRDUB2602247");
    expect(row).toContain("PSA Quay 869");
    expect(row).toContain("1-ABC-123");
    // The resolved driver, never one derived here.
    expect(row).toContain("Piet Janssens");
    expect(row).toContain("Dourges, France");
    expect(row).toContain(45);
  });

  /** A planning date is a calendar date; a spreadsheet must not shift it. */
  it("keeps the planning date exactly as the backend sent it", async () => {
    const sheet = await readBack(await buildTripWorkbook([trip()], "nl"));

    expect((sheet.getRow(2).values as unknown[])).toContain("2026-08-13");
  });

  it("marks a Combination leg with its group", async () => {
    const sheet = await readBack(
      await buildTripWorkbook(
        [trip({ tripGroupId: "97777777-7777-4777-8777-777777777777" })],
        "nl",
      ),
    );

    expect(sheet.getRow(2).values as unknown[]).toContain("G-9777");
  });

  it("writes one row per Trip", async () => {
    const sheet = await readBack(
      await buildTripWorkbook(
        [trip(), trip({ id: "trip-2", bookingNumber: "ANRBEL2603249" })],
        "nl",
      ),
    );

    expect(sheet.rowCount).toBe(3);
  });

  /** No money: a total here could disagree with the stored snapshot. */
  it("carries no pricing", async () => {
    const sheet = await readBack(await buildTripWorkbook([trip()], "nl"));
    const header = (sheet.getRow(1).values as string[]).join(" ");

    expect(header.toLowerCase()).not.toContain("prij");
    expect(header.toLowerCase()).not.toContain("price");
  });

  describe("the file name", () => {
    it("names a single day", () => {
      expect(exportFileName("2026-08-13", "2026-08-13")).toBe(
        "traxo-ritten-2026-08-13.xlsx",
      );
    });

    it("names a range", () => {
      expect(exportFileName("2026-08-10", "2026-08-16")).toBe(
        "traxo-ritten-2026-08-10_2026-08-16.xlsx",
      );
    });
  });
});
