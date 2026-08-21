import type { BasicExportRow, PricingExportRow } from "./export-rows";
import {
  COMPLETED_MARK,
  NOT_COMPLETED_MARK,
  basicFileName,
  buildBasicWorkbook,
  buildPricingWorkbook,
  pricingFileName,
  toExcelDate,
  toExcelTime,
} from "./export-workbooks";

/**
 * The workbooks, verified by REOPENING them.
 *
 * Every assertion below reads the produced `.xlsx` back through ExcelJS rather
 * than inspecting the objects that went in. That is the only way to know what
 * an operator will actually see: a value written with the wrong type, or with a
 * format Excel reinterprets, is invisible until the file is opened.
 *
 * The date and time cells matter most. They are written as real Excel values —
 * a number of days, a fraction of a day — so they sort and filter; the FORMAT
 * is what pins the display to `DD/MM/YYYY` and `HH:mm`, whatever locale the
 * spreadsheet is opened in.
 */
async function reopen(buffer: ArrayBuffer) {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();

  await workbook.xlsx.load(buffer as never);

  return workbook.worksheets[0];
}

/**
 * A date cell, as the operator will read it: `DD/MM/YYYY`.
 *
 * ExcelJS hydrates a serial carrying a date format back into a Date, which is
 * itself the proof that the cell holds a real date value rather than text. The
 * parts are read in UTC because that is how the serial was built — a local
 * reading would shift the day for anyone west of it.
 */
function readDate(cell: { value: unknown }): string {
  const date = cell.value as Date;

  return [
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    date.getUTCFullYear(),
  ].join("/");
}

/** A time cell, as `HH:mm`. */
function readTime(cell: { value: unknown }): string {
  const date = cell.value as Date;

  return [
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
  ].join(":");
}

function buildPricingRow(
  overrides: Partial<PricingExportRow> = {},
): PricingExportRow {
  return {
    planningDate: "2026-06-29",
    startTime: "07:00:00",
    endTime: "15:00:00",
    containerType: "45PH",
    bookingNumber: "ANRDUB2602247",
    containerNumber: "MSKU1234567",
    startPoint: "Quay 869",
    trip: "Quay 869 -> Gent",
    endPoint: "Gent",
    basePrice: 250,
    fuelPercentage: 15,
    fuelAmount: 37.5,
    backload: null,
    toll: null,
    tunnel: null,
    others: null,
    waitingTime: null,
    remarks: "",
    ...overrides,
  };
}

function buildBasicRow(overrides: Partial<BasicExportRow> = {}): BasicExportRow {
  return {
    isCompleted: false,
    licensePlate: "1-ABC-123",
    startTime: "07:00:00",
    endTime: "15:00:00",
    bookingNumber: "ANRDUB2602247",
    containerType: "45PH",
    containerNumber: "MSKU1234567",
    trip: "Quay 869 -> Gent",
    costs: "",
    info: "",
    ...overrides,
  };
}

describe("Excel date and time values", () => {
  /** 29/06/2026 is day 46 202 in Excel's serial calendar. */
  it("writes a calendar date as an Excel serial", () => {
    expect(toExcelDate("2026-06-29")).toBe(46202);
  });

  /**
   * Built from the calendar parts, never through a JavaScript Date: an offset
   * would move a planning date a day for anyone west of UTC.
   */
  it("is timezone-independent", () => {
    expect(toExcelDate("2026-01-01")).toBe(toExcelDate("2026-01-01"));
    expect(toExcelDate("2026-06-29")! - toExcelDate("2026-06-28")!).toBe(1);
  });

  it("has nothing to write for an absent date", () => {
    expect(toExcelDate(null)).toBeNull();
    expect(toExcelDate("")).toBeNull();
  });

  it("writes a time as a fraction of a day", () => {
    expect(toExcelTime("07:00:00")).toBeCloseTo(7 / 24, 10);
    expect(toExcelTime("15:30:00")).toBeCloseTo(15.5 / 24, 10);
    expect(toExcelTime("00:00:00")).toBe(0);
  });

  it("has nothing to write for an absent time", () => {
    expect(toExcelTime(null)).toBeNull();
  });
});

