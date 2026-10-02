import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { NO_LABELS, type TripExportLabels } from "@/lib/api/trip-export-labels";

/**
 * The export words the BACKEND composes for the live captures' Trips.
 *
 * Each `basis-live-*.json` capture has a `.labels.json` beside it, written by
 * the backend's own `trip-export-labels.spec.ts` from the very same capture and
 * checked by it on every run — so these are the words the running system
 * prints, never a second opinion composed in the browser's tests.
 *
 * Looked up by Trip id across every capture: the ids are UUIDs from the
 * running database, so no two captures share one.
 */
const LABELS: Record<string, TripExportLabels> = Object.assign(
  {},
  ...readdirSync(__dirname)
    .filter((file) => file.endsWith(".labels.json"))
    .map((file) => JSON.parse(readFileSync(join(__dirname, file), "utf8"))),
);

export function captureLabels(tripId: string): TripExportLabels {
  return LABELS[tripId] ?? NO_LABELS;
}
