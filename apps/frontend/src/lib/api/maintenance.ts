import { request } from "./client";
import type { Paginated } from "./types";

/**
 * The Maintenance endpoints.
 *
 * ── WHAT THIS SYSTEM DOES NOT KNOW ──────────────────────────────────────────
 * A vehicle's CURRENT mileage. `mileage` is the odometer reading the
 * Administrator typed for one job, and `nextMaintenanceMileage` is what they
 * plan for the next. Nothing here may compare them to decide that a service is
 * due — that question needs a current reading, and there is none.
 *
 * "Due" therefore means one thing: a planned next DATE has arrived. The backend
 * decides it (`dueOnly`, `isDueByDate`), and this module never re-derives it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `cost` and `totalCost` are fixed-2 STRINGS, displayed exactly as received.
 * Nothing on this side adds them; the total comes from the summary endpoint,
 * which sums in the database.
 */

const MAINTENANCE_PATH = "/api/v1/maintenance";

export type MaintenanceStatus =
  | "PLANNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export interface MaintenanceVehicleSummary {
  id: string;
  licensePlate: string;
  displayColor: string;
  isActive: boolean;
}

export interface Maintenance {
  id: string;
  vehicleId: string | null;
  vehicle: MaintenanceVehicleSummary | null;
  status: MaintenanceStatus;
  maintenanceType: string | null;
  /** `YYYY-MM-DD`. */
  maintenanceDate: string;
  description: string;
  /** Odometer reading when this work was done. NOT the current mileage. */
  mileage: number | null;
  /** Two decimals, as a string. */
  cost: string | null;
  workshop: string | null;
  nextMaintenanceDate: string | null;
  nextMaintenanceMileage: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceSummary {
  vehicleId: string;
  maintenanceCount: number;
  /** Summed by the database, as a fixed-2 string. */
  totalCost: string;
  latestMaintenance: Maintenance | null;
  /** The latest RECORDED reading, not the vehicle's current mileage. */
  latestMileage: number | null;
  nextMaintenanceDate: string | null;
  nextMaintenanceMileage: number | null;
  /** Date only — a mileage-based due date is not evaluable. */
  isDueByDate: boolean;
}

export interface ListMaintenanceParams {
  page?: number;
  pageSize?: number;
  vehicleId?: string;
  status?: MaintenanceStatus;
  maintenanceDateFrom?: string;
  maintenanceDateTo?: string;
  search?: string;
  /** Planned next date reached, and not cancelled. Decided by the backend. */
  dueOnly?: boolean;
}

export function listMaintenance(
  params: ListMaintenanceParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Maintenance>> {
  return request<Paginated<Maintenance>>(MAINTENANCE_PATH, {
    query: {
      page: params.page,
      pageSize: params.pageSize,
      vehicleId: params.vehicleId,
      status: params.status,
      maintenanceDateFrom: params.maintenanceDateFrom,
      maintenanceDateTo: params.maintenanceDateTo,
      search: params.search,
      dueOnly: params.dueOnly,
    },
    signal,
  });
}

/** Exactly `CreateMaintenanceDto`. */
export interface CreateMaintenancePayload {
  vehicleId: string;
  status: MaintenanceStatus;
  maintenanceType?: string | null;
  maintenanceDate: string;
  description: string;
  mileage?: number | null;
  cost?: number | null;
  workshop?: string | null;
  nextMaintenanceDate?: string | null;
  nextMaintenanceMileage?: number | null;
  notes?: string | null;
}

/**
 * Exactly `UpdateMaintenanceDto`.
 *
 * `vehicleId` is absent: a maintenance record is never reassigned to another
 * asset, and the backend rejects the field.
 */
export type UpdateMaintenancePayload = Partial<
  Omit<CreateMaintenancePayload, "vehicleId">
>;

export function createMaintenance(
  payload: CreateMaintenancePayload,
  signal?: AbortSignal,
): Promise<Maintenance> {
  return request<Maintenance>(MAINTENANCE_PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateMaintenance(
  maintenanceId: string,
  payload: UpdateMaintenancePayload,
  signal?: AbortSignal,
): Promise<Maintenance> {
  return request<Maintenance>(`${MAINTENANCE_PATH}/${maintenanceId}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/**
 * One Vehicle's totals, computed by the database.
 *
 * There is deliberately no client-side alternative: summing NUMERIC(12,2)
 * amounts in JavaScript would put binary rounding into a figure read as money,
 * and would only ever cover the page the browser had loaded.
 */
export function getMaintenanceSummary(
  vehicleId: string,
  signal?: AbortSignal,
): Promise<MaintenanceSummary> {
  return request<MaintenanceSummary>(
    `${MAINTENANCE_PATH}/summary/vehicle/${vehicleId}`,
    { signal },
  );
}
