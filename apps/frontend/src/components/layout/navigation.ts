import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * The product's navigation, in one place.
 *
 * Labels are translation KEYS, never literal strings: the shell exists in two
 * languages, and a hardcoded label here would be the one item that never
 * translates.
 *
 * The hour-based Planning board is deliberately absent. It still works and is
 * still routable, but it is a detail view of one day rather than a top-level
 * section of the product, and promoting it would put two competing "where are
 * my trips" entries side by side.
 *
 * PDF Debug is absent too: it is a developer page, not a section an operator
 * works in. `/pdf-debug` is still routable for whoever needs it.
 */

export interface NavigationItem {
  readonly href: string;
  readonly labelKey: TranslationKey;
}

export const MAIN_NAVIGATION: readonly NavigationItem[] = [
  { href: "/dashboard", labelKey: "navigation.dashboard" },
  { href: "/trips", labelKey: "navigation.trips" },
  { href: "/vehicles", labelKey: "navigation.vehicles" },
  { href: "/drivers", labelKey: "navigation.drivers" },
  { href: "/maintenance", labelKey: "navigation.maintenance" },
  { href: "/calendar", labelKey: "navigation.calendar" },
  { href: "/notes", labelKey: "navigation.notes" },
];

/**
 * Nummerplaten is absent on purpose: a plate is managed where it belongs, on
 * the Vehicle (Voertuigen) and through the driver assignments, and a second
 * place in Settings would be a duplicate. `/settings/license-plates` is still
 * routable — it only points to Voertuigen — but no longer offered here.
 */
export const SETTINGS_NAVIGATION: readonly NavigationItem[] = [
  { href: "/settings/custom-values", labelKey: "navigation.customValues" },
  { href: "/settings/pricing", labelKey: "navigation.pricingSettings" },
];

/**
 * Whether a navigation item covers the current path.
 *
 * A section stays highlighted while a detail page beneath it is open, so
 * `/trips/{id}` keeps "Ritten" active. Matching is on path SEGMENTS, so
 * `/notes` is not considered active on a hypothetical `/notes-archive`.
 */
export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True when any settings page is open, so the dropdown itself reads active. */
export function isSettingsActive(pathname: string): boolean {
  return SETTINGS_NAVIGATION.some((item) => isActiveRoute(pathname, item.href));
}
