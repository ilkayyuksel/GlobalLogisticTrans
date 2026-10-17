import { Prisma } from "@prisma/client";

import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import { toAmountCell } from "../workbook/invoice-amounts";
import type { InvoiceColumn } from "../workbook/invoice-columns";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import {
  reconcileLine,
  type InvoiceRowPricing,
  type LineContext,
} from "./invoice-reconciliation";

/**
 * What the invoice charges, against what this system holds.
 *
 * ── THE RULES THESE TESTS HOLD ──────────────────────────────────────────────
 * The effective pricing is never recomputed here. An amount is RAISED to it
 * when it is strictly higher, to the cent, and otherwise left exactly as the
 * customer wrote it — equal or lower, nothing changes, and a lower figure of
 * ours is only reported. The Backload of an established GEEN COMBI is the one
 * amount that may be removed.
 *
 * And three that make this file long:
 *   * an EMPTY cell compares as zero, but a cell holding a word, a dash or an
 *     uncalculated formula makes the whole line unreadable;
 *   * a line stated on SEVERAL rows is added up first, and a raise that cannot
 *     be placed on one row leaves the WHOLE line unwritten;
 *   * the Fuel follows the row's Tarief through its formula, so it is planned
 *     after the Tarief and may have to be frozen at the amount it shows.
 */

const CONTEXT: LineContext = { tariefColumnLetter: "L", fuelRate: null };

function pricing(overrides: Partial<Record<string, string>> = {}): EffectivePricing {
  const amount = (key: string, fallback: string) =>
    new Prisma.Decimal(overrides[key] ?? fallback);

  return {
    components: [],
    tarief: amount("tarief", "0"),
    brandstof: amount("brandstof", "0"),
    backload: amount("backload", "0"),
    tol: amount("tol", "0"),
    tunnel: amount("tunnel", "0"),
    others: amount("others", "0"),
    ek: amount("ek", "0"),
    totaal: amount("totaal", "0"),
  };
}

/** One invoice row, with only the amounts a test cares about. */
function row(
  rowNumber: number,
  amounts: Partial<Record<InvoiceColumn, unknown>> = {},
): InvoiceSheetRow {
  return {
    rowNumber,
    planningDate: "2026-03-23",
    bookingNumber: "DUBANR2718284",
    containerNumber: "EUCU 4581604",
    normalizedContainerNumber: "EUCU4581604",
    startPoint: "",
    endPoint: "",
    remarks: "",
    costLine: null,
    amounts: Object.fromEntries(
      Object.entries(amounts).map(([column, value]) => [column, toAmountCell(value)]),
    ),
  };
}

const first = (outcomes: readonly InvoiceRowPricing[]) => outcomes[0];

/** The difference for one component, if there is one. */
const differenceFor = (outcome: InvoiceRowPricing, component: string) =>
  outcome.differences.find((difference) => difference.component === component);

const writes = (outcomes: readonly InvoiceRowPricing[]) =>
  outcomes.flatMap((outcome) => outcome.differences).filter((difference) => difference.write);

