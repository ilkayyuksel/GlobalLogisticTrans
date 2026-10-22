import { Prisma, TripStatus } from "@prisma/client";
import ExcelJS from "exceljs";

import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import { WAITING_NOT_WRITTEN_NOTE } from "../remarks/customer-remark-vocabulary";
import { sheetRow, tripRecord } from "../__fixtures__/invoice-rows";
import { writeDatesInRed } from "../workbook/cell-marking";
import { toPlanningDate } from "../workbook/invoice-sheet";
import { adviseRow } from "./row-advice";

/** A line's outcome, as the matching hands it over. */
function outcome(overrides: Partial<InvoiceRowMatch> = {}): InvoiceRowMatch {
  return {
    row: sheetRow(),
    status: InvoiceRowStatus.MATCHED,
    trip: tripRecord(),
    candidates: [tripRecord()],
    sharedKeyRowNumbers: [],
    containerCorrection: null,
    bookingCorrection: null,
    dateCorrection: null,
    costConfirmation: null,
    combination: null,
    problem: null,
    ...overrides,
  };
}

/** Example C: `EC 4214683` on a line of AMRDIB2812203, a booking no transport line states. */
function unresolvedCostLine(bookingNumber: string): InvoiceRowMatch {
  return outcome({
    row: sheetRow({
      rowNumber: 40,
      bookingNumber,
      containerNumber: "",
      normalizedContainerNumber: "",
      costLine: { ccNumbers: ["4214683"] },
      amounts: { ek: { value: new Prisma.Decimal(25), unreadable: false } } as never,
    }),
    status: InvoiceRowStatus.COST_LINE_UNRESOLVED,
    trip: null,
    candidates: [],
    problem: "Geen kostenbevestiging gevonden voor EC 4214683.",
  });
}

describe("the advice on one line", () => {
  it("says nothing about a line matched exactly", () => {
    expect(adviseRow(outcome(), [outcome()])).toEqual([]);
  });

  describe("an EC line whose confirmation is not found", () => {
    const transport = outcome({
      row: sheetRow({ rowNumber: 39, bookingNumber: "ANRDUB2812203" }),
      trip: tripRecord({ bookingNumber: "ANRDUB2812203" }),
    });

    it("says the transport WAS matched, and where, when it was", () => {
      const costLine = unresolvedCostLine("ANRDUB2812203");

      expect(adviseRow(costLine, [transport, costLine])).toEqual([
        {
          severity: "ERROR",
          problem: "EC-kostenbevestiging niet gekoppeld",
          explanation:
            "De ritmatch is wel succesvol: de rit zelf staat op Excel-rij 39 en is daar gewoon gecontroleerd. Geen kostenbevestiging gevonden voor EC 4214683. Alleen het EK-bedrag van deze regel is niet gecontroleerd.",
          action:
            "Controleer het EC-nummer (4214683) en het boekingsnummer van deze regel, en of de bijbehorende kostenbevestiging in Trano bestaat.",
        },
      ]);
    });

    it("says it was NOT matched when no transport line of that booking was", () => {
      const costLine = unresolvedCostLine("AMRDIB2812203");

      const [advice] = adviseRow(costLine, [transport, costLine]);

      expect(advice.explanation).toContain(
        "De ritmatch is niet succesvol: op deze factuur is geen gematchte transportregel met boekingsnummer AMRDIB2812203 gevonden.",
      );
      // Never that the transport itself was left unprocessed.
      expect(advice.explanation).not.toMatch(/niet verwerkt/);
    });
  });

  it("explains a waiting time that could not be written, apart from any other advice", () => {
    const advice = adviseRow(
      outcome({ bookingCorrection: { invoiceBookingNumber: "A", tripBookingNumber: "B" } }),
      [],
      { rowNumber: 5, before: "", after: "", added: [], notes: [WAITING_NOT_WRITTEN_NOTE] },
    );

    expect(advice.map((each) => each.problem)).toEqual(["Boekingsnummer komt niet overeen", "Wachttijd niet verwerkt"]);
    expect(advice[1]).toMatchObject({
      severity: "WARNING",
      explanation: expect.stringContaining("geen geldig tijdvenster binnen één dag"),
      action: "Controleer de begin- en eindtijd van de wachttijd in Trano. Corrigeer ze alleen wanneer de brongegevens fout zijn.",
    });
  });

  it("names the unfinished Trip a line found", () => {
    const open = tripRecord({ status: TripStatus.OPEN, bookingNumber: "ANRDUB2813025" });

    const [advice] = adviseRow(outcome({ status: InvoiceRowStatus.NOT_FINISHED, trip: null, candidates: [open] }), []);

    expect(advice).toMatchObject({
      severity: "WARNING",
      problem: "Rit nog niet afgewerkt",
      explanation: expect.stringContaining("ANRDUB2813025 · EUCU4541197 · 05/10/2026 · open"),
    });
  });
});

describe("a corrected date, written in the form the cell already holds", () => {
  async function written(value: ExcelJS.CellValue, numFmt: string) {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Sheet1");

    sheet.getCell("A2").value = value;
    sheet.getCell("A2").numFmt = numFmt;
    writeDatesInRed(sheet, 1, new Map([[2, "2026-10-07"]]));

    const back = new ExcelJS.Workbook();

    await back.xlsx.load((await book.xlsx.writeBuffer()) as ArrayBuffer);

    return back.worksheets[0].getCell("A2");
  }

  it.each([
    // A serial under a date format is read back by ExcelJS as a date, so the
    // bare serial is written under a number format.
    ["a date", new Date("2026-10-06T00:00:00.000Z"), "dd/mm/yyyy", "object"],
    ["an Excel serial", 46301, "0", "number"],
    ["text", "2026-10-06", "@", "string"],
  ])("keeps %s as that kind of value, reading back as the Trip's day, in red", async (_kind, value, numFmt, type) => {
    const cell = await written(value, numFmt);

    expect(typeof cell.value).toBe(type);
    expect(toPlanningDate(cell.value)).toBe("2026-10-07");
    expect(cell.numFmt).toBe(numFmt);
    expect(cell.font?.color?.argb).toBe("FFFF0000");
  });
});
