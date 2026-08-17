import type { Trip } from "@/lib/api/types";

/**
 * A day's Trips, split into the trucks they run on.
 *
 * ── THIS IS PRESENTATION, NOT ORDERING ──────────────────────────────────────
 * The backend already returns the rows in order: planning date, then vehicle,
 * then the chosen time, then id. This only walks that order and marks where one
 * truck's block ends and the next begins, so the table can print a heading.
 *
 * It deliberately does NOT sort. Re-sorting here would order the page in view
 * and nothing else, which is exactly the misrepresentation the database sort
 * exists to avoid — and the two could disagree, leaving a heading over rows
 * that belong to a different truck.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Consecutive runs, not a map keyed by vehicle: a map would silently merge two
 * separated blocks and hide the fact that the order was not what it claimed.
 */
export interface VehicleGroup {
  /** Null for the Trips no truck is assigned to. */
  readonly licensePlate: string | null;
  readonly displayColor: string | null;
  readonly trips: readonly Trip[];
}

export function toVehicleGroups(trips: readonly Trip[]): VehicleGroup[] {
  const groups: VehicleGroup[] = [];

  for (const trip of trips) {
    const plate = trip.vehicle?.licensePlate ?? null;
    const previous = groups.at(-1);

    if (previous && previous.licensePlate === plate) {
      (previous.trips as Trip[]).push(trip);
      continue;
    }

    groups.push({
      licensePlate: plate,
      displayColor: trip.vehicle?.displayColor ?? null,
      trips: [trip],
    });
  }

  return groups;
}
