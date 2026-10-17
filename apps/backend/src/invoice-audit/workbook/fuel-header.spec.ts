import { Prisma } from "@prisma/client";

import { openThreeLineWeek } from "../__fixtures__/invoice-opened";
import type { AddedRow } from "../missing/added-rows";
import {
  DifferenceKind,
  InvoicePricingStatus,
  type CellWrite,
  type InvoiceRowPricing,
} from "../pricing/invoice-reconciliation";
import { planFuelHeader, writeFuelHeader } from "./fuel-header";

/** The check's plan for one line: only its Fuel cell is written. */
function fuelWritten(rowNumber: number, write: CellWrite): [number, InvoiceRowPricing] {
  return [
    rowNumber,
    {
      rowNumber,
      status: InvoicePricingStatus.PRICING_CORRECTED,
      reliability: null,
      differences: [
        {
          component: "Fuel",
          kind: DifferenceKind.RAISE,
          column: "fuel",
          invoiceValue: new Prisma.Decimal("13.50"),
          expectedValue: new Prisma.Decimal("32.40"),
          difference: new Prisma.Decimal("18.90"),
          correctionRowNumber: rowNumber,
          correctedValue: new Prisma.Decimal("32.40"),
          keepsFormula: false,
          write,
          problem: null,
        },
      ],
    },
  ];
}

const atPercentage = (percentage: string, rowNumber: number): CellWrite => ({
  kind: "FORMULA",
  formula: `${percentage}%*L${rowNumber}`,
  result: new Prisma.Decimal(135).mul(percentage).div(100),
});

/** All three lines of the week written at one new percentage. */
const allAt = (percentage: string) =>
  new Map([2, 3, 4].map((rowNumber) => fuelWritten(rowNumber, atPercentage(percentage, rowNumber))));

/** An added line with a reliable price, as far as its Fuel is concerned. */
function addedWithFuel(tarief: string, brandstof: string): AddedRow {
  return {
    pricing: { tarief: new Prisma.Decimal(tarief), brandstof: new Prisma.Decimal(brandstof) },
    reliability: { reliable: true },
  } as unknown as AddedRow;
}

describe("planFuelHeader", () => {
  it("rewrites header and label when every Fuel cell states one new percentage", async () => {
    const { worksheet, sheet } = await openThreeLineWeek();

    expect(planFuelHeader(worksheet, sheet, allAt("24"))).toEqual({
      percentage: "24",
      header: { address: "M1", before: "Fuel 10%", after: "Fuel 24%" },
      // The customer's trailing space stays.
      label: { address: "K8", before: "Fuel 10% ", after: "Fuel 24% " },
    });
  });

  it("keeps the header when one line stays at the old percentage", async () => {
    const { worksheet, sheet } = await openThreeLineWeek();
    const pricing = allAt("24");

    pricing.delete(4);

    expect(planFuelHeader(worksheet, sheet, pricing)).toBeNull();
  });

  it("keeps the header when one line is written as a fixed amount", async () => {
    const { worksheet, sheet } = await openThreeLineWeek();
    const pricing = allAt("24");

    pricing.set(...fuelWritten(4, { kind: "VALUE", value: new Prisma.Decimal("32.40") }));

    expect(planFuelHeader(worksheet, sheet, pricing)).toBeNull();
  });

  it("keeps the header when nothing changes its percentage", async () => {
    const { worksheet, sheet } = await openThreeLineWeek();

    expect(planFuelHeader(worksheet, sheet, new Map())).toBeNull();
  });

  it("counts an added line that fits the new percentage as part of the column", async () => {
    const { worksheet, sheet } = await openThreeLineWeek();

    expect(
      planFuelHeader(worksheet, sheet, allAt("24"), [addedWithFuel("200", "48")])?.percentage,
    ).toBe("24");
  });

  it("keeps the header when an added line's Fuel would not come out at it", async () => {
    const { worksheet, sheet } = await openThreeLineWeek();

    expect(planFuelHeader(worksheet, sheet, allAt("24"), [addedWithFuel("200", "46")])).toBeNull();
  });
});

describe("writeFuelHeader", () => {
  it("writes the planned header and label, nothing else", async () => {
    const { worksheet, sheet } = await openThreeLineWeek();
    const change = planFuelHeader(worksheet, sheet, allAt("24"))!;

    writeFuelHeader(worksheet, change);

    expect(worksheet.getCell("M1").value).toBe("Fuel 24%");
    expect(worksheet.getCell("K8").value).toBe("Fuel 24% ");
    expect(worksheet.getCell("L8").formula).toBe("M5");
  });
});
