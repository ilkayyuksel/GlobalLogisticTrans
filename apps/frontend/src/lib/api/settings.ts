import { request } from "./client";

const SETTINGS_PATH = "/api/v1/settings";

/**
 * A configured setting, as the backend stores it.
 *
 * `value` is a RAW string whatever the type: the backend keeps configuration in
 * one table with a declared `valueType`, and interpreting it is the caller's
 * job. Keys are unique only within a category.
 */
export interface Setting {
  id: string;
  category: string;
  key: string;
  value: string;
  valueType: "STRING" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE" | "JSON";
  description: string | null;
}

export function listSettings(signal?: AbortSignal): Promise<Setting[]> {
  return request<Setting[]>(SETTINGS_PATH, { signal });
}

/**
 * Sets one setting's value, whether or not it has ever been configured.
 *
 * ── WHY THERE IS NO SEPARATE "CREATE" ───────────────────────────────────────
 * PUT, so this is the ONE way the page writes a setting. A screen cannot know
 * whether a value exists on the server without asking first, and choosing
 * between two calls on the strength of a possibly stale list is how a fresh
 * deployment ended up unconfigurable: every save was an update, and an update
 * of a row that had never been created failed.
 *
 * The value travels as the RAW string the backend stores, whatever the declared
 * type: interpreting it is the backend's job, and a number formatted here would
 * be a second opinion about the format. Validation is the backend's too — the
 * refusal comes back with its own wording.
 */
export function saveSetting(
  category: string,
  key: string,
  value: string,
  signal?: AbortSignal,
): Promise<Setting> {
  return request<Setting>(`${SETTINGS_PATH}/${category}/${key}`, {
    method: "PUT",
    body: { value },
    signal,
  });
}

/**
 * One setting the Pricing Engine requires, and what bootstrapping would do
 * about it.
 *
 * `value` is null when no row exists. `proposedValue` is what bootstrapping
 * would write, and null both for a setting already configured — bootstrapping
 * never overwrites — and for one whose value cannot be determined, which
 * `blockedReason` then explains.
 */
export interface PricingSettingStatus {
  key: string;
  value: string | null;
  isConfigured: boolean;
  isActive: boolean;
  proposedValue: string | null;
  blockedReason: string | null;
}

/** The whole pricing configuration, and the gaps in it. */
export interface PricingBootstrapPlan {
  settings: PricingSettingStatus[];
  missingCount: number;
  creatableCount: number;
  blockedCount: number;
}

/** What is configured and what is missing. Writes nothing. */
export function getPricingBootstrapPlan(
  signal?: AbortSignal,
): Promise<PricingBootstrapPlan> {
  return request<PricingBootstrapPlan>(`${SETTINGS_PATH}/pricing/bootstrap`, {
    signal,
  });
}

/**
 * Creates the missing pricing settings, and only those.
 *
 * Returns the configuration as it stands afterwards, so the caller renders the
 * result rather than assuming it.
 */
export function applyPricingBootstrap(
  signal?: AbortSignal,
): Promise<PricingBootstrapPlan> {
  return request<PricingBootstrapPlan>(`${SETTINGS_PATH}/pricing/bootstrap`, {
    method: "POST",
    signal,
  });
}

/** The category and key the fuel percentage lives under. */
export const FUEL_PERCENTAGE_SETTING = {
  category: "PRICING",
  key: "FUEL_PERCENTAGE",
} as const;

/** The category and key the Pricing Engine reads its fuel percentage from. */
const PRICING_CATEGORY = "PRICING";
const FUEL_PERCENTAGE_KEY = "FUEL_PERCENTAGE";

/**
 * The configured fuel percentage, for the export to LABEL a stored surcharge.
 *
 * ── THIS NUMBER IS NEVER USED TO CALCULATE ──────────────────────────────────
 * The surcharge AMOUNT always comes from the stored pricing line. This is the
 * percentage the Pricing Engine was configured with, shown beside it so a
 * reader can see which rate produced the amount. Hardcoding 15% or 22% would
 * make the export lie the moment configuration changed.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Null when the setting is absent or unreadable: an export must not invent a
 * rate, and an empty percentage cell beside a real amount is honest.
 */
export function findFuelPercentage(settings: readonly Setting[]): number | null {
  const setting = settings.find(
    (candidate) =>
      candidate.key === FUEL_PERCENTAGE_KEY &&
      candidate.category === PRICING_CATEGORY,
  );

  if (!setting) {
    return null;
  }

  const percentage = Number(setting.value);

  return Number.isFinite(percentage) ? percentage : null;
}
