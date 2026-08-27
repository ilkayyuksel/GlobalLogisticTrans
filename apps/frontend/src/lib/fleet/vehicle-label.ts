import type { Vehicle } from "@/lib/api/types";

/**
 * A vehicle, named as an operator picks it: `1-ABC-123 (Jan Janssens)`.
 *
 * ── WHY THE DRIVER IS PART OF THE LABEL ─────────────────────────────────────
 * Choosing a truck in the Ritten list is really choosing a truck AND the person
 * on it that day. A dropdown of bare plates asks an operator to remember which
 * is which, and the fleet list two clicks away already answers it — so the
 * answer travels with the option.
 *
 * ── ONE RULE, THREE SCREENS ─────────────────────────────────────────────────
 * The name comes from `vehicle.currentDriver`, which the backend resolves from
 * VehicleAssignment. That is the SAME field the Voertuigen list renders in its
 * Chauffeur column, so the picker and the fleet page cannot disagree about who
 * is driving a truck — there is no second rule here to drift.
 *
 * ── AND NO EMPTY PARENTHESES ────────────────────────────────────────────────
 * A truck with nobody assigned is written as the plate alone. `1-DEF-789 ()`
 * would read as a missing name rather than as an unassigned truck.
 */
export function toVehicleLabel(vehicle: Pick<Vehicle, "licensePlate" | "currentDriver">): string {
  const driverName = vehicle.currentDriver?.name.trim();

  return driverName
    ? `${vehicle.licensePlate} (${driverName})`
    : vehicle.licensePlate;
}
