import { SettingValueType } from "@prisma/client";

/**
 * The pricing configuration the Pricing Engine requires, and what to create it
 * with when it is absent.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * `prisma/seed.ts` deliberately creates no Setting rows, and explains why: a
 * seeded placeholder would look like real configuration and could silently
 * produce a wrong price on a finished Trip. That reasoning still holds for
 * amounts nobody has decided.
 *
 * What it did NOT anticipate is the state it leaves behind. A fresh deployment
 * has migrations but no pricing settings, so the Engine refuses every
 * calculation with "PRICING.PRICING_STRATEGY is missing or inactive", no
 * snapshot is ever written, and the whole Ritten pricing screen is empty — with
 * no way to fix it from the application, because the Settings API could only
 * ever edit a row that already existed.
 *
 * So the values below are not invented defaults. They are the configuration
 * this business is ALREADY running, transcribed from a working database, and
 * they exist here so an operator can create the rows from the Configuration
 * page instead of writing SQL. Every one of them stays editable afterwards.
 *
 * ── AND WHY THE KEYS ARE SPELLED OUT ────────────────────────────────────────
 * `PricingSettingKey` in the pricing-engine module is the authority on these
 * names. This file cannot import it: the Engine already depends on Settings,
 * and importing back would close a cycle. `setting-value-bounds.ts` spells the
 * same keys out for exactly the same reason.
 *
 * The duplication is therefore forced, and it is BOUND rather than trusted:
 * `pricing-settings.catalog.spec.ts` imports both and fails if this catalog
 * and the Engine's keys ever disagree.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** All pricing configuration lives in one Settings category. */
export const PRICING_CATEGORY = "PRICING";

/**
 * One setting the Engine needs.
 *
 * `defaultValue` is null for the one setting whose value cannot be written
 * down: see `AUTOMATIC_CUSTOM_PROPERTY_ID` below.
 */
export interface PricingSettingDefinition {
  readonly key: string;
  readonly valueType: SettingValueType;
  readonly description: string;
  /** Null when the value can only be resolved from the database it lives in. */
  readonly defaultValue: string | null;
}

export const PRICING_SETTING_CATALOG: readonly PricingSettingDefinition[] = [
  {
    key: "PRICING_STRATEGY",
    valueType: SettingValueType.STRING,
    description:
      "How the Base Price is derived: ROUTE_BASED reads the configured route price, DISTANCE_BASED multiplies the Trip's distance by the configured rate.",
    defaultValue: "ROUTE_BASED",
  },
  {
    key: "FUEL_PERCENTAGE",
    valueType: SettingValueType.DECIMAL,
    description:
      "Percentage applied to the Base Price only, never to any other component. The rate that applied on the day is stored on each pricing snapshot, so changing this never restates a finished Trip.",
    defaultValue: "15",
  },
  {
    key: "COMBINATION_SURCHARGE",
    valueType: SettingValueType.DECIMAL,
    description:
      "Charged on EACH leg of a genuine two-Trip Combination. A manual Trip group is not a Combination and never attracts it.",
    defaultValue: "50.00",
  },
  {
    /**
     * The one value that cannot be written down here.
     *
     * It is the ID of a row in THIS database, and an id copied from another
     * environment would point at nothing — or worse, at some unrelated
     * property, which would silently charge the wrong amount on every Trip.
     * It is resolved from the live database by name; see the bootstrap.
     */
    key: "AUTOMATIC_CUSTOM_PROPERTY_ID",
    valueType: SettingValueType.STRING,
    description:
      "The Custom Property the Engine applies without anyone assigning it — TAR. Stored as the property's id so the AMOUNT stays the one configured on the property itself.",
    defaultValue: null,
  },
  {
    key: "WAITING_TIME_FREE_MINUTES",
    valueType: SettingValueType.INTEGER,
    description:
      "The allowance subtracted before waiting time is charged. Distinct from the threshold below; both apply.",
    defaultValue: "120",
  },
  {
    key: "WAITING_TIME_THRESHOLD_MINUTES",
    valueType: SettingValueType.INTEGER,
    description:
      "The wait at which charging begins at all. A shorter wait costs nothing even when it already exceeds the free allowance.",
    defaultValue: "150",
  },
  {
    key: "WAITING_TIME_BLOCK_MINUTES",
    valueType: SettingValueType.INTEGER,
    description:
      "The block chargeable waiting time is rounded up into. Every block that is STARTED is charged in full.",
    defaultValue: "15",
  },
  {
    key: "WAITING_TIME_BLOCK_PRICE",
    valueType: SettingValueType.DECIMAL,
    description: "The price of one started waiting-time block.",
    defaultValue: "13.75",
  },
  {
    key: "DISTANCE_RATE_PER_KM",
    valueType: SettingValueType.DECIMAL,
    description:
      "Price per kilometre, read only by the DISTANCE_BASED strategy. Configured so switching strategy does not require configuration first.",
    defaultValue: "2.75",
  },
  {
    key: "PRICING_RULE_VERSION",
    valueType: SettingValueType.STRING,
    description:
      "The ruleset version stamped onto every snapshot this configuration produces. An administrator bumps it when the pricing rules change, so it travels with the rules it describes.",
    defaultValue: "2026.1",
  },
];

/** The name the automatic Custom Property is known by in this business. */
export const AUTOMATIC_CUSTOM_PROPERTY_NAME = "TAR";

/** The key whose value must be resolved from the database rather than typed. */
export const AUTOMATIC_CUSTOM_PROPERTY_SETTING_KEY =
  "AUTOMATIC_CUSTOM_PROPERTY_ID";

/** The definition for one key, or undefined when the key is not a pricing one. */
export function pricingSettingDefinition(
  key: string,
): PricingSettingDefinition | undefined {
  return PRICING_SETTING_CATALOG.find((setting) => setting.key === key);
}
