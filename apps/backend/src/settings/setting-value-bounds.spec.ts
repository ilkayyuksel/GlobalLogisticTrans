import { minimumValueFor } from "./setting-value-bounds";

/**
 * The registry is data, and its entries encode business constraints that no
 * value type can express. Asserting them here keeps the list honest: a bound
 * silently removed or loosened fails this spec rather than surfacing as a
 * negative price months later.
 */
describe("setting value bounds", () => {
  describe("pricing amounts", () => {
    it.each([
      "FUEL_PERCENTAGE",
      "COMBINATION_SURCHARGE",
      "DISTANCE_RATE_PER_KM",
      "WAITING_TIME_BLOCK_PRICE",
    ])("bounds PRICING.%s at zero", (key) => {
      // pricing_rules.md: negative pricing is not supported. Zero stays valid.
      expect(minimumValueFor("PRICING", key)).toBe(0);
    });
  });

  describe("the waiting-time minute counts", () => {
    it("bounds the block size at one, because it is a divisor", () => {
      expect(minimumValueFor("PRICING", "WAITING_TIME_BLOCK_MINUTES")).toBe(1);
    });

    it("bounds the free allowance at zero, not at one", () => {
      // Zero is a valid allowance: it means waiting is billable from the first
      // minute. Only the divisor may not be zero.
      expect(minimumValueFor("PRICING", "WAITING_TIME_FREE_MINUTES")).toBe(0);
    });
  });

  describe("settings without a bound", () => {
    it.each([
      ["PRICING", "PRICING_STRATEGY"],
      ["GENERAL", "COMPANY_NAME"],
      ["PRICING", "SOME_FUTURE_SETTING"],
    ])("returns no minimum for %s.%s", (category, key) => {
      expect(minimumValueFor(category, key)).toBeUndefined();
    });
  });

  it("bounds every numeric pricing setting", () => {
    // A pricing setting added without a bound is the gap this registry exists
    // to close; PRICING_STRATEGY is the only non-numeric one.
    const numericPricingSettings = [
      "FUEL_PERCENTAGE",
      "COMBINATION_SURCHARGE",
      "DISTANCE_RATE_PER_KM",
      "WAITING_TIME_FREE_MINUTES",
      "WAITING_TIME_BLOCK_MINUTES",
      "WAITING_TIME_BLOCK_PRICE",
    ];

    for (const key of numericPricingSettings) {
      expect(minimumValueFor("PRICING", key)).toBeDefined();
    }
  });

  it("scopes a bound to its category, not to the key alone", () => {
    // A key of the same name in another category is a different setting.
    expect(minimumValueFor("GENERAL", "FUEL_PERCENTAGE")).toBeUndefined();
  });
});
