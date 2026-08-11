/**
 * The Settings the Pricing Engine reads.
 *
 * pricing_rules.md is explicit that no configurable value may be hardcoded:
 * every percentage, interval and surcharge comes from Settings, and the Engine
 * reads the current values on every calculation. This file therefore declares
 * only the KEYS — never the values.
 */

/** All pricing configuration lives in one Settings category. */
export const PRICING_SETTINGS_CATEGORY = "PRICING";

export const PricingSettingKey = {
  STRATEGY: "PRICING_STRATEGY",
  FUEL_PERCENTAGE: "FUEL_PERCENTAGE",
  COMBINATION_SURCHARGE: "COMBINATION_SURCHARGE",
  WAITING_TIME_FREE_MINUTES: "WAITING_TIME_FREE_MINUTES",
  WAITING_TIME_BLOCK_MINUTES: "WAITING_TIME_BLOCK_MINUTES",
  /**
   * Only required when the active strategy is DISTANCE_BASED, which is why it
   * is not part of the seeded configuration. A system switched to that strategy
   * without adding this Setting fails validation with a message naming the key.
   */
  DISTANCE_RATE_PER_KM: "DISTANCE_RATE_PER_KM",
} as const;

/**
 * The pricing strategies pricing_rules.md defines. Exactly one is active at a
 * time, chosen by the STRATEGY setting.
 *
 * A plain object rather than a TypeScript enum, so the stored Setting value and
 * the code constant are literally the same string.
 */
export const PricingStrategy = {
  ROUTE_BASED: "ROUTE_BASED",
  DISTANCE_BASED: "DISTANCE_BASED",
} as const;

export type PricingStrategy =
  (typeof PricingStrategy)[keyof typeof PricingStrategy];

export const SUPPORTED_PRICING_STRATEGIES = Object.values(PricingStrategy);

export function isPricingStrategy(value: string): value is PricingStrategy {
  return SUPPORTED_PRICING_STRATEGIES.includes(value as PricingStrategy);
}

/** A decimal Settings value, as stored: digits with an optional two-decimal part. */
const DECIMAL_PATTERN = /^-?\d+(\.\d{1,2})?$/;
const INTEGER_PATTERN = /^\d+$/;

/**
 * Decimal Settings are validated but deliberately NOT converted to a number.
 *
 * A percentage or a money rate that passes through a JavaScript float has
 * already lost the exactness the NUMERIC columns exist to preserve. The
 * calculation phase converts these strings straight into Decimal instead.
 * Whole minute counts are safe as numbers and are parsed here.
 */
export function isDecimalSettingValue(value: string): boolean {
  return DECIMAL_PATTERN.test(value.trim());
}

export function isNonNegativeIntegerSettingValue(value: string): boolean {
  return INTEGER_PATTERN.test(value.trim());
}
