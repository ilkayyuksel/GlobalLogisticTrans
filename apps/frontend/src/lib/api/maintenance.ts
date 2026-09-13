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
 * How pressing a record is — TE LAAT, VANDAAG, GEPLAND — is the backend's
 * answer, carried on every record as `urgency` and decided from the status and
 * the maintenance date alone. This module never re-derives it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Completing a record does not create a new one: the backend plans the SAME
 * record again and keeps the finished cycle in its `completions`.
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

export type MaintenanceUrgencyLevel = "OVERDUE" | "TODAY" | "UPCOMING";

/** Decided by the backend; null for every status but PLANNED. */
export interface MaintenanceUrgency {
  level: MaintenanceUrgencyLevel;
  /** Calendar days past the planned date. Zero unless OVERDUE. */
  daysOverdue: number;
}

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
  urgency: MaintenanceUrgency | null;
  createdAt: string;
  updatedAt: string;
}

/** One carried-out cycle of a record, as it was when it was completed. */
export interface MaintenanceCompletion {
  id: string;
  /** The date the record was planned for when the work was done. */
  plannedDate: string;
  completedOn: string;
  /** The date the record was planned again for. */
  nextMaintenanceDate: string;
  notes: string | null;
  maintenanceType: string | null;
  description: string;
  createdAt: string;
}

/** One record with its full history, oldest cycle first. */
export interface MaintenanceDetail extends Maintenance {
  completions: MaintenanceCompletion[];
}

/** The Dashboard's list: at most five, most pressing first, ordered by the backend. */
export interface MaintenanceAttention {
  today: string;
  items: Maintenance[];
}

/** Exactly `CompleteMaintenanceDto`. */
export interface CompleteMaintenancePayload {
  /**
   * The planned date of the cycle being completed, as shown. The backend
   * refuses a date the record no longer has (409), so a double submit cannot
   * record one cycle twice.
   */
  plannedDate: string;
  /** Defaults to today on the backend; never in the future. */
  completedOn?: string;
  nextMaintenanceDate: string;
  notes?: string | null;
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

export function getMaintenance(
  maintenanceId: string,
  signal?: AbortSignal,
): Promise<MaintenanceDetail> {
  return request<MaintenanceDetail>(`${MAINTENANCE_PATH}/${maintenanceId}`, {
    signal,
  });
}

/**
 * Completes the current cycle. The backend plans the same record again on the
 * next date and answers with it and its whole history.
 */
export function completeMaintenance(
  maintenanceId: string,
  payload: CompleteMaintenancePayload,
  signal?: AbortSignal,
): Promise<MaintenanceDetail> {
  return request<MaintenanceDetail>(
    `${MAINTENANCE_PATH}/${maintenanceId}/completions`,
    { method: "POST", body: payload, signal },
  );
}

/** Selected, ordered and limited by the backend — never re-sorted here. */
export function getMaintenanceAttention(
  signal?: AbortSignal,
): Promise<MaintenanceAttention> {
  return request<MaintenanceAttention>(`${MAINTENANCE_PATH}/attention`, {
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
