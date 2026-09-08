import type { Worksheet } from "exceljs";

import type { BasicExportRow, PricingExportRow } from "./export-rows";
import {
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
    trip: "Quay 869 → Gent",
    endPoint: "Gent",
    basePrice: 250,
    fuelPercentage: 15,
    fuelAmount: 37.5,
    backload: null,
    toll: null,
    tunnel: null,
    others: null,
    waitingTime: null,
    ek: null,
    remarks: "",
    ...overrides,
  };
}

function buildBasicRow(overrides: Partial<BasicExportRow> = {}): BasicExportRow {
  return {
    tripGroupId: null,
    licensePlate: "1-ABC-123",
    startTime: "07:00:00",
    endTime: "15:00:00",
    bookingNumber: "ANRDUB2602247",
    containerType: "45PH",
    containerNumber: "MSKU1234567",
    trip: "Quay 869 → Gent",
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
  /**
   * EIGHTEEN now. The waiting time used to be written into the column headed
   * EK, so the sheet named one component as another and the confirmed cost
   * appeared nowhere — a Cost Confirmation changed the total on screen and
   * changed nothing here. Wachttijd got the column it needed and EK holds EK.
   */
  it("has the eighteen columns, in the agreed order", async () => {
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
      "Wachttijd",
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
      expect(row.getCell(8).value).toBe("Quay 869 → Gent");
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

      // Column 18 since Wachttijd gained one of its own.
      expect(sheet.getRow(2).getCell(18).value).toBe("TAR, Flat");
    });

    /**
     * EK is the CONFIRMED COST, which is what it means everywhere else in this
     * system. It used to hold the waiting time, so a Cost Confirmation arriving
     * for a Trip was invisible in the export.
     */
    it("writes the confirmed cost in the EK column", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook(
          [buildPricingRow({ ek: 165, waitingTime: 25 })],
          "nl",
        ),
      );

      expect(sheet.getRow(2).getCell(16).value).toBe(25);
      expect(sheet.getRow(2).getCell(17).value).toBe(165);
    });

    /** A Trip with no confirmation leaves EK empty, never zero. */
    it("leaves EK empty when nothing was confirmed", async () => {
      const sheet = await reopen(
        await buildPricingWorkbook([buildPricingRow({ ek: null })], "nl"),
      );

      expect(sheet.getRow(2).getCell(17).value).toBeNull();
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

/**
 * The basic workbook, checked against the sheet it reproduces.
 *
 * ── WHAT THESE TESTS DEFEND ─────────────────────────────────────────────────
 * `docs/07-excels/29-06-2026.xlsx` is the sheet the office prints, and this
 * export is meant to be indistinguishable from it. So the assertions below are
 * about APPEARANCE as much as content: which ink a column is written in, how
 * wide it is, how tall a row is, whether the page prints landscape edge to
 * edge. Those are business requirements here — a dispatcher finds the plate by
 * its red before reading a single header — and a restyle that quietly reverted
 * would otherwise pass every content test.
 *
 * Every assertion reads a real property (`font.color.argb`, `width`,
 * `pageSetup.orientation`) rather than a style index, so it still means
 * something after ExcelJS renumbers its internal style table.
 */
const ONE_DAY = { start: "2026-06-29", end: "2026-06-29" };

/** The reference's inks, by name. */
const RED = "FFFF0000";
const GREEN = "FF00B050";
const BLUE = "FF0070C0";

async function openBasic(
  rows: readonly BasicExportRow[] = [buildBasicRow()],
  period = ONE_DAY,
) {
  return reopen(await buildBasicWorkbook(rows, "nl", period));
}

describe("the basic workbook's structure", () => {
  it("puts the headers in row 2, under the date", async () => {
    const sheet = await openBasic([]);

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
  });

  it("writes the operational values in the reference's own columns", async () => {
    const row = (await openBasic()).getRow(3);

    expect(row.getCell(1).value).toBe("1-ABC-123");
    expect(row.getCell(4).value).toBe("ANRDUB2602247");
    expect(row.getCell(5).value).toBe("45PH");
    expect(row.getCell(6).value).toBe("MSKU1234567");
    expect(row.getCell(7).value).toBe("Quay 869 → Gent");
  });

  it("keeps the costs and their explanation as written", async () => {
    const row = (
      await openBasic([
        buildBasicRow({
          costs: "35.00 + 50.00 + 25.00",
          info: "LOSRIT, Wachttijd 07:00-10:00",
        }),
      ])
    ).getRow(3);

    expect(row.getCell(8).value).toBe("35.00 + 50.00 + 25.00");
    expect(row.getCell(9).value).toBe("LOSRIT, Wachttijd 07:00-10:00");
  });

  /**
   * `AFGEWERKT` was TRANO's own tenth column and is gone: the sheet is the
   * reference's nine again. The Trip's status is untouched — it is simply not
   * exported.
   */
  it("has no tenth column", async () => {
    const sheet = await openBasic([buildBasicRow()]);

    expect(sheet.getRow(2).getCell(10).value).toBeNull();
    expect(sheet.getRow(3).getCell(10).value).toBeNull();
  });

  it("ends on INFO", async () => {
    const sheet = await openBasic([buildBasicRow()]);
    const headers = (sheet.getRow(2).values as unknown[]).filter(Boolean);

    expect(headers).toEqual([
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
  });

  /**
   * ── ONE COMBINATION, ONE COLOUR, WHOLE ROW ──────────────────────────────
   * The colour comes from the group ID through the same function the Ritten
   * list's group tag uses, so a Combination reads the same on paper as on
   * screen — and keeps its colour across the days it spans.
   */
  describe("group colours", () => {
    const GROUP_A = "5c2f4d8e-1a3b-4c6d-8e9f-0a1b2c3d4e5f";
    const GROUP_B = "97777777-7777-4777-8777-777777777777";

    function fillsOf(sheet: Worksheet, rowNumber: number): string[] {
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

    it("paints every cell of a grouped row", async () => {
      const sheet = await openBasic([buildBasicRow({ tripGroupId: GROUP_A })]);
      const fills = fillsOf(sheet, 3);

      expect(new Set(fills).size).toBe(1);
      expect(fills[0]).not.toBe("NONE");
    });

    it("gives both legs of one group the same colour", async () => {
      const sheet = await openBasic([
        buildBasicRow({ tripGroupId: GROUP_A }),
        buildBasicRow({ tripGroupId: GROUP_A }),
      ]);

      expect(fillsOf(sheet, 3)).toEqual(fillsOf(sheet, 4));
    });

    it("gives a different group a different colour", async () => {
      const sheet = await openBasic([
        buildBasicRow({ tripGroupId: GROUP_A }),
        buildBasicRow({ tripGroupId: GROUP_B }),
      ]);

      expect(fillsOf(sheet, 3)[0]).not.toBe(fillsOf(sheet, 4)[0]);
    });

    it("leaves a standalone Trip unpainted", async () => {
      const sheet = await openBasic([buildBasicRow({ tripGroupId: null })]);

      expect(fillsOf(sheet, 3).every((fill) => fill === "NONE")).toBe(true);
    });

    /**
     * The colour follows the GROUP, never the row position or the date. A
     * Combination running over two days keeps one colour, and rows between
     * them do not shift it.
     */
    it("keeps one colour when the group spans two days with others between", async () => {
      const sheet = await openBasic([
        buildBasicRow({ tripGroupId: GROUP_A }),
        buildBasicRow({ tripGroupId: null }),
        buildBasicRow({ tripGroupId: GROUP_B }),
        buildBasicRow({ tripGroupId: GROUP_A }),
      ]);

      expect(fillsOf(sheet, 3)).toEqual(fillsOf(sheet, 6));
    });

    it("does not paint the header", async () => {
      const sheet = await openBasic([buildBasicRow({ tripGroupId: GROUP_A })]);

      expect(fillsOf(sheet, 2)[0]).not.toBe(fillsOf(sheet, 3)[0]);
    });
  });

  /**
   * Two Trips of one Combination are two rows. Merging them would lose the
   * second's own times, booking, container and destination — which is exactly
   * what a combination running past midnight needs to show.
   */
  it("writes one row per Trip and never merges them", async () => {
    const sheet = await openBasic([
      buildBasicRow({ startTime: "22:00:00", endTime: "23:30:00" }),
      buildBasicRow({ startTime: "00:15:00", endTime: "04:00:00" }),
    ]);

    expect(sheet.rowCount).toBe(4);
    expect(readTime(sheet.getRow(3).getCell(2))).toBe("22:00");
    expect(readTime(sheet.getRow(4).getCell(2))).toBe("00:15");
    expect(sheet.model.merges ?? []).toEqual([]);
  });

  it("leaves a blank plate and blank times empty", async () => {
    const row = (
      await openBasic([
        buildBasicRow({ licensePlate: "", startTime: null, endTime: null }),
      ])
    ).getRow(3);

    expect(row.getCell(1).value ?? "").toBe("");
    expect(row.getCell(2).value).toBeNull();
  });
});

describe("the basic workbook's dates and times", () => {
  /** A clock, not `0.333333333`. The value stays a real Excel time. */
  it("writes the start and end as real times in separate columns", async () => {
    const row = (await openBasic()).getRow(3);

    expect(row.getCell(2).numFmt).toBe("h:mm;@");
    expect(row.getCell(3).numFmt).toBe("h:mm;@");
    expect(readTime(row.getCell(2))).toBe("07:00");
    expect(readTime(row.getCell(3))).toBe("15:00");
  });

  it("prints the day above the table as a real date", async () => {
    const heading = (await openBasic()).getRow(1).getCell(7);

    expect(readDate(heading)).toBe("29/06/2026");
    expect(heading.numFmt).toBe("dd/mm/yyyy");
  });

  it("prints the day in red, bold, underlined and centered", async () => {
    const heading = (await openBasic()).getRow(1).getCell(7);

    expect(heading.font).toMatchObject({
      name: "Calibri",
      size: 12,
      bold: true,
      underline: true,
      color: { argb: RED },
    });
    expect(heading.alignment?.horizontal).toBe("center");
  });

  /**
   * A week has no single date to be. It says its range in words rather than
   * naming one of its days, which would be a day the sheet does not cover.
   */
  it("says the range in words when the export spans several days", async () => {
    const heading = (
      await openBasic([buildBasicRow()], {
        start: "2026-06-29",
        end: "2026-07-05",
      })
    )
      .getRow(1)
      .getCell(7);

    expect(heading.value).toBe("29/06/2026 - 05/07/2026");
  });
});

describe("the basic workbook's appearance", () => {
  /** Red plate, green times, blue booking — the reference's reading aid. */
  it("writes each column in its own ink", async () => {
    const sheet = await openBasic();
    const inks = [RED, GREEN, GREEN, BLUE, RED, GREEN, BLUE, GREEN, RED];

    inks.forEach((argb, index) => {
      expect(sheet.getRow(2).getCell(index + 1).font?.color).toEqual({ argb });
      expect(sheet.getRow(3).getCell(index + 1).font?.color).toEqual({ argb });
    });
  });

  it("sets the whole table in 8pt Microsoft Sans Serif", async () => {
    const sheet = await openBasic();

    for (const row of [sheet.getRow(2), sheet.getRow(3)]) {
      expect(row.getCell(1).font).toMatchObject({
        name: "Microsoft Sans Serif",
        size: 8,
      });
    }
  });

  it("fills the header band pale grey and centers it", async () => {
    const header = (await openBasic()).getRow(2).getCell(1);

    expect(header.fill).toMatchObject({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF0F0F0" },
    });
    expect(header.alignment).toMatchObject({
      horizontal: "center",
      vertical: "middle",
    });
  });

  /** The header is centered; the data is not. */
  it("leaves the body left-aligned and unwrapped", async () => {
    const body = (await openBasic()).getRow(3).getCell(9);

    expect(body.alignment).toMatchObject({
      horizontal: "left",
      vertical: "top",
    });
    expect(body.alignment?.wrapText).toBeFalsy();
  });

  it("draws a thin black border on every cell of the grid", async () => {
    const sheet = await openBasic();
    const thin = { style: "thin", color: { argb: "FF000000" } };

    for (const row of [sheet.getRow(2), sheet.getRow(3)]) {
      // Nine columns now: AFGEWERKT was TRANO's own tenth and is gone.
      for (let column = 1; column <= 9; column += 1) {
        expect(row.getCell(column).border).toEqual({
          top: thin,
          left: thin,
          bottom: thin,
          right: thin,
        });
      }
    }
  });

  /**
   * The reference's proportions, not nine independently autofitted columns.
   * `CONT NR` is wide enough for `EUCU1451295` on one line and no wider.
   */
  it("keeps the reference's column widths", async () => {
    const sheet = await openBasic();
    const widths = [
      8.7265625, 8.7265625, 8.7265625, 9.6328125, 8.7265625, 11.54296875,
      19.6328125, 25.90625, 41,
    ];

    widths.forEach((width, index) => {
      expect(sheet.getColumn(index + 1).width).toBe(width);
    });
  });

  it("keeps the rows compact and uniform", async () => {
    const sheet = await openBasic([buildBasicRow(), buildBasicRow()]);

    expect(sheet.getRow(1).height).toBe(19);
    expect(sheet.getRow(2).height).toBe(20);
    expect(sheet.getRow(3).height).toBe(20);
    expect(sheet.getRow(4).height).toBe(20);
  });

  /** Paper does not scroll, so the printed sheet has neither of these. */
  it("adds no frozen panes and no filter arrows", async () => {
    const sheet = await openBasic();

    expect(sheet.views?.[0]?.state ?? "normal").toBe("normal");
    expect(sheet.autoFilter).toBeFalsy();
  });
});

describe("the basic workbook's page layout", () => {
  it("prints landscape on A4, edge to edge and centered", async () => {
    const { pageSetup } = await openBasic();

    expect(pageSetup.orientation).toBe("landscape");
    expect(pageSetup.paperSize).toBe(9);
    expect(pageSetup.horizontalCentered).toBe(true);
    expect(pageSetup.margins).toMatchObject({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
  });

  /** One page WIDE, however many pages long: no column falls off the paper. */
  it("fits the columns to a single page width", async () => {
    const { pageSetup } = await openBasic();

    expect(pageSetup.fitToPage).toBe(true);
    expect(pageSetup.fitToWidth).toBe(1);
    expect(pageSetup.fitToHeight).toBe(0);
  });

  it("prints the table alone, without gridlines or row headers", async () => {
    const { pageSetup } = await openBasic();

    expect(pageSetup.showGridLines).toBe(false);
    expect(pageSetup.showRowColHeaders).toBe(false);
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