describe("the pricing workbook", () => {
  it("has the seventeen columns, in the agreed order", async () => {
    const sheet = await reopen(await buildPricingWorkbook([], "nl"));

    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "Datum",
      "Begin",
      "Eind",
      "Containertype",
      "Bookingnr",
      "Containernr.",
      "Startpoint",
      "Trip",
      "Endpoint",
      "Tarief",
      "Brandstof (%)",
      "Backload",
      "Tol",
      "Tunnel",
      "Others",
      "EK",
      "Remarks",
    ]);
  });

  describe("dates and times, as they will be seen", () => {
    it("shows the date as DD/MM/YYYY", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([buildPricingRow()], "nl"),
      );
      const cell = sheet.getRow(2).getCell(1);

      // What an operator sees, and the format that guarantees it whatever
      // locale the spreadsheet is opened in.
      expect(readDate(cell)).toBe("29/06/2026");
      expect(cell.numFmt).toBe("dd/mm/yyyy");
    });

    it("shows the times as HH:mm", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([buildPricingRow()], "nl"),
      );

      expect(sheet.getRow(2).getCell(2).numFmt).toBe("hh:mm");
      expect(readTime(sheet.getRow(2).getCell(2))).toBe("07:00");
      expect(readTime(sheet.getRow(2).getCell(3))).toBe("15:00");
    });

    /** No ISO date may reach the spreadsheet. */
    it("writes no ISO date anywhere", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([buildPricingRow()], "nl"),
      );

      sheet.getRow(2).eachCell((cell) => {
        // Date and time cells are real values; only a TEXT cell could carry an
        // ISO string, and none may.
        if (cell.value instanceof Date) {
          return;
        }

        expect(String(cell.value ?? "")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      });
    });

    it("leaves the date empty for a Trip with no planning date", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook(
          [buildPricingRow({ planningDate: null, startTime: null, endTime: null })],
          "nl",
        ),
      );

      expect(sheet.getRow(2).getCell(1).value).toBeNull();
      expect(sheet.getRow(2).getCell(2).value).toBeNull();
    });
  });

  describe("the business values", () => {
    it("writes the operational columns as the Trip holds them", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([buildPricingRow()], "nl"),
      );
      const row = sheet.getRow(2);

      expect(row.getCell(4).value).toBe("45PH");
      expect(row.getCell(5).value).toBe("ANRDUB2602247");
      expect(row.getCell(6).value).toBe("MSKU1234567");
      expect(row.getCell(7).value).toBe("Quay 869");
      expect(row.getCell(8).value).toBe("Quay 869 -> Gent");
      expect(row.getCell(9).value).toBe("Gent");
    });

    it("writes money as a number with a EUR format", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([buildPricingRow()], "nl"),
      );
      const tarief = sheet.getRow(2).getCell(10);

      expect(tarief.value).toBe(250);
      expect(tarief.numFmt).toContain("€");
    });

    it("writes the fuel percentage as a number with a percent format", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([buildPricingRow()], "nl"),
      );
      const cell = sheet.getRow(2).getCell(11);

      expect(cell.value).toBe(15);
      expect(cell.numFmt).toContain("%");
    });

    it("puts each surcharge in its own column", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook(
          [
            buildPricingRow({
              backload: 75,
              toll: 9.75,
              tunnel: 6.2,
              others: 85,
              waitingTime: 25,
            }),
          ],
          "nl",
        ),
      );
      const row = sheet.getRow(2);

      expect(row.getCell(12).value).toBe(75);
      expect(row.getCell(13).value).toBe(9.75);
      expect(row.getCell(14).value).toBe(6.2);
      expect(row.getCell(15).value).toBe(85);
      expect(row.getCell(16).value).toBe(25);
    });

    /** Empty, never 0.00, and never the word "null". */
    it("leaves an unpriced Trip's pricing cells genuinely empty", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook(
          [
            buildPricingRow({
              basePrice: null,
              fuelPercentage: null,
              fuelAmount: null,
            }),
          ],
          "nl",
        ),
      );
      const row = sheet.getRow(2);

      for (const column of [10, 11, 12, 13, 14, 15, 16]) {
        expect(row.getCell(column).value).toBeNull();
      }
    });

    it("writes the remarks as the operator's own names", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook(
          [buildPricingRow({ remarks: "TAR, Flat" })],
          "nl",
        ),
      );

      expect(sheet.getRow(2).getCell(17).value).toBe("TAR, Flat");
    });
  });

  describe("what makes it usable", () => {
    it("freezes the header and turns on the filter", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([buildPricingRow()], "nl"),
      );

      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(sheet.autoFilter).toBeDefined();
    });

    it("makes the header bold", async () => {
      const sheet = await reopen(await buildPricingWorkbook([], "nl"));

      expect(sheet.getRow(1).font?.bold).toBe(true);
    });

    it("gives every column a readable width", async () => {
      const sheet = await reopen(await buildPricingWorkbook([], "nl"));

      for (let column = 1; column <= 17; column += 1) {
        expect(sheet.getColumn(column).width).toBeGreaterThan(6);
      }
    });

    it("writes one row per Trip", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook(
          [buildPricingRow(), buildPricingRow(), buildPricingRow()],
          "nl",
        ),
      );

      expect(sheet.rowCount).toBe(4);
    });
  });
});

