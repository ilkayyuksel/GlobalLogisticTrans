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
 */

export interface NavigationItem {
  readonly href: string;
  readonly labelKey: TranslationKey;
}

export const MAIN_NAVIGATION: readonly NavigationItem[] = [
  { href: "/dashboard", labelKey: "navigation.dashboard" },
  { href: "/trips", labelKey: "navigation.trips" },
  { href: "/vehicles", labelKey: "navigation.vehicles" },
  { href: "/maintenance", labelKey: "navigation.maintenance" },
  { href: "/calendar", labelKey: "navigation.calendar" },
  { href: "/notes", labelKey: "navigation.notes" },
  { href: "/pdf-debug", labelKey: "navigation.pdfDebug" },
];

export const SETTINGS_NAVIGATION: readonly NavigationItem[] = [
  { href: "/settings/license-plates", labelKey: "navigation.licensePlates" },
  { href: "/settings/custom-values", labelKey: "navigation.customValues" },
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
