import { Prisma } from "@prisma/client";

import { MONEY_ROUNDING, sumLineAmounts, toStorableAmount } from "./pricing-money";

function decimals(...values: string[]): Prisma.Decimal[] {
  return values.map((value) => new Prisma.Decimal(value));
}

describe("pricing money", () => {
  describe("sumLineAmounts", () => {
    it("returns zero for a breakdown with no lines", () => {
      expect(sumLineAmounts([]).toFixed(2)).toBe("0.00");
    });

    it("returns the single amount for a one-line breakdown", () => {
      expect(sumLineAmounts(decimals("380.00")).toFixed(2)).toBe("380.00");
    });

    it("adds the seeded breakdown of BK-2026-1001 exactly", () => {
      expect(
        sumLineAmounts(decimals("450.00", "67.50", "25.00", "35.00")).toFixed(2),
      ).toBe("577.50");
    });

    it("adds the seeded breakdown of BK-2026-1002 exactly", () => {
      expect(
        sumLineAmounts(decimals("520.00", "75.00", "78.00")).toFixed(2),
      ).toBe("673.00");
    });

    it("adds the seeded breakdown of BK-2026-1003 exactly", () => {
      expect(
        sumLineAmounts(decimals("380.00", "57.00", "12.50", "35.00")).toFixed(2),
      ).toBe("484.50");
    });

    it("includes a zero line in the sum", () => {
      // A zero line is a real charge that happened to cost nothing; dropping it
      // would change the item count without changing the total.
      expect(sumLineAmounts(decimals("100.00", "0.00")).toFixed(2)).toBe(
        "100.00",
      );
    });

    it("adds several lines that share a component", () => {
      // Two fixed-price Custom Properties both reach the total.
      expect(
        sumLineAmounts(decimals("380.00", "35.00", "27.50")).toFixed(2),
      ).toBe("442.50");
    });

    it("returns a Decimal, never a JavaScript number", () => {
      expect(Prisma.Decimal.isDecimal(sumLineAmounts(decimals("1.00")))).toBe(
        true,
      );
    });

    /** 0.1 + 0.2 is 0.30000000000000004 in binary floating point. */
    it("does not accumulate floating-point error", () => {
      expect(sumLineAmounts(decimals("0.10", "0.20")).toFixed(2)).toBe("0.30");
    });

    it("stays exact across many small lines", () => {
      const tenCents = decimals(...Array<string>(10).fill("0.10"));

      expect(sumLineAmounts(tenCents).toFixed(2)).toBe("1.00");
    });

    it("sums amounts that are already rounded, adding no rounding of its own", () => {
      // Two lines of 0.005 would round to 0.01 each before they arrive here;
      // the total is the sum of the STORED figures, so a reader adding up the
      // breakdown by hand always reaches the printed total.
      const rounded = decimals("0.005", "0.005").map(toStorableAmount);

      expect(rounded.map((value) => value.toFixed(2))).toEqual(["0.01", "0.01"]);
      expect(sumLineAmounts(rounded).toFixed(2)).toBe("0.02");
    });

    it("carries a negative line through rather than clamping it", () => {
      // The sign guard belongs to the Engine, which refuses a negative TOTAL.
      // Silently clamping here would hide the configuration that produced it.
      expect(sumLineAmounts(decimals("100.00", "-150.00")).toFixed(2)).toBe(
        "-50.00",
      );
    });

    it("handles the largest amount the column can hold", () => {
      expect(sumLineAmounts(decimals("9999999999.99")).toFixed(2)).toBe(
        "9999999999.99",
      );
    });
  });

  describe("toStorableAmount", () => {
    it("rounds half up, the convention an invoice reader expects", () => {
      expect(MONEY_ROUNDING).toBe(Prisma.Decimal.ROUND_HALF_UP);
      expect(toStorableAmount(new Prisma.Decimal("0.005")).toFixed(2)).toBe(
        "0.01",
      );
    });

    it("leaves a two-decimal amount untouched", () => {
      expect(toStorableAmount(new Prisma.Decimal("12.50")).toFixed(2)).toBe(
        "12.50",
      );
    });
  });
});
