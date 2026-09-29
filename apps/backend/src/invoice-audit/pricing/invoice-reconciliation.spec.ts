import { Prisma } from "@prisma/client";

import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import { toAmountCell } from "../workbook/invoice-amounts";
import type { InvoiceColumn } from "../workbook/invoice-columns";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import { reconcileLine, type InvoiceRowPricing } from "./invoice-reconciliation";

/**
 * What the invoice charges, against what this system holds.
 *
 * ── THE RULES THESE TESTS HOLD ──────────────────────────────────────────────
 * The effective pricing is the correct figure, always — this module never
 * recomputes a price, so every expectation here is simply "the invoice is made
 * to say what Trano says".
 *
 * Three of them are less obvious and are the reason this file is long:
 *   * an EMPTY cell and a 0,00 mean the same thing, and neither is a difference
 *     against a zero — but an empty cell against 18,18 is;
 *   * a line stated on SEVERAL rows is added up first, because that is what the
 *     customer means by it, and a total that cannot be placed on one row is
 *     reported rather than written somewhere;
 *   * the Fuel formula is left alone when the corrected Tarief already makes it
 *     produce the right amount.
 */

const CONTEXT = { tariefColumnLetter: "L" } as const;

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
    amounts: Object.fromEntries(
      Object.entries(amounts).map(([column, value]) => [
        column,
        toAmountCell(value),
      ]),
    ),
  };
}

const first = (outcomes: readonly InvoiceRowPricing[]) => outcomes[0];

/** The difference for one component, if there is one. */
const differenceFor = (outcome: InvoiceRowPricing, component: string) =>
  outcome.differences.find((difference) => difference.component === component);

