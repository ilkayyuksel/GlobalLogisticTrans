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
 * Changes one setting's value.
 *
 * The value travels as the RAW string the backend stores, whatever the declared
 * type: interpreting it is the backend's job, and a number formatted here would
 * be a second opinion about the format. Validation is the backend's too — the
 * refusal comes back with its own wording.
 */
export function updateSetting(
  category: string,
  key: string,
  value: string,
  signal?: AbortSignal,
): Promise<Setting> {
  return request<Setting>(`${SETTINGS_PATH}/${category}/${key}`, {
    method: "PATCH",
    body: { value },
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
