import type {
  CombinationRouteConfiguration,
  RouteConfiguration,
} from "@/lib/api/route-configuration";

/**
 * The route price configuration, as a file you can hand back to the importer.
 *
 * ── THE SAME DOCUMENT THE BULK IMPORT READS ─────────────────────────────────
 * Field for field, name for name. Export a configuration, paste the file into
 * Bulk toevoegen, and the same routes come back — which is what makes this a
 * backup rather than a report. The names are the API's own (`departure`,
 * `destination`, `tarief`, `toll`, `tunnel`), because a second vocabulary
 * would be a second thing to keep in step.
 *
 * ── CONFIGURATION ONLY ──────────────────────────────────────────────────────
 * What a route COSTS, and nothing else. No identifiers, no timestamps, no Trips,
 * no pricing snapshots, no history: none of it is needed to recreate a route, and
 * a backup carrying database ids would be a backup that only fits the database it
 * came from.
 *
 * ── TOLL IS AN AMOUNT, AND THERE IS NO DISTANCE ─────────────────────────────
 * A route carries its Toll as an amount, like its Tunnel, and the file says so.
 * The importer refuses an older file that still names a distance.
 *
 * Over ST is not part of this document: the importer creates Combinations
 * from their legs, and Over ST is filled in on the screen.
 */

/** One road, priced. The shape of both an ordinary route and a leg. */
export interface ExportedRoute {
  readonly departure: string;
  readonly destination: string;
  readonly tarief: number;
  readonly toll: number;
  readonly tunnel: number;
}

export interface ExportedNormalRoute extends ExportedRoute {
  readonly type: "NORMAL";
}

export interface ExportedCombinationRoute {
  readonly type: "COMBINATION";
  /** Exactly two, the outbound first. */
  readonly legs: readonly ExportedRoute[];
}

export interface RouteConfigurationDocument {
  readonly routes: readonly (ExportedNormalRoute | ExportedCombinationRoute)[];
}

/**
 * The whole configuration, in a fixed order.
 *
 * ── WHY THE ORDER IS STATED ─────────────────────────────────────────────────
 * Ordinary routes first, then Combinations; each sorted by departure and then
 * destination; a Combination's legs in the order they were configured. So two
 * exports of one configuration are the same file, and a diff between two days
 * shows what changed rather than what moved.
 *
 * `localeCompare` because these are place names a person reads, and because it is
 * the same comparison the rest of this application sorts text with.
 */
export function toRouteConfigurationDocument(
  routes: readonly RouteConfiguration[],
  combinations: readonly CombinationRouteConfiguration[],
): RouteConfigurationDocument {
  const normal = [...routes]
    .sort(byRoad)
    .map((route) => ({ type: "NORMAL" as const, ...toExportedRoute(route) }));

  const combined = [...combinations]
    .sort((left, right) => byRoad(left.legs[0], right.legs[0]))
    .map((combination) => ({
      type: "COMBINATION" as const,
      legs: combination.legs.map(toExportedRoute),
    }));

  return { routes: [...normal, ...combined] };
}

/**
 * One configured route, stripped to what recreating it needs.
 *
 * Amounts become NUMBERS. The API carries money as exact decimal text so no
 * rounding can happen in transit; the import DTO takes numbers, as every amount
 * in this API does on the way in, so `"100.00"` goes back out as `100`.
 */
function toExportedRoute(route: RouteConfiguration): ExportedRoute {
  return {
    departure: route.departure,
    destination: route.destination,
    tarief: Number(route.tarief),
    toll: Number(route.toll),
    tunnel: Number(route.tunnel),
  };
}

function byRoad(
  left: { departure: string; destination: string },
  right: { departure: string; destination: string },
): number {
  return (
    left.departure.localeCompare(right.departure) ||
    left.destination.localeCompare(right.destination)
  );
}

/**
 * `route-pricing-2026-09-27.json`, for the day it was exported.
 *
 * The date comes from the caller rather than from a clock reached into here, so
 * the name is decided by the same code that can be tested.
 */
export function routeConfigurationFileName(today: Date): string {
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `route-pricing-${year}-${month}-${day}.json`;
}

/** Two spaces, because a configuration backup is meant to be read and edited. */
const INDENT = 2;

/**
 * The document as the text of a file.
 *
 * Separate from the Blob below because THIS is the artefact — what a person
 * opens, what the importer reads, and what a test can read back. The Blob is only
 * how a browser is handed it.
 */
export function toRouteConfigurationJson(
  document: RouteConfigurationDocument,
): string {
  return `${JSON.stringify(document, null, INDENT)}\n`;
}

/** The same text, as a file the browser can download: JSON, UTF-8. */
export function toRouteConfigurationBlob(
  document: RouteConfigurationDocument,
): Blob {
  return new Blob([toRouteConfigurationJson(document)], {
    type: "application/json;charset=utf-8",
  });
}