describe("reconcileLine", () => {
  describe("Tarief", () => {
    it("reports no difference when the invoice already agrees", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 135 })], pricing({ tarief: "135" }), CONTEXT),
      );

      expect(outcome.status).toBe("MATCHED_NO_CHANGES");
      expect(outcome.differences).toEqual([]);
    });

    it("corrects a Tarief that differs", () => {
      const outcome = first(
        reconcileLine([row(2, { tarief: 364 })], pricing({ tarief: "370" }), CONTEXT),
      );

      expect(outcome.status).toBe("PRICING_CORRECTED");
      expect(differenceFor(outcome, "Tarief")).toMatchObject({
        column: "tarief",
        correctionRowNumber: 2,
        keepsFormula: false,
      });
      expect(differenceFor(outcome, "Tarief")?.invoiceValue?.toFixed(2)).toBe("364.00");
      expect(differenceFor(outcome, "Tarief")?.expectedValue.toFixed(2)).toBe("370.00");
      expect(differenceFor(outcome, "Tarief")?.correctedValue?.toFixed(2)).toBe("370.00");
      expect(differenceFor(outcome, "Tarief")?.difference.toFixed(2)).toBe("6.00");
    });

    /** Cents matter, and binary floating point loses them. */
    it("compares to the cent", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { tarief: 135.01 })],
          pricing({ tarief: "135.00" }),
          CONTEXT,
        ),
      );

      expect(outcome.status).toBe("PRICING_CORRECTED");
      expect(differenceFor(outcome, "Tarief")?.difference.toFixed(2)).toBe("-0.01");
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
  });

  describe("Fuel", () => {
    it("corrects a hard value that differs", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { tarief: 364, fuel: 36.4 })],
          pricing({ tarief: "364", brandstof: "43.70" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Fuel")).toMatchObject({ keepsFormula: false });
      expect(differenceFor(outcome, "Fuel")?.correctedValue?.toFixed(2)).toBe("43.70");
    });

    /**
     * ── THE FORMULA DOES THE WORK ───────────────────────────────────────────
     * `10%*L7` on a Tarief corrected to 370 produces 37,00, which is what this
     * system holds. The cell keeps its formula; only what it last calculated is
     * refreshed, so the file reads correctly before Excel recalculates.
     */
    it("keeps a formula that will produce the right amount", () => {
      const outcome = first(
        reconcileLine(
          [
            row(7, {
              tarief: 364,
              fuel: { formula: "10%*L7", result: 36.4 },
            }),
          ],
          pricing({ tarief: "370", brandstof: "37.00" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Tarief")?.correctedValue?.toFixed(2)).toBe("370.00");
      expect(differenceFor(outcome, "Fuel")).toMatchObject({
        keepsFormula: true,
        correctionRowNumber: 7,
      });
      expect(differenceFor(outcome, "Fuel")?.correctedValue?.toFixed(2)).toBe("37.00");
    });

    /** A formula that would NOT produce it must give way to the amount. */
    it("replaces a formula whose result would still be wrong", () => {
      const outcome = first(
        reconcileLine(
          [
            row(7, {
              tarief: 364,
              fuel: { formula: "10%*L7", result: 36.4 },
            }),
          ],
          // A fuel percentage of 12% on our side: the sheet's own 10% formula
          // cannot arrive at it.
          pricing({ tarief: "370", brandstof: "44.40" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Fuel")).toMatchObject({ keepsFormula: false });
      expect(differenceFor(outcome, "Fuel")?.correctedValue?.toFixed(2)).toBe("44.40");
    });

    it("does not read a formula pointing at another row", () => {
      const outcome = first(
        reconcileLine(
          [row(7, { tarief: 364, fuel: { formula: "10%*L2", result: 36.4 } })],
          pricing({ tarief: "370", brandstof: "37.00" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Fuel")).toMatchObject({ keepsFormula: false });
    });
  });

  describe("Backload", () => {
    it("agrees when neither charges one", () => {
      const outcome = first(reconcileLine([row(2, {})], pricing(), CONTEXT));

      expect(outcome.status).toBe("MATCHED_NO_CHANGES");
    });

    /**
     * The Combination surcharge as the Engine resolved it for this Trip. Whether
     * its partner appears on the invoice is not consulted: the figure already
     * carries the grouping.
     */
    it("writes the Combination surcharge into an empty cell", () => {
      const outcome = first(
        reconcileLine([row(2, {})], pricing({ backload: "50" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Backload")).toMatchObject({
        column: "backload",
        correctionRowNumber: 2,
      });
      expect(differenceFor(outcome, "Backload")?.correctedValue?.toFixed(2)).toBe("50.00");
    });

    it("removes a surcharge this system does not charge", () => {
      const outcome = first(
        reconcileLine([row(2, { backload: 50 })], pricing(), CONTEXT),
      );

      expect(differenceFor(outcome, "Backload")?.correctedValue?.toFixed(2)).toBe("0.00");
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
     * and the correction goes to Tol B — the only one these documents ever
     * fill. Maut and Tol FR are hidden and empty in every reference workbook.
     */
    it("compares Maut, Tol B and Tol FR as one sum", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { maut: 10, tolB: 20, tolFr: 5 })],
          pricing({ tol: "35" }),
          CONTEXT,
        ),
      );

      expect(outcome.status).toBe("MATCHED_NO_CHANGES");
    });

    it("corrects into Tol B, never into Maut or Tol FR", () => {
      const outcome = first(
        reconcileLine([row(2, { tolB: 21.83 })], pricing({ tol: "63.84" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Tol")).toMatchObject({
        column: "tolB",
        correctionRowNumber: 2,
      });
      expect(differenceFor(outcome, "Tol")?.correctedValue?.toFixed(2)).toBe("63.84");
    });

    /** What the other two already state stays theirs; the sum comes out right. */
    it("leaves what Maut states where it is", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { maut: 10, tolB: 20 })],
          pricing({ tol: "50" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Tol")).toMatchObject({ column: "tolB" });
      expect(differenceFor(outcome, "Tol")?.correctedValue?.toFixed(2)).toBe("40.00");
    });

    it("writes the whole toll into Tol B when the invoice states none", () => {
      const outcome = first(
        reconcileLine([row(2, {})], pricing({ tol: "18.40" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Tol")?.correctedValue?.toFixed(2)).toBe("18.40");
    });

    /** A hidden column stating more than we hold cannot be fixed in Tol B. */
    it("reports rather than write a negative Tol B", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { maut: 100, tolB: 5 })],
          pricing({ tol: "50" }),
          CONTEXT,
        ),
      );

      expect(outcome.status).toBe("NOT_DISTRIBUTABLE");
      expect(differenceFor(outcome, "Tol")?.correctedValue).toBeNull();
      expect(differenceFor(outcome, "Tol")?.problem).toMatch(/cannot correct/);
    });
  });

  describe("Tunnel and Others", () => {
    it("corrects a Tunnel that differs", () => {
      const outcome = first(
        reconcileLine([row(2, { tunnel: 18.18 })], pricing({ tunnel: "36.36" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Tunnel")?.correctedValue?.toFixed(2)).toBe("36.36");
    });

    it("leaves an agreed Tunnel alone", () => {
      const outcome = first(
        reconcileLine([row(2, { tunnel: 36.36 })], pricing({ tunnel: "36.36" }), CONTEXT),
      );

      expect(outcome.differences).toEqual([]);
    });

    /**
     * Others is taken exactly as this system reports it — waiting time
     * included, because that is what the effective figure holds and nothing here
     * recomputes it.
     */
    it("corrects Others to the effective figure", () => {
      const outcome = first(
        reconcileLine([row(2, { others: 14 })], pricing({ others: "84" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Others")?.correctedValue?.toFixed(2)).toBe("84.00");
    });
  });

  describe("EK", () => {
    it("corrects a single EK line", () => {
      const outcome = first(
        reconcileLine([row(2, { ek: 55 })], pricing({ ek: "137.50" }), CONTEXT),
      );

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
     * ── AND WHEN THE TOTAL DISAGREES ────────────────────────────────────────
     * Which of the two confirmations changed is not in the document. Nothing is
     * written, both rows keep their amounts, and the line is reported.
     */
    it("reports a differing total it cannot place on one of several rows", () => {
      const outcomes = reconcileLine(
        [row(10, { ek: 120 }), row(11, { ek: 80 })],
        pricing({ ek: "250" }),
        CONTEXT,
      );

      expect(outcomes[0].status).toBe("NOT_DISTRIBUTABLE");
      const difference = differenceFor(outcomes[0], "EK");
      expect(difference?.invoiceValue?.toFixed(2)).toBe("200.00");
      expect(difference?.expectedValue.toFixed(2)).toBe("250.00");
      expect(difference?.difference.toFixed(2)).toBe("50.00");
      expect(difference?.correctedValue).toBeNull();
      expect(difference?.problem).toMatch(/stated on 2 rows/);
      // The second row carries nothing at all: one report, not two.
      expect(outcomes[1].differences).toEqual([]);
    });

    it("writes an EK the invoice never stated onto the line's own row", () => {
      const outcomes = reconcileLine(
        [row(2, { tarief: 135 }), row(3, { tarief: null })],
        pricing({ tarief: "135", ek: "41.25" }),
        CONTEXT,
      );

      expect(differenceFor(outcomes[0], "EK")).toMatchObject({
        correctionRowNumber: 2,
      });
      expect(differenceFor(outcomes[0], "EK")?.correctedValue?.toFixed(2)).toBe("41.25");
    });

    /** The EK row carries the correction, not the transport's own line. */
    it("corrects the row that states the EK", () => {
      const outcomes = reconcileLine(
        [row(2, { tarief: 135 }), row(3, { ek: 120 })],
        pricing({ tarief: "135", ek: "150" }),
        CONTEXT,
      );

      expect(outcomes[0].differences).toEqual([]);
      expect(differenceFor(outcomes[1], "EK")).toMatchObject({
        correctionRowNumber: 3,
      });
      expect(differenceFor(outcomes[1], "EK")?.correctedValue?.toFixed(2)).toBe("150.00");
    });
  });

  describe("an empty cell against a figure", () => {
    it("reads empty and 0,00 as the same thing", () => {
      const outcome = first(reconcileLine([row(2, {})], pricing(), CONTEXT));

      expect(outcome.differences).toEqual([]);
    });

    it("reads a stated 0,00 against 0,00 as agreement", () => {
      const outcome = first(
        reconcileLine([row(2, { tunnel: 0 })], pricing(), CONTEXT),
      );

      expect(outcome.differences).toEqual([]);
    });

    it("reads empty against 18,18 as a difference", () => {
      const outcome = first(
        reconcileLine([row(2, {})], pricing({ tunnel: "18.18" }), CONTEXT),
      );

      expect(differenceFor(outcome, "Tunnel")?.invoiceValue).toBeNull();
      expect(differenceFor(outcome, "Tunnel")?.correctedValue?.toFixed(2)).toBe("18.18");
    });

    it("reads 18,18 against nothing charged as a difference", () => {
      const outcome = first(
        reconcileLine([row(2, { tunnel: 18.18 })], pricing(), CONTEXT),
      );

      expect(differenceFor(outcome, "Tunnel")?.correctedValue?.toFixed(2)).toBe("0.00");
    });
  });

  describe("an operator's correction", () => {
    /**
     * A Trip whose Tarief an operator corrected by hand reports the CORRECTED
     * figure as its effective pricing — this module reads that figure and never
     * the Engine's own. The invoice is therefore made to say what the operator
     * decided.
     */
    it("uses the effective figure, overrides included", () => {
      const outcome = first(
        reconcileLine(
          [row(2, { tarief: 135 })],
          // What `EffectivePricingService` answers for a Trip with an override.
          pricing({ tarief: "160" }),
          CONTEXT,
        ),
      );

      expect(differenceFor(outcome, "Tarief")?.correctedValue?.toFixed(2)).toBe("160.00");
    });
  });
});
