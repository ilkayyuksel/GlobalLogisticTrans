import { CombinationMatchOutcome, Prisma } from "@prisma/client";

import type { CurrentTripPricing } from "../../trip-pricing/effective-pricing.service";
import { EXACT_COMBINATION_MATCH, EXACT_ROUTE_MATCH } from "../__fixtures__/invoice-pricing";
import { sheetRow, tripRecord } from "../__fixtures__/invoice-rows";
import {
  CombinationVerdict,
  InvoiceRowStatus,
  type InvoiceCombination,
  type InvoiceRowMatch,
} from "../matching/invoice-row-match";
import { toAmountCell } from "../workbook/invoice-amounts";
import type { InvoiceColumn } from "../workbook/invoice-columns";
import type { PriceReliability } from "./price-reliability";
import { reconcileTripRows } from "./trip-reconciliation";

/**
 * Every row one Trip is charged on: its own line and its Cost Confirmation
 * lines, compared together.
 */

const decimal = (value: string) => new Prisma.Decimal(value);
const RELIABLE: PriceReliability = { reliable: true, problem: null, explanation: null, route: null };
const TRIP = tripRecord();

function pricing(
  amounts: Partial<Record<"tarief" | "backload" | "ek", string>> = {},
  overrides: Partial<CurrentTripPricing> = {},
): CurrentTripPricing {
  return {
    components: [],
    tarief: decimal(amounts.tarief ?? "229"),
    brandstof: decimal("0"),
    backload: decimal(amounts.backload ?? "0"),
    tol: decimal("0"),
    tunnel: decimal("0"),
    others: decimal("0"),
    ek: decimal(amounts.ek ?? "0"),
    totaal: decimal("0"),
    routeMatch: EXACT_ROUTE_MATCH,
    ...overrides,
  };
}

function transport(
  rowNumber: number,
  amounts: Partial<Record<InvoiceColumn, unknown>>,
  combination: InvoiceCombination | null = null,
): InvoiceRowMatch {
  return match(sheetRow({ rowNumber, amounts: cells(amounts) }), InvoiceRowStatus.MATCHED, combination);
}

/** A Cost Confirmation line charging `ek` for confirmation `ccNumber` of `amount`. */
function costLine(rowNumber: number, ek: number, ccNumber: string, amount: string): InvoiceRowMatch {
  return {
    ...match(
      sheetRow({ rowNumber, costLine: { ccNumbers: [ccNumber] }, amounts: cells({ ek }) }),
      InvoiceRowStatus.COST_LINE,
      null,
    ),
    costConfirmation: { tripId: TRIP.id, ccNumber, amount: decimal(amount) },
  };
}

function match(
  row: ReturnType<typeof sheetRow>,
  status: InvoiceRowStatus,
  combination: InvoiceCombination | null,
): InvoiceRowMatch {
  return {
    row,
    status,
    trip: TRIP,
    candidates: [TRIP],
    sharedKeyRowNumbers: [],
    containerCorrection: null,
    bookingCorrection: null,
    costConfirmation: null,
    combination,
    problem: null,
  };
}

function cells(amounts: Partial<Record<InvoiceColumn, unknown>>) {
  return Object.fromEntries(
    Object.entries(amounts).map(([column, value]) => [column, toAmountCell(value)]),
  );
}

function reconcile(
  rows: readonly InvoiceRowMatch[],
  tripPricing: CurrentTripPricing | null = pricing(),
  reliability: PriceReliability = RELIABLE,
  partner: CurrentTripPricing | null = null,
) {
  return reconcileTripRows({
    rows,
    pricing: tripPricing,
    reliability,
    tariefColumnLetter: "L",
    fuelRate: null,
    pricingOfRow: () => partner,
  });
}

const outcomeOf = (outcomes: ReturnType<typeof reconcile>, rowNumber: number) =>
  outcomes.find((outcome) => outcome.rowNumber === rowNumber)!;

