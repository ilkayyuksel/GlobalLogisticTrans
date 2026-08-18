/**
 * Numeric bounds that a setting's value TYPE cannot express.
 *
 * SettingValueValidator answers "is this parseable as an INTEGER" and nothing
 * more, because that is all the value type declares. A few settings additionally
 * have a bound that makes them usable at all — a divisor that may not be zero,
 * for instance.
 *
 * The bound is kept here rather than inside the type validator so the validator
 * stays a pure function of value and type, and so the exceptional settings are
 * visible in one short list instead of hidden in a switch.
 *
 * Each entry needs a documented reason. A bound invented here would be a
 * business rule smuggled into a generic key/value store.
 */

/** Bounds are keyed by the pair that uniquely identifies a setting. */
function settingIdentity(category: string, key: string): string {
  return `${category}.${key}`;
}

/**
 * Inclusive minimums, by setting.
 *
 * `PRICING.WAITING_TIME_BLOCK_MINUTES` — pricing_rules.md defines a positive
 * block size as a configuration validation rule: the value is the divisor that
 * converts billable waiting minutes into blocks, so zero leaves the pricing
 * formula undefined. A minimum of one whole minute is the smallest usable block.
 *
 * The four pricing amounts below are bounded at zero rather than at one.
 * pricing_rules.md § Business Constraints states that negative pricing is not
 * supported, and each of these values feeds an amount directly: a negative
 * percentage, surcharge, rate or block price would produce a negative pricing
 * line. Zero remains valid for all four and means the component is configured
 * but charges nothing — pricing_examples.md example 9 relies on exactly that.
 *
 * `PRICING.WAITING_TIME_THRESHOLD_MINUTES` — the wait at which charging begins.
 * Bounded at zero for the same reason as the allowance: a negative threshold
 * would describe charging before any waiting had happened. Zero means there is
 * no threshold, and charging begins as soon as the allowance is exceeded.
 *
 * `PRICING.WAITING_TIME_FREE_MINUTES` — pricing_rules.md states the free
 * allowance is "zero or greater". A negative allowance would make waiting time
 * billable before it was even incurred. Zero remains valid and means there is
 * no free allowance at all, which pricing_examples.md example 10 relies on.
 */
const MINIMUM_BY_SETTING: ReadonlyMap<string, number> = new Map([
  [settingIdentity("PRICING", "WAITING_TIME_BLOCK_MINUTES"), 1],
  [settingIdentity("PRICING", "FUEL_PERCENTAGE"), 0],
  [settingIdentity("PRICING", "COMBINATION_SURCHARGE"), 0],
  [settingIdentity("PRICING", "DISTANCE_RATE_PER_KM"), 0],
  [settingIdentity("PRICING", "WAITING_TIME_BLOCK_PRICE"), 0],
  [settingIdentity("PRICING", "WAITING_TIME_FREE_MINUTES"), 0],
  [settingIdentity("PRICING", "WAITING_TIME_THRESHOLD_MINUTES"), 0],
]);

/** The inclusive minimum for a setting, or undefined when it has no bound. */
export function minimumValueFor(
  category: string,
  key: string,
): number | undefined {
  return MINIMUM_BY_SETTING.get(settingIdentity(category, key));
}
