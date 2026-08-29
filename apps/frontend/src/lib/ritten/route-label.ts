import type { Trip } from "@/lib/api/types";

/**
 * The canonical route, as one line of text.
 *
 * ── THIS IS FORMATTING, NOT ROUTE BUILDING ──────────────────────────────────
 * The route itself — which end is the origin, which is the destination, and
 * what the terminal is called — is decided by the BACKEND and arrives on the
 * Trip as `route`. This module only joins the two ends with an arrow, and it
 * exists so the Ritten table and both Excel exports render that join the same
 * way rather than each writing their own.
 *
 * Nothing here reads `terminal`, `destinationCity` or `direction`. Assembling a
 * route from those fields on this side is exactly what would drift out of step
 * with the export and with future pricing.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Between the two ends. A real arrow: the screen and the sheet both render it. */
export const ROUTE_SEPARATOR = "→";

/**
 * `FROM → TO`, or the caller's empty marker when the Trip has no route.
 *
 * A Trip with only one end shows the end it has: a half-known route is
 * information, and blanking it would discard what the document did say.
 */
export function toRouteText(
  trip: Pick<Trip, "route">,
  emptyMarker: string,
): string {
  const route = trip.route;

  if (!route) {
    return emptyMarker;
  }

  const from = route.from === "" ? emptyMarker : route.from;
  const to = route.to === "" ? emptyMarker : route.to;

  return `${from} ${ROUTE_SEPARATOR} ${to}`;
}
