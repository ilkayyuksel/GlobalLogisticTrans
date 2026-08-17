import { request } from "./client";
import type { Driver, Paginated, Vehicle, VehicleAssignment } from "./types";

/**
 * The Vehicle endpoints.
 *
 * Exactly what the backend offers, and nothing beyond it. In particular there
 * is NO delete: a Vehicle is deactivated, never removed, because historical
 * Trips and maintenance records still refer to it. `DELETE /vehicles/:id` does
 * not exist and must never be called.
 *
 * The payload types mirror `CreateVehicleDto` and `UpdateVehicleDto` field for
 * field. The backend validates with `forbidNonWhitelisted`, so an invented
 * field is a 400 rather than a silently ignored one.
 */

const VEHICLES_PATH = "/api/v1/vehicles";

export interface ListVehiclesParams {
  page?: number;
  pageSize?: number;
  /** Partial match on plate, description, brand and model. */
  search?: string;
  isActive?: boolean;
}

export function listVehicles(
  params: ListVehiclesParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Vehicle>> {
  return request<Paginated<Vehicle>>(VEHICLES_PATH, {
    query: {
      page: params.page,
      pageSize: params.pageSize,
      search: params.search,
      isActive: params.isActive,
    },
    signal,
  });
}

export function getVehicleById(
  vehicleId: string,
  signal?: AbortSignal,
): Promise<Vehicle> {
  return request<Vehicle>(`${VEHICLES_PATH}/${vehicleId}`, { signal });
}

/** Exactly `CreateVehicleDto`: plate and colour required, the rest optional. */
export interface CreateVehiclePayload {
  licensePlate: string;
  displayColor: string;
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  notes?: string | null;
}

export function createVehicle(
  payload: CreateVehiclePayload,
  signal?: AbortSignal,
): Promise<Vehicle> {
  return request<Vehicle>(VEHICLES_PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

/**
 * Exactly `UpdateVehicleDto`.
 *
 * `isActive` is absent on purpose: activation is its own operation with its own
 * rules, and the backend rejects the field here.
 */
export type UpdateVehiclePayload = Partial<CreateVehiclePayload>;

export function updateVehicle(
  vehicleId: string,
  payload: UpdateVehiclePayload,
  signal?: AbortSignal,
): Promise<Vehicle> {
  return request<Vehicle>(`${VEHICLES_PATH}/${vehicleId}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/**
 * Activation and deactivation, as sub-resources.
 *
 * Deactivation is the closest thing to a delete this domain has, and it is
 * deliberately reversible: an inactive Vehicle keeps every Trip and every
 * assignment it ever had.
 */
export function activateVehicle(
  vehicleId: string,
  signal?: AbortSignal,
): Promise<Vehicle> {
  return request<Vehicle>(`${VEHICLES_PATH}/${vehicleId}/activation`, {
    method: "PATCH",
    signal,
  });
}

export function deactivateVehicle(
  vehicleId: string,
  signal?: AbortSignal,
): Promise<Vehicle> {
  return request<Vehicle>(`${VEHICLES_PATH}/${vehicleId}/deactivation`, {
    method: "PATCH",
    signal,
  });
}

/**
 * Who currently drives this Vehicle, if anyone.
 *
 * One request, and only on the detail page. The backend resolves which
 * assignment is in effect — the same rule that produces a Trip's effective
 * driver — so nothing here compares dates.
 */
export async function getCurrentAssignment(
  vehicleId: string,
  signal?: AbortSignal,
): Promise<VehicleAssignment | null> {
  return request<VehicleAssignment | null>(
    `/api/v1/vehicle-assignments/current/vehicle/${vehicleId}`,
    { signal },
  );
}

/**
 * Puts a Driver on a Vehicle from a date.
 *
 * Exactly `CreateVehicleAssignmentDto`. An open-ended assignment (no validTo)
 * automatically closes the previous open-ended one for the same vehicle or
 * driver — a backend rule, stated here only so a reader knows it is not this
 * side's doing.
 */
export interface CreateAssignmentPayload {
  vehicleId: string;
  driverId: string;
  validFrom: string;
  validTo?: string | null;
  notes?: string | null;
}

export function createAssignment(
  payload: CreateAssignmentPayload,
  signal?: AbortSignal,
): Promise<VehicleAssignment> {
  return request<VehicleAssignment>("/api/v1/vehicle-assignments", {
    method: "POST",
    body: payload,
    signal,
  });
}

/**
 * Exactly `UpdateVehicleAssignmentDto`: only the end date and the notes.
 *
 * The vehicle, the driver and the start date are absent because the backend
 * refuses them — changing who drove what, from when, would rewrite history
 * rather than record a decision.
 */
export interface UpdateAssignmentPayload {
  validTo?: string | null;
  notes?: string | null;
}

export function updateAssignment(
  assignmentId: string,
  payload: UpdateAssignmentPayload,
  signal?: AbortSignal,
): Promise<VehicleAssignment> {
  return request<VehicleAssignment>(
    `/api/v1/vehicle-assignments/${assignmentId}`,
    { method: "PATCH", body: payload, signal },
  );
}

/** Ends an assignment today, through its own sub-resource. */
export function closeAssignment(
  assignmentId: string,
  signal?: AbortSignal,
): Promise<VehicleAssignment> {
  return request<VehicleAssignment>(
    `/api/v1/vehicle-assignments/${assignmentId}/closure`,
    { method: "PATCH", signal },
  );
}

export function getDriverById(
  driverId: string,
  signal?: AbortSignal,
): Promise<Driver> {
  return request<Driver>(`/api/v1/drivers/${driverId}`, { signal });
}
