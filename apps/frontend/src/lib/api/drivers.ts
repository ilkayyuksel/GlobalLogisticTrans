import { request } from "./client";
import type { Driver, Paginated } from "./types";

/**
 * The Driver endpoints.
 *
 * Exactly what the backend offers, and nothing beyond it. There is NO delete:
 * a Driver is deactivated, never removed, because historical Trips and vehicle
 * assignments still name them. `DELETE /drivers/:id` does not exist and must
 * never be called.
 *
 * The payload types mirror `CreateDriverDto` and `UpdateDriverDto` field for
 * field. The backend validates with `forbidNonWhitelisted`, so an invented
 * field is a 400 rather than a silently ignored one.
 *
 * Searching and filtering belong to `GET /drivers`, which accepts both.
 * Narrowing a loaded page in the browser would look like a working filter while
 * ignoring every driver past it.
 */

const DRIVERS_PATH = "/api/v1/drivers";

export interface ListDriversParams {
  page?: number;
  pageSize?: number;
  /** Case-insensitive partial match on the driver's name. */
  search?: string;
  isActive?: boolean;
}

export function listDrivers(
  params: ListDriversParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Driver>> {
  return request<Paginated<Driver>>(DRIVERS_PATH, {
    query: {
      page: params.page,
      pageSize: params.pageSize,
      search: params.search,
      isActive: params.isActive,
    },
    signal,
  });
}

/** Exactly `CreateDriverDto`: the name is required, everything else optional. */
export interface CreateDriverPayload {
  name: string;
  licenceNumber?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  emergencyContact?: string | null;
  notes?: string | null;
}

export function createDriver(
  payload: CreateDriverPayload,
  signal?: AbortSignal,
): Promise<Driver> {
  return request<Driver>(DRIVERS_PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

/**
 * Exactly `UpdateDriverDto`.
 *
 * `isActive` is absent on purpose: activation is its own operation with its own
 * rules — a licence number may only belong to one ACTIVE driver — and the
 * update endpoint refuses the field.
 */
export type UpdateDriverPayload = Partial<CreateDriverPayload>;

export function updateDriver(
  driverId: string,
  payload: UpdateDriverPayload,
  signal?: AbortSignal,
): Promise<Driver> {
  return request<Driver>(`${DRIVERS_PATH}/${driverId}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/**
 * Activation and deactivation, as sub-resources.
 *
 * Deactivation is the closest thing to a delete this domain has, and it is
 * deliberately reversible: an inactive Driver keeps every Trip they ever drove.
 * Activating can fail — their licence number may since have been given to
 * somebody else — and that refusal is the backend's to make.
 */
export function activateDriver(
  driverId: string,
  signal?: AbortSignal,
): Promise<Driver> {
  return request<Driver>(`${DRIVERS_PATH}/${driverId}/activation`, {
    method: "PATCH",
    signal,
  });
}

export function deactivateDriver(
  driverId: string,
  signal?: AbortSignal,
): Promise<Driver> {
  return request<Driver>(`${DRIVERS_PATH}/${driverId}/deactivation`, {
    method: "PATCH",
    signal,
  });
}
