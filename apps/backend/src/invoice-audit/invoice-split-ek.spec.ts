import { Prisma } from "@prisma/client";

import { aTrip, day, invoiceWorld, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * Week 41 R53-R54: one transport over two EC lines — EC 4220981 (EK 110) and
 * EC 4220982 (EK 70), 180 together. Its prices belong on R53. When Trano's EK
 * is higher, the raise cannot be given to either row: that holds back the EK
 * ALONE (owner, October 2026). Tarief and Fuel are still written; the EK is
 * left as the customer wrote it, said, and the transport is not settled.
 */

const TUESDAY = "2026-10-06";
const COLUMN = { tarief: 12, fuel: 13, ek: 20, remarks: 21 } as const;

const ecLine = (ccNumber: string, ek: number): InvoiceFixtureLine => ({
  planningDate: day(TUESDAY),
  bookingNumber: "ANRDUB2812770",
  containerNumber: "",
  tarief: null,
  ek,
  remarks: `EC ${ccNumber}`,
  containerType: null,
  startPoint: null,
  endPoint: null,
});

const OTHER: InvoiceFixtureLine = {
  planningDate: day(TUESDAY),
  bookingNumber: "ANRDUB2810001",
  containerNumber: "EUCU 1000001",
  tarief: 200,
  fuel: 30,
};

const LINES = [OTHER, ecLine("4220981", 110), ecLine("4220982", 70)];
const isRed = (cell: { font?: { color?: { argb?: string } } }) => cell.font?.color?.argb === CORRECTED_TEXT_ARGB;

describe("an EK difference no EC line can carry holds back the EK alone", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
    world.trips.push(aTrip("other", "ANRDUB2810001", "EUCU1000001", TUESDAY));
    world.trips.push(aTrip("bousbecque", "ANRDUB2812770", "PVDU1106430", TUESDAY));
    world.confirmations.push(
      { tripId: "bousbecque", ccNumber: "4220981", amount: new Prisma.Decimal(110) },
      { tripId: "bousbecque", ccNumber: "4220982", amount: new Prisma.Decimal(70) },
    );
  });

  const paymentOf = (result: Awaited<ReturnType<InvoiceWorld["check"]>>["result"]) =>
    result.payments.filter((payment) => payment.tripId === "bousbecque");

  /** The grown totals per column: what the written lines add, nothing twice. */
  const grew = (result: Awaited<ReturnType<InvoiceWorld["check"]>>["result"], column: string) => {
    const total = result.totals.columns.find((each) => each.column.startsWith(column))!;

    return new Prisma.Decimal(total.after).minus(total.before).toFixed(2);
  };

  describe("1. Trano's EK higher than the 180 on the EC lines", () => {
    beforeEach(() => world.ekOf.set("bousbecque", "220"));

    it("writes Tarief and Fuel on R53, leaves the EK as written, and says why", async () => {
      const { result, cell } = await world.check(LINES);
      const r53 = result.rows[1];

      expect(r53).toMatchObject({ status: "MATCHED", trip: { id: "bousbecque" }, pricingStatus: "NOT_DISTRIBUTABLE" });
      expect(r53.comparisons.map((comparison) => [comparison.component, comparison.outcome, comparison.writtenValue])).toEqual([
        ["Tarief", "RAISE", "200.00"],
        ["Fuel", "RAISE", "30.00"],
        ["EK", "NOT_PLACEABLE", null],
      ]);
      // The preview's figures are the file's.
      expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.fuel).value]).toEqual([200, 30]);
      expect([isRed(cell(3, COLUMN.tarief)), isRed(cell(3, COLUMN.fuel))]).toEqual([true, true]);
      // 5. Both EC lines and their EK kept as the customer wrote them.
      expect([cell(3, COLUMN.ek).value, cell(4, COLUMN.ek).value]).toEqual([110, 70]);
      expect([isRed(cell(3, COLUMN.ek)), isRed(cell(4, COLUMN.ek))]).toEqual([false, false]);
      expect([cell(3, COLUMN.remarks).value, cell(4, COLUMN.remarks).value]).toEqual(["EC 4220981", "EC 4220982"]);
      // Marked for a person to settle the EK.
      expect(result.markedRowNumbers).toEqual(expect.arrayContaining([3, 4]));
    });

    it("4. adds the Tarief and the Fuel to the totals once, and no EK", async () => {
      const { result } = await world.check(LINES);

      expect([grew(result, "Tarief"), grew(result, "Fuel"), grew(result, "EK")]).toEqual(["200.00", "30.00", "0.00"]);
      expect(result.missingTrips).toEqual([]);
    });

    it("8. settles nothing while the EK is open", async () => {
      const { result } = await world.check(LINES);

      expect(paymentOf(result)).toEqual([
        expect.objectContaining({ payable: false, reasons: expect.arrayContaining(["PRICE_NOT_SETTLED"]) }),
      ]);
    });

    it("6. changes nothing more when the corrected file is checked again", async () => {
      const first = await world.check(LINES);

      const again = await world.checkFile(first.written);
      const r53 = again.result.rows[1];

      expect(r53.comparisons.map((comparison) => [comparison.component, comparison.outcome])).toEqual([
        ["Tarief", "UNCHANGED"],
        ["Fuel", "UNCHANGED"],
        ["EK", "NOT_PLACEABLE"],
      ]);
      expect([again.cell(3, COLUMN.tarief).value, again.cell(3, COLUMN.ek).value, again.cell(4, COLUMN.ek).value]).toEqual([
        200, 110, 70,
      ]);
      expect([grew(again.result, "Tarief"), grew(again.result, "EK")]).toEqual(["0.00", "0.00"]);
    });
  });

  it("2. Trano's EK equal to the 180: compared, unchanged, the transport priced and settled", async () => {
    world.ekOf.set("bousbecque", "180");

    const { result, cell } = await world.check(LINES);

    expect(result.rows[1]).toMatchObject({ pricingStatus: "PRICING_CORRECTED" });
    expect(result.rows[1].comparisons.find((comparison) => comparison.component === "EK")).toMatchObject({ outcome: "UNCHANGED" });
    expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.ek).value, cell(4, COLUMN.ek).value]).toEqual([200, 110, 70]);
    expect(paymentOf(result)).toEqual([expect.objectContaining({ payable: true, rowNumbers: [3, 4] })]);
  });

  it("3. Trano's EK lower than the 180: never lowered, the transport priced", async () => {
    world.ekOf.set("bousbecque", "150");

    const { result, cell } = await world.check(LINES);

    expect(result.rows[1]).toMatchObject({ pricingStatus: "PRICING_CORRECTED" });
    expect(result.rows[1].comparisons.find((comparison) => comparison.component === "EK")).toMatchObject({ outcome: "INVOICE_HIGHER" });
    expect([cell(3, COLUMN.tarief).value, cell(3, COLUMN.ek).value, cell(4, COLUMN.ek).value]).toEqual([200, 110, 70]);
    // Payable: the Tarief and Fuel were raised; the higher EK is only pointed out.
    expect(paymentOf(result)).toEqual([expect.objectContaining({ payable: true, category: "RAISED" })]);
  });

  it("7. still invents nothing for a price that cannot be relied on", async () => {
    world.ekOf.set("bousbecque", "220");
    world.unreliable.add("bousbecque");

    const { result, cell } = await world.check(LINES);

    expect(result.rows[1].pricingStatus).toBe("PRICE_UNRELIABLE");
    expect(cell(3, COLUMN.tarief).value).toBeNull();
  });
});
