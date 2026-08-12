/**
 * The version of the Pricing Engine that produced a snapshot.
 *
 * Stored on every `trip_pricing` row so a historical calculation can always be
 * attributed to the code that made it. That is why this is a source constant
 * rather than configuration: it answers "which version of this code ran", and
 * only the code can answer that truthfully. An environment variable could be
 * set to a value the deployed build does not match, which would silently
 * mislabel every snapshot written — the opposite of what the field is for.
 *
 * Bump it when a change alters what the Engine CALCULATES: a new component, a
 * changed formula, a different rounding rule. A refactor that provably produces
 * identical amounts does not bump it.
 *
 * Distinct from `pricingRuleVersion`, which records the CONFIGURATION the
 * calculation ran against and is a Setting an administrator maintains. Two
 * snapshots can share an engine version and differ in rule version, or the
 * reverse; keeping them apart is what makes a disputed invoice explainable.
 */
export const PRICING_ENGINE_VERSION = "1.0.0";
