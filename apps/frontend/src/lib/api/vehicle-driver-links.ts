import { request } from "./client";
import type { Paginated, VehicleAssignment } from "./types";

/** Every fleet of this business fits in one page. */
const ACTIVE_ASSIGNMENTS_PAGE_SIZE = 200;

/**
 * The assignments in effect TODAY, as the backend decides it.
 *
 * Not "the most recent row per vehicle": an assignment that ended yesterday or
 * starts next week is newer and still not in effect, and only the backend's
 * `activeOnly` filter applies the period rule.
 */
export function listActiveAssignments(
  signal?: AbortSignal,
): Promise<Paginated<VehicleAssignment>> {
  return request<Paginated<VehicleAssignment>>("/api/v1/vehicle-assignments", {
    query: { activeOnly: true, pageSize: ACTIVE_ASSIGNMENTS_PAGE_SIZE },
    signal,
  });
}

export type VehicleDriverLinkOutcome = "LINKED" | "ALREADY_LINKED";

export interface VehicleDriverLinkResult {
  outcome: VehicleDriverLinkOutcome;
  assignment: VehicleAssignment;
  /** The truck's other driver and the driver's other truck, now history. */
  endedAssignments: VehicleAssignment[];
}

/**
 * "This truck is now driven by this driver", from today.
 *
 * Only the two ids: ending whatever stands in the way, keeping it as history
 * and keeping every Trip's driver are the backend's, in one transaction.
 */
export function linkVehicleDriver(
  vehicleId: string,
  driverId: string,
  signal?: AbortSignal,
): Promise<VehicleDriverLinkResult> {
  return request<VehicleDriverLinkResult>("/api/v1/vehicle-assignments/links", {
    method: "POST",
    body: { vehicleId, driverId },
    signal,
  });
}
