import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * The kinds of maintenance this workshop actually books.
 *
 * ── WHY A FIXED LIST, AND WHY IN THE UI ─────────────────────────────────────
 * `maintenanceType` used to be free text, which meant "Banden", "banden" and
 * "Bandenwissel" were three different things to anyone counting. A closed list
 * makes the field answerable and, later, groupable.
 *
 * It lives here rather than in the database on purpose: it is a UI vocabulary,
 * not business data. There is no master table, no endpoint and no foreign key —
 * the backend keeps taking a string, and this decides which strings the UI
 * offers.
 *
 * ── WHAT IS STORED ──────────────────────────────────────────────────────────
 * The CODE is stored, never the label. A record entered in Turkish and read in
 * Dutch must be the same record, which a stored translation cannot manage.
 *
 * ── WHAT WAS ALREADY STORED ─────────────────────────────────────────────────
 * Records predating this list hold free text such as "Grote beurt". Nothing is
 * migrated: an unrecognised value is shown exactly as stored and offered as an
 * extra option in its own record's picker, so editing something else about that
 * record cannot silently rewrite its type. Only a deliberate change to one of
 * the listed types replaces it.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const MAINTENANCE_TYPES = [
  "OIL_CHANGE",
  "BRAKES",
  "TIRES",
  "INSPECTION",
  "TACHOGRAPH",
  "MAINTENANCE",
  "REPAIR",
  "LIGHTS",
  "ENGINE",
  "GEARBOX",
  "COOLING",
  "AIR_CONDITIONING",
  "ELECTRICAL",
  "OTHER",
] as const;

export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export function isMaintenanceType(value: string): value is MaintenanceType {
  return (MAINTENANCE_TYPES as readonly string[]).includes(value);
}

/** The translation key for a listed type. */
export function maintenanceTypeLabelKey(type: MaintenanceType): TranslationKey {
  return `maintenance.type.${type}` as TranslationKey;
}

/**
 * What to show for a stored value, translated when it is one of ours.
 *
 * Free text stored before this list existed passes through unchanged rather
 * than being hidden or relabelled — it is what someone actually wrote.
 */
export function maintenanceTypeLabel(
  storedValue: string | null,
  translate: (key: TranslationKey) => string,
): string | null {
  if (storedValue === null) {
    return null;
  }

  return isMaintenanceType(storedValue)
    ? translate(maintenanceTypeLabelKey(storedValue))
    : storedValue;
}