describe("the basic workbook", () => {
  it("has the ten columns, in the agreed order", async () => {
    const sheet = await reopen(await buildBasicWorkbook([], "nl"));

    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "Afgewerkt",
      "Nummerplaat",
      "Begin",
      "Eind",
      "Boekingsnummer",
      "Type",
      "Container nummer",
      "Trip",
      "Kosten",
      "Info",
    ]);
  });

  it("marks a completed Trip with a ticked box", async () => {
    const sheet = await reopen(
      await buildBasicWorkbook([buildBasicRow({ isCompleted: true })], "nl"),
    );

    expect(sheet.getRow(2).getCell(1).value).toBe(COMPLETED_MARK);
  });

  it("marks anything else with an empty box", async () => {
    const sheet = await reopen(
      await buildBasicWorkbook([buildBasicRow({ isCompleted: false })], "nl"),
    );

    expect(sheet.getRow(2).getCell(1).value).toBe(NOT_COMPLETED_MARK);
  });

  it("writes the operational columns", async () => {
    const sheet = await reopen(
      await buildBasicWorkbook([buildBasicRow()], "nl"),
    );
    const row = sheet.getRow(2);

    expect(row.getCell(2).value).toBe("1-ABC-123");
    expect(row.getCell(5).value).toBe("ANRDUB2602247");
    expect(row.getCell(6).value).toBe("45PH");
    expect(row.getCell(7).value).toBe("MSKU1234567");
    expect(row.getCell(8).value).toBe("Quay 869 -> Gent");
  });

  it("shows the times as HH:mm", async () => {
    const sheet = await reopen(
      await buildBasicWorkbook([buildBasicRow()], "nl"),
    );

    expect(sheet.getRow(2).getCell(3).numFmt).toBe("hh:mm");
    expect(readTime(sheet.getRow(2).getCell(3))).toBe("07:00");
  });

  it("writes the costs and their explanation as text", async () => {
    const sheet = await reopen(
      await buildBasicWorkbook(
        [
          buildBasicRow({
            costs: "35.00 + 50.00 + 25.00",
            info: "TAR, Flat, Wachttijd 1 u 30 min",
          }),
        ],
        "nl",
      ),
    );

    expect(sheet.getRow(2).getCell(9).value).toBe("35.00 + 50.00 + 25.00");
    expect(sheet.getRow(2).getCell(10).value).toBe(
      "TAR, Flat, Wachttijd 1 u 30 min",
    );
  });

  it("leaves a blank plate and blank times empty", async () => {
    const sheet = await reopen(
      await buildBasicWorkbook(
        [buildBasicRow({ licensePlate: "", startTime: null, endTime: null })],
        "nl",
      ),
    );
    const row = sheet.getRow(2);

    expect(row.getCell(2).value ?? "").toBe("");
    expect(row.getCell(3).value).toBeNull();
  });
});

describe("the file names", () => {
  it("names a single day by its date", () => {
    expect(pricingFileName("2026-08-17", "2026-08-17")).toBe(
      "TRANO_Prijzen_2026-08-17.xlsx",
    );
    expect(basicFileName("2026-08-17", "2026-08-17")).toBe(
      "TRANO_Ritten_2026-08-17.xlsx",
    );
  });

  it("names a week or month by its range", () => {
    expect(pricingFileName("2026-08-10", "2026-08-16")).toBe(
      "TRANO_Prijzen_2026-08-10_2026-08-16.xlsx",
    );
    expect(basicFileName("2026-08-01", "2026-08-31")).toBe(
      "TRANO_Ritten_2026-08-01_2026-08-31.xlsx",
    );
  });

  /** Two exports of different periods must not overwrite one another. */
  it("gives the two exports distinct names", () => {
    expect(pricingFileName("2026-08-17", "2026-08-17")).not.toBe(
      basicFileName("2026-08-17", "2026-08-17"),
    );
  });
});