describe("reconcileTripRows", () => {
  describe("a Cost Confirmation line", () => {
    /** Week 41 R53: EK 110 for EC 4220981. */
    it("agrees with its own confirmation", () => {
      const outcomes = reconcile([costLine(53, 110, "4220981", "110")], pricing({ ek: "180" }));

      expect(outcomeOf(outcomes, 53)).toMatchObject({ status: "MATCHED_NO_CHANGES", differences: [] });
    });

    it("raises only its EK, never a Tarief", () => {
      const outcomes = reconcile([costLine(53, 100, "4220981", "110")], pricing({ ek: "180" }));

      expect(outcomeOf(outcomes, 53).differences).toEqual([
        expect.objectContaining({ component: "EK", column: "ek", kind: "RAISE" }),
      ]);
      expect(outcomeOf(outcomes, 53).differences[0].correctedValue?.toFixed(2)).toBe("110.00");
    });

    it("is never raised to a confirmation the waiting time displaces", () => {
      const outcomes = reconcile(
        [costLine(53, 110, "4220981", "110")],
        pricing(
          { ek: "55" },
          {
            components: [
              {
                componentCode: "WAITING_TIME",
                engineAmount: decimal("55"),
                effectiveAmount: decimal("55"),
                correctableAmount: decimal("55"),
                source: "ENGINE",
              },
            ],
          },
        ),
      );

      expect(outcomeOf(outcomes, 53).status).toBe("INVOICE_HIGHER");
    });
  });

  describe("a Trip with its own line and Cost Confirmation lines", () => {
    /**
     * The Trip's EK is 180: 110 + 70 on two confirmations. Both are on their
     * own lines, so the transport's own line owes NO EK — raising it to 180
     * would put both confirmations on the invoice twice.
     */
    it("takes what the Cost Confirmation lines charge off the line's own EK", () => {
      const outcomes = reconcile(
        [
          transport(2, { tarief: 229 }),
          costLine(53, 110, "4220981", "110"),
          costLine(54, 70, "4220982", "70"),
        ],
        pricing({ ek: "180" }),
      );

      expect(outcomes.flatMap((outcome) => outcome.differences)).toEqual([]);
    });

    it("raises the line's own EK only by what no Cost Confirmation line charges", () => {
      const outcomes = reconcile(
        [transport(2, { tarief: 229 }), costLine(53, 110, "4220981", "110")],
        pricing({ ek: "180" }),
      );

      expect(outcomeOf(outcomes, 2).differences[0].correctedValue?.toFixed(2)).toBe("70.00");
    });
  });

  describe("a price nobody can stand behind", () => {
    it("leaves every row of the Trip unwritten", () => {
      const unreliable: PriceReliability = {
        reliable: false,
        problem: "ROUTE_NOT_FOUND",
        explanation: "Voor de rit is geen route gevonden.",
        route: null,
      };

      const outcomes = reconcile(
        [transport(2, { tarief: 100 }), costLine(53, 100, "4220981", "110")],
        pricing({ ek: "110" }),
        unreliable,
      );

      expect(outcomes.map((outcome) => outcome.status)).toEqual(["PRICE_UNRELIABLE", "PRICE_UNRELIABLE"]);
      expect(outcomes.flatMap((outcome) => outcome.differences)).toEqual([]);
    });
  });

  describe("a Combination", () => {
    const recognised: InvoiceCombination = {
      verdict: CombinationVerdict.RECOGNISED,
      partnerRowNumber: 4,
      reason: null,
    };

    it("is compared normally when both halves were priced on one Combination", () => {
      const combined = pricing({ tarief: "235.35", backload: "50" }, { routeMatch: EXACT_COMBINATION_MATCH });

      const outcomes = reconcile([transport(3, { tarief: 235.35, backload: 50 }, recognised)], combined, RELIABLE, combined);

      expect(outcomeOf(outcomes, 3).status).toBe("MATCHED_NO_CHANGES");
    });

    it("is under review when the halves were priced on different Combinations", () => {
      const own = pricing({ backload: "50" }, { routeMatch: EXACT_COMBINATION_MATCH });
      const partner = pricing(
        { backload: "50" },
        {
          routeMatch: {
            ...EXACT_COMBINATION_MATCH,
            combinationRouteGroupId: "another-combination",
            combinationMatch: CombinationMatchOutcome.MATCHED,
          },
        },
      );

      const outcomes = reconcile([transport(3, { tarief: 100 }, recognised)], own, RELIABLE, partner);

      expect(outcomeOf(outcomes, 3)).toMatchObject({ status: "COMBINATION_REVIEW", differences: [] });
    });

    it("writes nothing on a pair under review", () => {
      const outcomes = reconcile(
        [transport(3, { tarief: 100 }, { verdict: CombinationVerdict.REVIEW, partnerRowNumber: null, reason: "no partner" })],
        pricing({ tarief: "235" }),
      );

      expect(outcomeOf(outcomes, 3)).toMatchObject({ status: "COMBINATION_REVIEW", differences: [] });
    });

    /** Week 13 R23: a Combination price on the invoice, none in the system. */
    it("removes the Backload of a GEEN COMBI line and raises its Tarief", () => {
      const outcomes = reconcile(
        [transport(23, { tarief: 80, backload: 50 }, { verdict: CombinationVerdict.GEEN_COMBI, partnerRowNumber: 24, reason: null })],
        pricing({ tarief: "155" }),
      );

      expect(outcomeOf(outcomes, 23).differences).toEqual([
        expect.objectContaining({ component: "Tarief", kind: "RAISE" }),
        expect.objectContaining({ component: "Backload", kind: "REMOVE", write: { kind: "VALUE", value: null } }),
      ]);
    });

    it("never removes a Backload outside a GEEN COMBI", () => {
      const outcomes = reconcile([transport(23, { tarief: 155, backload: 50 })], pricing({ tarief: "155" }));

      expect(outcomeOf(outcomes, 23).differences).toEqual([
        expect.objectContaining({ component: "Backload", kind: "INVOICE_HIGHER", write: null }),
      ]);
    });
  });
});