describe("reconcileLine", () => {
  describe("only ever up", () => {
    it("reports no difference when the invoice already agrees", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 135 })], pricing({ tarief: "135" }), CONTEXT),
      );

      expect(outcome.status).toBe("MATCHED_NO_CHANGES");
      expect(outcome.differences).toEqual([]);
    });

    it("raises a Tarief this system holds higher", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 364 })], pricing({ tarief: "370" }), CONTEXT),
      );

      expect(outcome.status).toBe("PRICING_CORRECTED");
      expect(differenceFor(outcome, "Tarief")).toMatchObject({
        kind: "RAISE",
        column: "tarief",
        correctionRowNumber: 2,
        keepsFormula: false,
      });
      expect(differenceFor(outcome, "Tarief")?.invoiceValue?.toFixed(2)).toBe("364.00");
      expect(differenceFor(outcome, "Tarief")?.correctedValue?.toFixed(2)).toBe("370.00");
      expect(differenceFor(outcome, "Tarief")?.difference.toFixed(2)).toBe("6.00");
    });

    /** A lower figure of ours is reported and never written. */
    it("never lowers a Tarief the invoice states higher", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 334 })], pricing({ tarief: "300" }), CONTEXT),
      );

      expect(outcome.status).toBe("INVOICE_HIGHER");
      expect(differenceFor(outcome, "Tarief")).toMatchObject({
        kind: "INVOICE_HIGHER",
        correctedValue: null,
        write: null,
      });
      expect(differenceFor(outcome, "Tarief")?.difference.toFixed(2)).toBe("-34.00");
    });

    /** Cents matter, and binary floating point loses them. */
    it("raises by a single cent", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 134.99 })], pricing({ tarief: "135.00" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Tarief")?.correctedValue?.toFixed(2)).toBe("135.00");
    });

    it("leaves an invoice one cent higher alone", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 135.01 })], pricing({ tarief: "135.00" }), CONTEXT),
      );

      expect(writes([outcome])).toEqual([]);
      expect(outcome.status).toBe("INVOICE_HIGHER");
    });

    it("treats 0.1 + 0.2 as 0.30 rather than as 0.30000000000000004", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { tarief: 0.1 }), row(3, { tarief: 0.2 })],
          pricing({ tarief: "0.30" }),
          CONTEXT,
        ),
      );

      expect(outcome.status).toBe("MATCHED_NO_CHANGES");
    });

    it("compares a difference below half a cent as equal", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 43.044 })], pricing({ tarief: "43.04" }), CONTEXT),
      );

      expect(outcome.differences).toEqual([]);
    });
  });

  describe("Fuel", () => {
    it("raises a hard value this system holds higher", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { tarief: 364, fuel: 36.4 })],
          pricing({ tarief: "364", brandstof: "43.70" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Fuel")).toMatchObject({ kind: "RAISE", keepsFormula: false });
      expect(differenceFor(outcome, "Fuel")?.write).toEqual({
        kind: "VALUE",
        value: new Prisma.Decimal("43.70"),
      });
    });

    /**
     * ── THE FORMULA DOES THE WORK ───────────────────────────────────────────
     * `10%*L7` on a Tarief raised to 370 produces 37,00, which is what this
     * system holds. The cell keeps its formula; only its cached result changes.
     */
    it("keeps a formula that will produce the right amount", () => {
      const outcome = first(
        reconcileLine(
          [row(7, { tarief: 364, fuel: { formula: "10%*L7", result: 36.4 } })],
          pricing({ tarief: "370", brandstof: "37.00" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Fuel")).toMatchObject({
        kind: "RAISE",
        keepsFormula: true,
        correctionRowNumber: 7,
        write: { kind: "FORMULA", formula: "10%*L7" },
      });
      expect(differenceFor(outcome, "Fuel")?.correctedValue?.toFixed(2)).toBe("37.00");
    });

    it("writes the amount when the formula would not produce it and no rate is known", () => {
      const outcome = first(
        reconcileLine(
          [row(7, { tarief: 364, fuel: { formula: "10%*L7", result: 36.4 } })],
          pricing({ tarief: "370", brandstof: "44.40" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Fuel")).toMatchObject({ keepsFormula: false });
      expect(differenceFor(outcome, "Fuel")?.write).toEqual({
        kind: "VALUE",
        value: new Prisma.Decimal("44.40"),
      });
    });

    /** This system's own percentage, in the customer's own shape. */
    it("writes this system's percentage as a formula when it comes to the amount", () => {
      const outcome = first(
        reconcileLine(
          [row(5, { tarief: 229, fuel: { formula: "24%*L5", result: 54.96 } })],
          pricing({ tarief: "229", brandstof: "59.54" }),
          { ...CONTEXT, fuelRate: new Prisma.Decimal("26") },
        ),
      );

      expect(differenceFor(outcome, "Fuel")).toMatchObject({
        kind: "RAISE",
        keepsFormula: false,
        write: { kind: "FORMULA", formula: "26%*L5" },
      });
    });

    /**
     * ── WEEK 41, ROW 5 ──────────────────────────────────────────────────────
     * The Tarief goes up, this system's Fuel is LOWER than the invoice's. The
     * Fuel must stay 54,96 — but `24%*L5` would follow the new Tarief to 72,00
     * the moment Excel recalculates. So the amount is written as a figure.
     */
    it("freezes a Fuel formula that would follow a raised Tarief past its amount", () => {
      const outcome = first(
        reconcileLine(
          [row(5, { tarief: 229, fuel: { formula: "24%*L5", result: 54.96 } })],
          pricing({ tarief: "300", brandstof: "45.00" }),
          { ...CONTEXT, fuelRate: new Prisma.Decimal("15") },
        ),
      );

      expect(outcome.status).toBe("PRICING_CORRECTED");
      expect(differenceFor(outcome, "Tarief")?.correctedValue?.toFixed(2)).toBe("300.00");
      expect(differenceFor(outcome, "Fuel")).toMatchObject({
        kind: "KEEP_AMOUNT",
        write: { kind: "VALUE", value: new Prisma.Decimal("54.96") },
      });
    });

    it("leaves a Fuel formula alone when its Tarief does not change", () => {
      const outcome = first(
        reconcileLine(
          [row(5, { tarief: 229, fuel: { formula: "24%*L5", result: 54.96 } })],
          pricing({ tarief: "229", brandstof: "45.80" }),
          CONTEXT,
        ),
      );

      expect(writes([outcome])).toEqual([]);
      expect(differenceFor(outcome, "Fuel")?.kind).toBe("INVOICE_HIGHER");
    });

    it("does not read a formula pointing at another row", () => {
      const outcome = first(
        reconcileLine(
          [row(7, { tarief: 364, fuel: { formula: "10%*L2", result: 36.4 } })],
          pricing({ tarief: "370", brandstof: "37.00" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Fuel")).toMatchObject({
        keepsFormula: false,
        write: { kind: "VALUE", value: new Prisma.Decimal("37.00") },
      });
    });
  });

  describe("Backload", () => {
    it("agrees when neither charges one", () => {
      expect(first(reconcileLine([row(2, {})], pricing(), CONTEXT)).status).toBe(
        "MATCHED_NO_CHANGES",
      );
    });

    it("writes the Combination surcharge into an empty cell", () => {
      const outcome = first(reconcileLine([row(2, {})], pricing({ backload: "50" }), CONTEXT));

      expect(differenceFor(outcome, "Backload")).toMatchObject({
        kind: "RAISE",
        column: "backload",
        correctionRowNumber: 2,
      });
      expect(differenceFor(outcome, "Backload")?.correctedValue?.toFixed(2)).toBe("50.00");
    });

    /** Only an established GEEN COMBI may take it away — see the next test. */
    it("keeps a surcharge this system does not charge", () => {
      const outcome = first(reconcileLine([row(2, { backload: 50 })], pricing(), CONTEXT));

      expect(differenceFor(outcome, "Backload")).toMatchObject({
        kind: "INVOICE_HIGHER",
        write: null,
      });
    });

    it("removes it — leaving the cell empty — when removal is allowed", () => {
      const outcome = first(
        reconcileLine([row(2, { backload: 50 })], pricing(), {
          ...CONTEXT,
          backloadRemovalAllowed: true,
        }),
      );

      expect(outcome.status).toBe("PRICING_CORRECTED");
      expect(differenceFor(outcome, "Backload")).toMatchObject({
        kind: "REMOVE",
        write: { kind: "VALUE", value: null },
      });
    });

    it("never removes any other component, even when removal is allowed", () => {
      const outcome = first(
        reconcileLine([row(2, { tunnel: 36.2 })], pricing(), {
          ...CONTEXT,
          backloadRemovalAllowed: true,
        }),
      );

      expect(writes([outcome])).toEqual([]);
    });

    it("leaves an agreed surcharge alone", () => {
      const outcome = first(
        reconcileLine([row(2, { backload: 50 })], pricing({ backload: "50" }), CONTEXT),
      );

      expect(outcome.differences).toEqual([]);
    });
  });

  describe("the toll", () => {
    /**
     * ── THREE COLUMNS, ONE FIGURE ───────────────────────────────────────────
     * The customer splits the toll by country; this system holds one amount and
     * has no rule that could split it. So the three are compared as their sum,
     * and a raise goes to Tol B — the only one these documents ever fill.
     */
    it("compares Maut, Tol B and Tol FR as one sum", () => {
      const outcome = first(
        reconcileLine([row(2, { maut: 10, tolB: 20, tolFr: 5 })], pricing({ tol: "35" }), CONTEXT),
      );

      expect(outcome.status).toBe("MATCHED_NO_CHANGES");
    });

    it("raises into Tol B, never into Maut, Tol FR or Tunnel", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { tolB: 21.83, tunnel: 36.2 })],
          pricing({ tol: "63.84", tunnel: "36.2" }),
          CONTEXT,
        ),
      );

      expect(writes([outcome])).toHaveLength(1);
      expect(differenceFor(outcome, "Tol")).toMatchObject({ column: "tolB", correctionRowNumber: 2 });
      expect(differenceFor(outcome, "Tol")?.correctedValue?.toFixed(2)).toBe("63.84");
    });

    /** What the other two already state stays theirs; the sum comes out right. */
    it("leaves what Maut states where it is", () => {
      const outcome = first(
        reconcileLine([row(2, { maut: 10, tolB: 20 })], pricing({ tol: "50" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Tol")?.correctedValue?.toFixed(2)).toBe("40.00");
    });

    it("writes the whole toll into Tol B when the invoice states none", () => {
      const outcome = first(reconcileLine([row(2, {})], pricing({ tol: "18.40" }), CONTEXT));

      expect(differenceFor(outcome, "Tol")?.correctedValue?.toFixed(2)).toBe("18.40");
    });

    it("never lowers the toll the three columns state together", () => {
      const outcome = first(
        reconcileLine([row(2, { maut: 100, tolB: 5 })], pricing({ tol: "50" }), CONTEXT),
      );

      expect(outcome.status).toBe("INVOICE_HIGHER");
      expect(writes([outcome])).toEqual([]);
    });
  });

  describe("Tunnel and Others", () => {
    it("raises a Tunnel this system holds higher", () => {
      const outcome = first(
        reconcileLine([row(2, { tunnel: 18.18 })], pricing({ tunnel: "36.36" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Tunnel")?.correctedValue?.toFixed(2)).toBe("36.36");
    });

    it("raises an empty Tunnel", () => {
      const outcome = first(reconcileLine([row(2, {})], pricing({ tunnel: "36.20" }), CONTEXT));

      expect(differenceFor(outcome, "Tunnel")?.invoiceValue).toBeNull();
      expect(differenceFor(outcome, "Tunnel")?.correctedValue?.toFixed(2)).toBe("36.20");
    });

    it("keeps a Tunnel this system does not charge", () => {
      const outcome = first(reconcileLine([row(2, { tunnel: 18.18 })], pricing(), CONTEXT));

      expect(writes([outcome])).toEqual([]);
      expect(differenceFor(outcome, "Tunnel")?.kind).toBe("INVOICE_HIGHER");
    });

    /** Others is the priced Custom Properties, exactly as this system reports them. */
    it("raises Others to the effective figure", () => {
      const outcome = first(
        reconcileLine([row(2, { others: 14 })], pricing({ others: "84" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Others")?.correctedValue?.toFixed(2)).toBe("84.00");
    });

    /** Each component lands in its own column, whatever else differs. */
    it("writes every component into its own column", () => {
      const outcome = first(
        reconcileLine(
          [row(2, {})],
          pricing({
            tarief: "1",
            brandstof: "2",
            backload: "3",
            tol: "4",
            tunnel: "5",
            others: "6",
            ek: "7",
          }),
          CONTEXT,
        ),
      );

      expect(
        Object.fromEntries(
          outcome.differences.map((difference) => [
            difference.column,
            difference.correctedValue?.toFixed(0),
          ]),
        ),
      ).toEqual({ tarief: "1", fuel: "2", backload: "3", tolB: "4", tunnel: "5", others: "6", ek: "7" });
    });
  });

  describe("EK", () => {
    it("raises a single EK line", () => {
      const outcome = first(reconcileLine([row(2, { ek: 55 })], pricing({ ek: "137.50" }), CONTEXT));

      expect(differenceFor(outcome, "EK")?.correctedValue?.toFixed(2)).toBe("137.50");
    });

    /** Two confirmations, two invoice lines, one total. */
    it("adds several EK lines up before comparing", () => {
      const outcomes = reconcileLine(
        [row(10, { ek: 120 }), row(11, { ek: 80 })],
        pricing({ ek: "200" }),
        CONTEXT,
      );

      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "MATCHED_NO_CHANGES",
        "MATCHED_NO_CHANGES",
      ]);
    });

    /**
     * ── AND WHEN THE TOTAL MUST GO UP ───────────────────────────────────────
     * Which of the two confirmations changed is not in the document. Nothing is
     * written on the line at all, and every row of it is reported.
     */
    it("reports a raise it cannot place on one of several rows", () => {
      const outcomes = reconcileLine(
        [row(10, { ek: 120 }), row(11, { ek: 80 })],
        pricing({ ek: "250" }),
        CONTEXT,
      );

      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "NOT_DISTRIBUTABLE",
        "NOT_DISTRIBUTABLE",
      ]);
      const difference = differenceFor(outcomes[0], "EK");
      expect(difference?.invoiceValue?.toFixed(2)).toBe("200.00");
      expect(difference?.expectedValue.toFixed(2)).toBe("250.00");
      expect(difference?.correctedValue).toBeNull();
      expect(difference?.problem).toMatch(/stated on 2 rows/);
      // The second row carries nothing at all: one report, not two.
      expect(outcomes[1].differences).toEqual([]);
    });

    /** A transport is corrected completely or not at all. */
    it("writes nothing else on a line that has a raise it cannot place", () => {
      const outcomes = reconcileLine(
        [row(10, { tarief: 100, ek: 120 }), row(11, { ek: 80 })],
        pricing({ tarief: "150", ek: "250" }),
        CONTEXT,
      );

      expect(writes(outcomes)).toEqual([]);
      expect(differenceFor(outcomes[0], "Tarief")?.correctedValue).toBeNull();
    });

    it("writes an EK the invoice never stated onto the line's own row", () => {
      const outcomes = reconcileLine(
        [row(2, { tarief: 135 }), row(3, { tarief: null })],
        pricing({ tarief: "135", ek: "41.25" }),
        CONTEXT,
      );

      expect(differenceFor(outcomes[0], "EK")).toMatchObject({ correctionRowNumber: 2 });
      expect(differenceFor(outcomes[0], "EK")?.correctedValue?.toFixed(2)).toBe("41.25");
    });

    /** The EK row carries the raise, not the transport's own line. */
    it("raises the row that states the EK", () => {
      const outcomes = reconcileLine(
        [row(2, { tarief: 135 }), row(3, { ek: 120 })],
        pricing({ tarief: "135", ek: "150" }),
        CONTEXT,
      );

      expect(outcomes[0].differences).toEqual([]);
      expect(differenceFor(outcomes[1], "EK")).toMatchObject({ correctionRowNumber: 3 });
      expect(differenceFor(outcomes[1], "EK")?.correctedValue?.toFixed(2)).toBe("150.00");
    });
  });

  describe("a cell that is not an amount", () => {
    it.each([
      ["a dash", "-"],
      ["a word", "nvt"],
      ["an Excel error", { error: "#REF!" }],
      ["a formula nobody calculated", { formula: "24%*L2" }],
    ])("makes the whole line unreadable when it holds %s", (_label, value) => {
      const outcomes = reconcileLine(
        [row(2, { tarief: 100, tunnel: value }), row(3, { ek: 20 })],
        pricing({ tarief: "150", tunnel: "36.20", ek: "40" }),
        CONTEXT,
      );

      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "AMOUNT_UNREADABLE",
        "AMOUNT_UNREADABLE",
      ]);
      expect(writes(outcomes)).toEqual([]);
      expect(differenceFor(outcomes[0], "Tunnel")).toMatchObject({ kind: "UNREADABLE", column: "tunnel" });
    });

    it("reads an empty cell and 0,00 as the same thing", () => {
      expect(first(reconcileLine([row(2, { tunnel: 0 })], pricing(), CONTEXT)).differences).toEqual(
        [],
      );
    });
  });

  describe("an operator's correction", () => {
    /**
     * A Trip whose Tarief an operator corrected by hand reports the CORRECTED
     * figure as its effective pricing — this module reads that figure and never
     * the Engine's own.
     */
    it("uses the effective figure, overrides included", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 135 })], pricing({ tarief: "160" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Tarief")?.correctedValue?.toFixed(2)).toBe("160.00");
    });
  });
});
