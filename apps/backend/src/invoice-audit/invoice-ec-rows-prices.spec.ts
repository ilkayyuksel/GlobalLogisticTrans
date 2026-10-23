import { Prisma } from "@prisma/client";

import { aTrip, day, invoiceWorld, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * Week 41 R53–R54: two EC lines of one transport — ANRDUB2812770, 6 October,
 * EC 4220981 (EK 110) and EC 4220982 (EK 70). Trano holds the transport
 * (Tarief 200, Fuel 30) with both confirmations, so its EK is 180.
 *
 * The transport's prices reach the corrected invoice exactly once, and the EC
 * lines keep their own numbers and amounts:
 *   * lines stating the container ARE the transport's line, over both rows
 *     (`ec-transport-lines.ts`): the prices on the first, the EK on each;
 *   * lines stating none are EC charges, and the transport is added as its own
 *     line (`missing/`), carrying only the EK they do not already charge.
 */

const TUESDAY = "2026-10-06";
const BOOKING = "ANRDUB2812770";
const CONTAINER = "PVDU1106430";
const COLUMN = { container: 6, tarief: 12, fuel: 13, ek: 20, remarks: 21 } as const;

function ecLine(ccNumber: string, ek: number, container: string): InvoiceFixtureLine {
  return {
    planningDate: day(TUESDAY),
    bookingNumber: BOOKING,
    containerNumber: container === "" ? "" : `${container.slice(0, 4)} ${container.slice(4)}`,
    tarief: null,
    ek,
    remarks: `EC ${ccNumber}`,
    containerType: null,
    startPoint: null,
    endPoint: null,
  };
}

/** Another transport of the week, so the invoice has a period. */
const OTHER: InvoiceFixtureLine = {
  planningDate: day(TUESDAY),
  bookingNumber: "ANRDUB2810001",
  containerNumber: "EUCU 1000001",
  tarief: 200,
  fuel: 30,
};

const isRed = (cell: { font?: { color?: { argb?: string } } }) => cell.font?.color?.argb === CORRECTED_TEXT_ARGB;

describe("EC lines never keep a transport's prices off the invoice", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
    world.trips.push(aTrip("other", "ANRDUB2810001", "EUCU1000001", TUESDAY));
    world.trips.push(aTrip("bousbecque", BOOKING, CONTAINER, TUESDAY));
    world.confirmations.push(
      { tripId: "bousbecque", ccNumber: "4220981", amount: new Prisma.Decimal(110) },
      { tripId: "bousbecque", ccNumber: "4220982", amount: new Prisma.Decimal(70) },
    );
    world.ekOf.set("bousbecque", "180");
  });

  const paymentsOf = (result: Awaited<ReturnType<InvoiceWorld["check"]>>["result"]) =>
    result.payments.filter((payment) => payment.tripId === "bousbecque");

  it("1. one EC line stating the whole transport: its prices filled from Trano, its EK and EC number kept", async () => {
    world.confirmations.splice(1, 1);
    world.ekOf.set("bousbecque", "110");

    const { result, cell } = await world.check([OTHER, ecLine("4220981", 110, CONTAINER)]);

    expect(result.rows[1]).toMatchObject({ status: "MATCHED", trip: { id: "bousbecque" }, transportPricesFilled: true });
    expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.fuel).value, cell(3, COLUMN.ek).value]).toEqual([200, 30, 110]);
    expect(isRed(cell(3, COLUMN.tarief))).toBe(true);
    expect(isRed(cell(3, COLUMN.ek))).toBe(false);
    expect(cell(3, COLUMN.remarks).value).toBe("EC 4220981");
  });

  describe("2, 4, 5. two EC lines of the transport stating its container, no other line of it", () => {
    async function checked() {
      return world.check([OTHER, ecLine("4220981", 110, CONTAINER), ecLine("4220982", 70, CONTAINER)]);
    }

    it("do not block each other: one transport over both rows, its prices once, on the first", async () => {
      const { result, cell } = await checked();

      expect(result.rows.slice(1).map((row) => [row.status, row.trip?.id, row.sharedKeyRowNumbers])).toEqual([
        ["MATCHED", "bousbecque", [4]],
        ["MATCHED", "bousbecque", [3]],
      ]);
      expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.fuel).value]).toEqual([200, 30]);
      expect([cell(4, COLUMN.tarief).value, cell(4, COLUMN.fuel).value]).toEqual([null, null]);
      expect(result.missingTrips).toEqual([]);
      expect(paymentsOf(result)).toEqual([expect.objectContaining({ payable: true, rowNumbers: [3, 4] })]);
    });

    it("keep EK 110 and EK 70 and their EC numbers: together they are the transport's EK, not raised or lowered", async () => {
      const { result, cell } = await checked();

      expect([cell(3, COLUMN.ek).value, cell(4, COLUMN.ek).value]).toEqual([110, 70]);
      expect([cell(3, COLUMN.remarks).value, cell(4, COLUMN.remarks).value]).toEqual(["EC 4220981", "EC 4220982"]);
      // Compared over both rows: 110 + 70 against Trano's 180 — no change.
      expect(result.rows[1].comparisons.find((comparison) => comparison.component === "EK")).toMatchObject({
        outcome: "UNCHANGED",
        excelValue: "180.00",
        tranoValue: "180.00",
      });
    });

    it("6. show each empty transport price as €0.00 against Trano", async () => {
      const { result } = await checked();

      expect(result.rows[1].comparisons).toEqual([
        { component: "Tarief", outcome: "RAISE", excelValue: "0.00", excelCellEmpty: true, tranoValue: "200.00", writtenValue: "200.00" },
        { component: "Fuel", outcome: "RAISE", excelValue: "0.00", excelCellEmpty: true, tranoValue: "30.00", writtenValue: "30.00" },
        { component: "EK", outcome: "UNCHANGED", excelValue: "180.00", excelCellEmpty: false, tranoValue: "180.00", writtenValue: null },
      ]);
    });

    it("10. add nothing more when the corrected file is checked again", async () => {
      const first = await checked();
      const again = await world.checkFile(first.written);

      expect(again.result.missingTrips).toEqual([]);
      expect(again.result.rows.slice(1).map((row) => [row.pricingStatus, row.remarks])).toEqual([
        ["MATCHED_NO_CHANGES", null],
        ["MATCHED_NO_CHANGES", null],
      ]);
      expect([again.cell(3, COLUMN.tarief).value, again.cell(3, COLUMN.ek).value, again.cell(4, COLUMN.ek).value]).toEqual([
        200, 110, 70,
      ]);
    });
  });

  it("3. two EC lines beside the transport's own line: no second set of prices, no added line", async () => {
    const transportLine: InvoiceFixtureLine = { ...ecLine("", 0, CONTAINER), tarief: 200, fuel: 30, ek: null, remarks: "", containerType: "45PH", startPoint: undefined, endPoint: undefined };

    const { result, cell } = await world.check([OTHER, transportLine, ecLine("4220981", 110, CONTAINER), ecLine("4220982", 70, CONTAINER)]);

    expect(result.rows.slice(1).map((row) => row.trip?.id)).toEqual(["bousbecque", "bousbecque", "bousbecque"]);
    expect(result.rows.slice(1).map((row) => row.pricingStatus)).toEqual(["MATCHED_NO_CHANGES", "MATCHED_NO_CHANGES", "MATCHED_NO_CHANGES"]);
    expect([cell(4, COLUMN.tarief).value, cell(5, COLUMN.tarief).value]).toEqual([null, null]);
    expect(result.missingTrips).toEqual([]);
    expect(paymentsOf(result)).toHaveLength(1);
  });

  it("4. two EC lines stating no container: kept as EC lines, the transport added once with its prices and the EK they do not charge", async () => {
    const { result, cell } = await world.check([OTHER, ecLine("4220981", 110, ""), ecLine("4220982", 70, "")]);

    expect(result.rows.slice(1).map((row) => [row.status, row.trip?.id, row.transportTrip?.id])).toEqual([
      ["COST_LINE", "bousbecque", "bousbecque"],
      ["COST_LINE", "bousbecque", "bousbecque"],
    ]);
    expect(result.missingTrips.map((missing) => missing.tripId)).toEqual(["bousbecque"]);
    // The added line (row 5): the transport's prices; its EK is on the EC lines already.
    expect([cell(5, 5).value, cell(5, COLUMN.tarief).value, cell(5, COLUMN.fuel).value, cell(5, COLUMN.ek).value]).toEqual([
      BOOKING,
      200,
      30,
      null,
    ]);
    expect([cell(3, COLUMN.ek).value, cell(4, COLUMN.ek).value, cell(3, COLUMN.tarief).value]).toEqual([110, 70, null]);
    expect(paymentsOf(result)).toEqual([expect.objectContaining({ payable: true, rowNumbers: [3, 4, 5] })]);
  });

  it("7. keeps a really ambiguous transport ambiguous: nothing priced, the EC number choosing nothing", async () => {
    world.trips.push(aTrip("twin", BOOKING, "PVDU1106431", TUESDAY));

    const { result, cell } = await world.check([OTHER, ecLine("4220981", 110, "PVDU9999999"), ecLine("4220982", 70, "PVDU9999999")]);

    expect(result.rows.slice(1).map((row) => row.status)).toEqual(["AMBIGUOUS", "AMBIGUOUS"]);
    expect([cell(3, COLUMN.tarief).value, cell(4, COLUMN.tarief).value]).toEqual([null, null]);
    expect(result.missingTrips).toEqual([]);
  });

  it("8. invents no price when the stored one cannot be relied on", async () => {
    world.unreliable.add("bousbecque");

    const { result, cell } = await world.check([OTHER, ecLine("4220981", 110, CONTAINER), ecLine("4220982", 70, CONTAINER)]);

    expect(result.rows.slice(1).map((row) => [row.status, row.pricingStatus])).toEqual([
      ["MATCHED", "PRICE_UNRELIABLE"],
      ["MATCHED", "PRICE_UNRELIABLE"],
    ]);
    expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.ek).value]).toEqual([null, 110]);
    expect(paymentsOf(result)).toEqual([expect.objectContaining({ payable: false })]);
  });

  it("9. writes the prices and keeps the EC information, the Remarks and the customer's formats", async () => {
    const { cell, receivedUnchanged } = await world.check([
      OTHER,
      { ...ecLine("4220981", 110, CONTAINER), remarks: "tar 869,EC 4220981" },
      ecLine("4220982", 70, CONTAINER),
    ]);

    expect(cell(3, COLUMN.tarief).value).toBe(200);
    expect(cell(3, COLUMN.tarief).numFmt).toContain("€");
    expect(cell(3, COLUMN.remarks).value).toBe("tar 869,EC 4220981");
    expect(cell(4, COLUMN.remarks).value).toBe("EC 4220982");
    expect(receivedUnchanged).toBe(true);
  });
});
