import { Prisma } from "@prisma/client";

import { EffectiveComponent, PricingAmountSource, type EffectiveAmount } from "../trip-pricing/effective-pricing";
import { reliablyPriced } from "./__fixtures__/invoice-pricing";
import { tripTotalOf } from "./pricing/invoice-reconciliation";
import { aTrip, day, invoiceWorld, type CheckedInvoice, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";
import { isYellowFill } from "./workbook/cell-comparison";
import { CORRECTED_TEXT_ARGB } from "./workbook/cell-marking";

/**
 * A normal Trip whose line states no Tarief and no Fuel (owner, November 2026):
 * neither is filled in, the row is marked yellow, and the Excel's EK — read as
 * the transport's total — is compared with Trano's stored total and only ever
 * raised to it. Through the whole check, read back from the corrected file.
 *
 *   Trano total = Tarief + Fuel + Toll + Tunnel + Backload + Others + EK
 *   new EK      = max(Trano total, Excel EK)
 *
 * "Normal": a Combination neither in Trano (no group) nor in the Excel (no
 * marking). Every other line keeps the rules it had.
 */

const TUESDAY = "2026-10-06";
const COLUMN = {
  tarief: 12,
  fuel: 13,
  backload: 14,
  tolB: 16,
  tunnel: 18,
  others: 19,
  ek: 20,
  remarks: 21,
} as const;
const LAST_COLUMN = 21;

/**
 * The owner's example: 800 + 104 + 45 + 20 + 50 + 30 + 40 = 1 089,00. A Trip in
 * no group cannot reliably carry a Backload (`price-reliability.ts`), so the
 * end-to-end tests hold its €50 in Others; `tripTotalOf` is shown adding a
 * Backload directly.
 */
const OWNER_EXAMPLE = { tarief: "800", brandstof: "104", tol: "45", tunnel: "20", backload: "50", others: "30", ek: "40" };
const EXAMPLE = { ...OWNER_EXAMPLE, backload: "0", others: "80" };

function line(booking: string, amounts: Partial<InvoiceFixtureLine> = {}): InvoiceFixtureLine {
  return {
    planningDate: day(TUESDAY),
    bookingNumber: booking,
    containerNumber: "EUCU 1000001",
    tarief: null,
    fuel: null,
    ...amounts,
  };
}

/** A Cost Confirmation line as the customer writes one: an EK and `EC <nr>`, no container. */
function costLine(booking: string, ek: number, ccNumber: string): InvoiceFixtureLine {
  return { ...line(booking), containerNumber: "", ek, remarks: `EC ${ccNumber}`, containerType: null, startPoint: null, endPoint: null };
}

function excelCombination(first: InvoiceFixtureLine, second: InvoiceFixtureLine): InvoiceFixtureLine[] {
  return [
    { ...first, endPoint: "COMBINATION" },
    { ...second, startPoint: "COMBINATION" },
  ];
}

function component(componentCode: string, amount: string): EffectiveAmount {
  const value = new Prisma.Decimal(amount);

  return {
    componentCode,
    engineAmount: value,
    effectiveAmount: value,
    correctableAmount: value,
    source: PricingAmountSource.ENGINE,
  } as EffectiveAmount;
}

const isRed = (cell: { font?: { color?: { argb?: string } } }) => cell.font?.color?.argb === CORRECTED_TEXT_ARGB;

function expectWholeRowYellow(checked: CheckedInvoice, rowNumber: number): void {
  for (let column = 1; column <= LAST_COLUMN; column += 1) {
    expect(isYellowFill(checked.cell(rowNumber, column).style.fill)).toBe(true);
  }
}

const ekComparison = (checked: CheckedInvoice, index = 0) =>
  checked.result.rows[index].comparisons.find((comparison) => comparison.component === "EK");

/** What a Trip holds for its Remarks besides its Custom Properties. */
const TRANO_REMARK_FACTS = {
  internalNotes: "klant belt vooraf",
  waitingTimeStart: new Date("1970-01-01T08:00:00.000Z"),
  waitingTimeEnd: new Date("1970-01-01T09:30:00.000Z"),
  waitingTimeMinutes: 90,
} as const;

describe("a normal Trip without Tarief and Fuel: its EK compared with Trano's total", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
  });

  describe("when it applies", () => {
    beforeEach(() => world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY)));

    it("1. both empty: neither filled, the EK raised to Trano's total, the row yellow", async () => {
      const checked = await world.check([line("ANRDUB2810001")]);

      expect(checked.result.rows[0]).toMatchObject({
        status: "MATCHED",
        pricingStatus: "PRICING_CORRECTED",
        marks: ["PRICES_MISSING"],
        transportPricesFilled: false,
      });
      expect(checked.result.rows[0].comparisons).toEqual([
        expect.objectContaining({ component: "EK", outcome: "RAISE", tranoValue: "230.00", writtenValue: "230.00" }),
      ]);
      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(2, COLUMN.fuel).value, checked.cell(2, COLUMN.ek).value]).toEqual([
        null,
        null,
        230,
      ]);
      expect(isRed(checked.cell(2, COLUMN.ek))).toBe(true);
      expectWholeRowYellow(checked, 2);
    });

    it("2. both a dash: kept as written, the EK compared with the total", async () => {
      const checked = await world.check([line("ANRDUB2810001", { tarief: "-", fuel: "-", ek: 100 })]);

      expect(checked.result.rows[0]).toMatchObject({ pricingStatus: "PRICING_CORRECTED", marks: ["PRICES_MISSING"] });
      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(2, COLUMN.fuel).value, checked.cell(2, COLUMN.ek).value]).toEqual([
        "-",
        "-",
        230,
      ]);
      expectWholeRowYellow(checked, 2);
    });

    it("3. only the Tarief missing: the component checks as before, the EK not a total", async () => {
      const checked = await world.check([line("ANRDUB2810001", { fuel: 30 })]);

      expect(checked.result.rows[0].marks).toEqual([]);
      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(2, COLUMN.ek).value]).toEqual([200, null]);
      expect(ekComparison(checked)).toBeUndefined();
    });

    it("4. only the Fuel missing: the component checks as before, the EK not a total", async () => {
      const checked = await world.check([line("ANRDUB2810001", { tarief: 200 })]);

      expect(checked.result.rows[0].marks).toEqual([]);
      expect([checked.cell(2, COLUMN.fuel).value, checked.cell(2, COLUMN.ek).value]).toEqual([30, null]);
      expect(ekComparison(checked)).toBeUndefined();
    });

    it("5. a Tarief and Fuel of 0,00 are prices: raised as ever, the EK not a total", async () => {
      const checked = await world.check([line("ANRDUB2810001", { tarief: 0, fuel: 0 })]);

      expect(checked.result.rows[0].marks).toEqual([]);
      expect([checked.cell(2, COLUMN.tarief).value, checked.cell(2, COLUMN.fuel).value, checked.cell(2, COLUMN.ek).value]).toEqual([
        200,
        30,
        null,
      ]);
    });
  });

  describe("Trano's total against the Excel's EK", () => {
    beforeEach(() => {
      world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY));
      world.amountsOf.set("t1", EXAMPLE);
    });

    it("6. adds all seven stored components, each once, rounded", () => {
      const pricing = reliablyPriced({
        components: [],
        ...Object.fromEntries(Object.entries(OWNER_EXAMPLE).map(([key, value]) => [key, new Prisma.Decimal(value)])),
        totaal: new Prisma.Decimal("1089"),
      } as unknown as Parameters<typeof reliablyPriced>[0]);

      expect(tripTotalOf(pricing).toFixed(2)).toBe("1089.00");
    });

    it("6. a normal Trip's line: only the EK compared, no component filled apart", async () => {
      const checked = await world.check([line("ANRDUB2810001", { ek: 1000 })]);

      expect(checked.result.rows[0].differences.map((difference) => [difference.component, difference.kind])).toEqual([
        ["EK", "RAISE"],
      ]);
      expect(ekComparison(checked)).toMatchObject({ excelValue: "1000.00", tranoValue: "1089.00" });
      // No component is filled apart: each is inside the total already.
      expect(
        [COLUMN.tarief, COLUMN.fuel, COLUMN.backload, COLUMN.tolB, COLUMN.tunnel, COLUMN.others].map(
          (column) => checked.cell(2, column).value,
        ),
      ).toEqual([null, null, null, null, null, null]);
    });

    it("7. Trano higher (example A): 1 050,00 becomes 1 089,00, written as a correction", async () => {
      const checked = await world.check([line("ANRDUB2810001", { ek: 1050 })]);

      expect(checked.cell(2, COLUMN.ek).value).toBe(1089);
      expect(isRed(checked.cell(2, COLUMN.ek))).toBe(true);
      expect(ekComparison(checked)).toMatchObject({ outcome: "RAISE", writtenValue: "1089.00" });
    });

    it("8. the Excel higher (example B): 1 150,00 stays, never lowered", async () => {
      const checked = await world.check([line("ANRDUB2810001", { ek: 1150 })]);

      expect(checked.cell(2, COLUMN.ek).value).toBe(1150);
      expect(isRed(checked.cell(2, COLUMN.ek))).toBe(false);
      expect(checked.result.rows[0].pricingStatus).toBe("INVOICE_HIGHER");
      expect(ekComparison(checked)).toMatchObject({ outcome: "INVOICE_HIGHER", tranoValue: "1089.00" });
    });

    it("9. equal (example C): nothing written", async () => {
      const checked = await world.check([line("ANRDUB2810001", { ek: 1089 })]);

      expect(checked.cell(2, COLUMN.ek).value).toBe(1089);
      expect(isRed(checked.cell(2, COLUMN.ek))).toBe(false);
      expect(checked.result.rows[0]).toMatchObject({ pricingStatus: "MATCHED_NO_CHANGES", differences: [] });
      expectWholeRowYellow(checked, 2);
    });

    it("11. each component rounded as the check rounds it, then added", async () => {
      world.amountsOf.set("t1", { ...EXAMPLE, tarief: "800.004", brandstof: "104.005" });

      const checked = await world.check([line("ANRDUB2810001", { ek: 1089 })]);

      // 800.00 + 104.01 + 45 + 20 + 50 + 30 + 40
      expect(ekComparison(checked)).toMatchObject({ tranoValue: "1089.01", writtenValue: "1089.01" });
      expect(checked.cell(2, COLUMN.ek).value).toBe(1089.01);
    });
  });

  describe("10. a Cost Confirmation or waiting time already in the EK is counted once", () => {
    beforeEach(() => world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY)));

    it("a confirmation charged on its own EC line is not in the transport line's total", async () => {
      world.confirmations.push({ tripId: "t1", ccNumber: "4220981", amount: new Prisma.Decimal(110) });
      world.ekOf.set("t1", "110");

      const checked = await world.check([line("ANRDUB2810001", { ek: 200 }), costLine("ANRDUB2810001", 110, "4220981")]);

      expect(checked.result.rows.map((row) => row.status)).toEqual(["MATCHED", "COST_LINE"]);
      // 200 + 30 + (EK 110 − the 110 its EC line charges) = 230, not 340.
      expect(ekComparison(checked)).toMatchObject({ tranoValue: "230.00" });
      expect([checked.cell(2, COLUMN.ek).value, checked.cell(3, COLUMN.ek).value]).toEqual([230, 110]);
    });

    it("a recorded waiting time is the EK once; its superseded confirmation line is owed nothing", async () => {
      world.confirmations.push({ tripId: "t1", ccNumber: "4220981", amount: new Prisma.Decimal(110) });
      world.ekOf.set("t1", "55");
      world.componentsOf.set("t1", [
        component(EffectiveComponent.WAITING_TIME, "55"),
        component(EffectiveComponent.COST_CONFIRMATION, "0"),
      ]);

      const checked = await world.check([line("ANRDUB2810001"), costLine("ANRDUB2810001", 110, "4220981")]);

      // 200 + 30 + 55 waiting time; the confirmation is not added on top.
      expect(ekComparison(checked)).toMatchObject({ tranoValue: "285.00" });
      expect([checked.cell(2, COLUMN.ek).value, checked.cell(3, COLUMN.ek).value]).toEqual([285, 110]);
    });
  });

  describe("12. a Trip without a usable price: only the yellow", () => {
    it("a normal Trip whose snapshot carries a Backload is not relied on: nothing written", async () => {
      world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY));
      world.amountsOf.set("t1", OWNER_EXAMPLE);

      const checked = await world.check([line("ANRDUB2810001", { ek: 1050 })]);

      expect(checked.result.rows[0]).toMatchObject({ pricingStatus: "PRICE_UNRELIABLE", differences: [] });
      expect(checked.cell(2, COLUMN.ek).value).toBe(1050);
      expectWholeRowYellow(checked, 2);
    });

    it.each([
      ["never priced", (w: InvoiceWorld) => w.unpriced.add("t1")],
      ["a stored price nobody can rely on", (w: InvoiceWorld) => w.unreliable.add("t1")],
    ])("%s: no EK, no price, no Remarks written", async (_label, arrange) => {
      world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY));
      arrange(world);
      world.propertiesOf.set("t1", ["Flat"]);

      const checked = await world.check([line("ANRDUB2810001", { ek: 100, remarks: "tar 869" })]);

      expect(checked.result.rows[0]).toMatchObject({ pricingStatus: "PRICE_UNRELIABLE", differences: [], remarks: null });
      expect(
        [COLUMN.tarief, COLUMN.fuel, COLUMN.ek, COLUMN.remarks].map((column) => checked.cell(2, column).value),
      ).toEqual([null, null, 100, "tar 869"]);
      for (let column = 1; column <= LAST_COLUMN; column += 1) {
        expect(isRed(checked.cell(2, column))).toBe(false);
      }
      expectWholeRowYellow(checked, 2);
    });
  });

  describe("Remarks are completed as for any normal Trip", () => {
    beforeEach(() => world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY, TRANO_REMARK_FACTS)));

    it("13. the Trip's own facts are added", async () => {
      const checked = await world.check([line("ANRDUB2810001")]);

      expect(checked.cell(2, COLUMN.remarks).value).toBe("wachtuur 8:00 tot 9:30,klant belt vooraf");
    });

    it("14. its Custom Properties are added", async () => {
      world.propertiesOf.set("t1", ["Flat", "Stop"]);

      const checked = await world.check([line("ANRDUB2810001")]);

      expect(checked.cell(2, COLUMN.remarks).value).toBe("flat,stop,wachtuur 8:00 tot 9:30,klant belt vooraf");
    });

    it("15. the Excel's own Remarks are kept in front", async () => {
      world.propertiesOf.set("t1", ["Flat"]);

      const checked = await world.check([line("ANRDUB2810001", { remarks: "tar 869" })]);

      expect(checked.cell(2, COLUMN.remarks).value).toBe("tar 869,flat,wachtuur 8:00 tot 9:30,klant belt vooraf");
      expect(isRed(checked.cell(2, COLUMN.remarks))).toBe(true);
    });

    it("16. nothing stated already is added again, nor on a second check", async () => {
      world.propertiesOf.set("t1", ["Flat", "Stop"]);

      const first = await world.check([line("ANRDUB2810001", { remarks: "Flat , tar 869" })]);
      const again = await world.checkFile(first.written);

      expect(first.cell(2, COLUMN.remarks).value).toBe("Flat , tar 869,stop,wachtuur 8:00 tot 9:30,klant belt vooraf");
      expect(again.cell(2, COLUMN.remarks).value).toBe(first.cell(2, COLUMN.remarks).value);
      expect(again.result.rows[0].remarks).toBeNull();
      // Nor is the EK raised a second time: it now states the total.
      expect(again.cell(2, COLUMN.ek).value).toBe(230);
      expect(again.result.rows[0].marks).toEqual(["PRICES_MISSING"]);
    });
  });

  describe("Combinations keep their own rules", () => {
    it("17. situation A (Excel only): no total, each component compared as before", async () => {
      world.trips.push(aTrip("out", "ANRDUB2810001", "EUCU1000001", TUESDAY));
      world.trips.push(aTrip("back", "ANRDUB2810002", "EUCU1000001", TUESDAY));

      const checked = await world.check(
        excelCombination(line("ANRDUB2810001", { backload: 50 }), line("ANRDUB2810002", { backload: 50 })),
      );

      expect(checked.result.rows.map((row) => row.marks)).toEqual([
        ["PRICES_MISSING", "COMBINATION_ONLY_IN_EXCEL"],
        ["PRICES_MISSING", "COMBINATION_ONLY_IN_EXCEL"],
      ]);
      expect([checked.cell(2, COLUMN.ek).value, checked.cell(3, COLUMN.ek).value]).toEqual([null, null]);
      expect([checked.cell(2, COLUMN.backload).value, checked.cell(2, COLUMN.remarks).value]).toEqual([null, "GEEN COMBI"]);
      expect(ekComparison(checked)).toBeUndefined();
    });

    describe("situation B (Trano only)", () => {
      beforeEach(() => {
        world.trips.push(aTrip("grouped", "ANRDUB2810001", "EUCU1000001", TUESDAY, { tripGroupId: "group-1", ...TRANO_REMARK_FACTS }));
        world.backloadOf.set("grouped", "50");
        world.propertiesOf.set("grouped", ["Flat"]);
      });

      it("18. no total: the EK as it was", async () => {
        const checked = await world.check([line("ANRDUB2810001", { ek: 100 })]);

        expect(checked.cell(2, COLUMN.ek).value).toBe(100);
        expect(ekComparison(checked)).toMatchObject({ outcome: "INVOICE_HIGHER", tranoValue: "0.00" });
      });

      it("19. no Trano Remarks and no Custom Properties", async () => {
        const checked = await world.check([line("ANRDUB2810001", { remarks: "tar 869" })]);

        expect(checked.cell(2, COLUMN.remarks).value).toBe("tar 869");
        expect(checked.result.rows[0].remarks).toBeNull();
      });

      it("20. its €50 Backload not added, and marked for the warning", async () => {
        const checked = await world.check([line("ANRDUB2810001")]);

        expect(checked.cell(2, COLUMN.backload).value).toBeNull();
        expect(checked.result.rows[0].marks).toEqual(["PRICES_MISSING", "COMBINATION_ONLY_IN_TRANO"]);
        expectWholeRowYellow(checked, 2);
      });
    });

    it("21. a Combination on both sides: no total, its Backload raised as before", async () => {
      world.trips.push(aTrip("out", "ANRDUB2810001", "EUCU1000001", TUESDAY, { tripGroupId: "group-1" }));
      world.trips.push(aTrip("back", "ANRDUB2810002", "EUCU1000001", TUESDAY, { tripGroupId: "group-1" }));
      world.backloadOf.set("out", "50");
      world.backloadOf.set("back", "50");

      const checked = await world.check(excelCombination(line("ANRDUB2810001"), line("ANRDUB2810002")));

      expect(checked.result.rows.map((row) => [row.combination?.verdict, row.marks])).toEqual([
        ["RECOGNISED", ["PRICES_MISSING"]],
        ["RECOGNISED", ["PRICES_MISSING"]],
      ]);
      expect([checked.cell(2, COLUMN.backload).value, checked.cell(3, COLUMN.backload).value]).toEqual([50, 50]);
      expect([checked.cell(2, COLUMN.ek).value, checked.cell(3, COLUMN.ek).value]).toEqual([null, null]);
    });
  });

  it("an EK line standing in as its transport's line keeps the EK rules it had", async () => {
    world.trips.push(aTrip("other", "ANRDUB2810009", "EUCU1000009", TUESDAY));
    world.trips.push(aTrip("t1", "ANRDUB2810001", "EUCU1000001", TUESDAY));
    world.confirmations.push({ tripId: "t1", ccNumber: "4220981", amount: new Prisma.Decimal(110) });
    world.ekOf.set("t1", "110");

    const checked = await world.check([
      { ...line("ANRDUB2810009"), containerNumber: "EUCU 1000009", tarief: 200, fuel: 30 },
      costLine("ANRDUB2810001", 110, "4220981"),
    ]);

    expect(checked.result.rows[1]).toMatchObject({ status: "MATCHED", trip: { id: "t1" }, marks: ["PRICES_MISSING"] });
    // Compared as an EK, not as the transport's total of 340.
    expect(ekComparison(checked, 1)).toMatchObject({ tranoValue: "110.00" });
    expect(checked.cell(3, COLUMN.ek).value).toBe(110);
  });
});
