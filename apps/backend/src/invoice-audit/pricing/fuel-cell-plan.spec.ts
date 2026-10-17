import { Prisma } from "@prisma/client";

import { toAmountCell } from "../workbook/invoice-amounts";
import { planFuelCell, type FuelCellInput } from "./fuel-cell-plan";

/**
 * How a Fuel cell is written so Excel's own recalculation cannot move it.
 *
 * The example the owner reviewed is week 41, row 5: Tarief 229, Fuel
 * `=24%*L5` showing 54,96.
 */

const decimal = (value: string) => new Prisma.Decimal(value);

function input(overrides: Partial<FuelCellInput> = {}): FuelCellInput {
  return {
    rowNumber: 5,
    tariefColumnLetter: "L",
    cell: toAmountCell({ formula: "24%*L5", result: 54.96 }),
    finalTarief: decimal("229"),
    tariefChanged: false,
    systemFuel: decimal("54.96"),
    systemRate: decimal("24"),
    ...overrides,
  };
}

describe("planFuelCell", () => {
  it("leaves an agreeing formula alone", () => {
    expect(planFuelCell(input())).toMatchObject({ action: "UNCHANGED", raised: false });
  });

  it("leaves a higher Fuel alone when its Tarief stays", () => {
    expect(planFuelCell(input({ systemFuel: decimal("45.80") }))).toMatchObject({
      action: "UNCHANGED",
    });
  });

  it("keeps the formula that comes to the raised amount after a Tarief raise", () => {
    expect(
      planFuelCell(input({ finalTarief: decimal("300"), tariefChanged: true, systemFuel: decimal("72") })),
    ).toMatchObject({
      action: "FORMULA",
      keepsOwnFormula: true,
      formula: "24%*L5",
      raised: true,
    });
  });

  it("writes this system's percentage when it comes to the raised amount", () => {
    const plan = planFuelCell(input({ systemFuel: decimal("59.54"), systemRate: decimal("26") }));

    expect(plan).toMatchObject({ action: "FORMULA", formula: "26%*L5", raised: true });
    expect(plan.shown.toFixed(2)).toBe("59.54");
    // What Excel stores: 26% of 229 is exactly 59.54.
    expect(plan.result?.toString()).toBe("59.54");
  });

  /** The cached result is what Excel computes, not the cent it shows. */
  it("stores the unrounded result a formula calculates", () => {
    const plan = planFuelCell(
      input({
        cell: toAmountCell({ formula: "24%*L5", result: 43.04 }),
        finalTarief: decimal("179.35"),
        systemFuel: decimal("43.04"),
        tariefChanged: true,
      }),
    );

    expect(plan.result?.toString()).toBe("43.044");
  });

  /**
   * ── THE CASE THE OWNER REVIEWED ─────────────────────────────────────────
   * Tarief 229 → 300; system Fuel 45,00 at 15%. The Fuel stays 54,96. Neither
   * `24%*L5` (72,00) nor `15%*L5` (45,00) comes to it, so it becomes a figure.
   */
  it("freezes the amount when no formula keeps it after a Tarief raise", () => {
    const plan = planFuelCell(
      input({
        finalTarief: decimal("300"),
        tariefChanged: true,
        systemFuel: decimal("45.00"),
        systemRate: decimal("15"),
      }),
    );

    expect(plan).toMatchObject({ action: "VALUE", raised: false, formula: null });
    expect(plan.shown.toFixed(2)).toBe("54.96");
  });

  it("writes the raised amount as a figure when no rate is recorded", () => {
    const plan = planFuelCell(input({ systemFuel: decimal("60.00"), systemRate: null }));

    expect(plan).toMatchObject({ action: "VALUE", raised: true });
    expect(plan.shown.toFixed(2)).toBe("60.00");
  });

  it("raises an empty Fuel cell", () => {
    const plan = planFuelCell(
      input({ cell: toAmountCell(null), systemFuel: decimal("54.96") }),
    );

    expect(plan).toMatchObject({ action: "FORMULA", formula: "24%*L5", raised: true });
  });

  it("never lowers a plain figure", () => {
    expect(
      planFuelCell(input({ cell: toAmountCell(80.16), systemFuel: decimal("78.00") })),
    ).toMatchObject({ action: "UNCHANGED", raised: false });
  });
});
