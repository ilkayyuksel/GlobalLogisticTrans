/**
 * The colours a truck can be given in the planning.
 *
 * ── ONE LIST, USED EVERYWHERE ───────────────────────────────────────────────
 * A planning colour has exactly one job: make one truck tellable from the next
 * down a long list of rows. That job is done by the STORED colour — the Vehicle
 * form writes a hex value, and the Ritten table and the Vehicles list read it
 * back. Nothing renders a colour of its own, and no component carries its own
 * list of swatches: this file is the only place colours are chosen from, so
 * adding one is a one-line change here.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── HOW THESE WERE PICKED ───────────────────────────────────────────────────
 * Six hue families — blue, teal, green, amber, red/pink, violet — each in
 * several strengths, plus two neutrals. Twenty-four in all, comfortably more
 * than the twenty a growing fleet needs, and enough separation between
 * neighbours that two trucks are never a shade apart.
 *
 * Every value is a mid-to-deep tone taken from the same scale the rest of the
 * interface uses. That is deliberate: these are painted as small solid swatches
 * and stripes behind white or dark text in BOTH themes, and pale tints wash out
 * on the light theme while very dark ones disappear on the dark one.
 *
 * No gradients. A gradient has no single hex value, so it could not be stored.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The colour a new Vehicle starts with. */
export const DEFAULT_FLEET_COLOR = "#2563eb";

export const FLEET_COLORS = [
  // Blue
  "#1d4ed8",
  "#2563eb",
  "#0ea5e9",
  "#0369a1",
  // Teal and cyan
  "#0891b2",
  "#0d9488",
  "#14b8a6",
  // Green
  "#059669",
  "#16a34a",
  "#65a30d",
  "#4d7c0f",
  // Amber and yellow
  "#ca8a04",
  "#d97706",
  "#ea580c",
  "#b45309",
  // Red and pink
  "#dc2626",
  "#b91c1c",
  "#e11d48",
  "#db2777",
  "#9d174d",
  // Violet
  "#7c3aed",
  "#6d28d9",
  "#a21caf",
  // Neutral, for the trucks nobody wants a colour for
  "#4b5563",
] as const;

/** The stored form of a colour: lower-case six-digit hex, as the backend validates. */
export function toStoredColor(color: string): string {
  return color.trim().toLowerCase();
}

/** Whether a stored colour is one of the offered swatches. */
export function isFleetColor(color: string): boolean {
  return FLEET_COLORS.includes(toStoredColor(color) as (typeof FLEET_COLORS)[number]);
}
