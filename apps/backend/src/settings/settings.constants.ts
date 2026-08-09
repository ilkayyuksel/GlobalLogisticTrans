/**
 * Categories the application accepts.
 *
 * `setting.category` is a TEXT column rather than a PostgreSQL enum precisely so
 * that a new category never requires a database migration (database_schema.md
 * §7.2). Validation therefore lives here: adding a category is a one-line change
 * to this array, with no schema change and no data migration.
 */
export const SETTING_CATEGORIES = [
  "GENERAL",
  "PLANNING",
  "PRICING",
  "IMPORT",
  "EXPORT",
  "PARSER",
  "NOTIFICATION",
  "WHATSAPP",
] as const;

export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

/**
 * Keys are addressed through the URL, so the accepted character set is kept
 * deliberately narrow. Existing keys use SCREAMING_SNAKE_CASE
 * (FUEL_PERCENTAGE, PRICING_STRATEGY), but dots and dashes are permitted for
 * namespaced keys a future module may introduce.
 */
export const SETTING_KEY_PATTERN = /^[A-Za-z0-9_.-]+$/;
