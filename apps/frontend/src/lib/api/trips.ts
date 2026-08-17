import { request } from "./client";
import type {
  ChangeableTripStatus,
  Paginated,
  Trip,
  TripGroup,
  TripStatus,
} from "./types";

/**
 * The Trip endpoints.
 *
 * Thin by design: each function names one backend route and returns what it
 * returns. No filtering, sorting or derivation happens here — the backend owns
 * every rule, and a second implementation on this side would eventually
 * disagree with it.
 */

const TRIPS_PATH = "/api/v1/trips";

/** The times a planning list can be ordered by, as the backend accepts them. */
export type TripSortField = "startTime" | "endTime";
export type TripSortDirection = "asc" | "desc";

export interface ListTripsParams {
  page?: number;
  pageSize?: number;
  status?: TripStatus;
  search?: string;
  /** Exactly this day. Overrides the range filters, as the backend documents. */
  planningDate?: string;
  planningDateFrom?: string;
  planningDateTo?: string;
  /** The assigned Vehicle, by id — the backend does not filter on the plate. */
  vehicleId?: string;
  /** Exact terminal, as printed on the transport order. */
  terminal?: string;
  /** Trips carrying this Custom Property, by the property's own id. */
  customPropertyId?: string;
  /**
   * Which time to order a day's Trips by. The backend keeps the planning date
   * as the first ordering key and groups a Vehicle's Trips together, so this
   * chooses the order INSIDE that grouping.
   */
  sortBy?: TripSortField;
  sortDirection?: TripSortDirection;
  /** Every leg of one Combination. */
  tripGroupId?: string;
}

/**
 * The largest page the backend accepts.
 *
 * The planning board loads a whole day at once, so it asks for the maximum
 * rather than paging: a day of work is a single view, and paging it would hide
 * part of the plan behind a control nobody expects on a board.
 */
export const MAX_PAGE_SIZE = 200;

/**
 * One page of Trips.
 *
 * DELETED Trips are hidden by the backend unless `status=DELETED` is asked for
 * explicitly, so no exclusion is needed here.
 */
export function listTrips(
  params: ListTripsParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Trip>> {
  return request<Paginated<Trip>>(TRIPS_PATH, {
    query: {
      page: params.page,
      pageSize: params.pageSize,
      status: params.status,
      search: params.search,
      planningDate: params.planningDate,
      planningDateFrom: params.planningDateFrom,
      planningDateTo: params.planningDateTo,
      vehicleId: params.vehicleId,
      terminal: params.terminal,
      customPropertyId: params.customPropertyId,
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
      tripGroupId: params.tripGroupId,
    },
    signal,
  });
}

/**
 * Every terminal that currently appears on a Trip.
 *
 * The list is derived from the Trips themselves — the terminal string a PDF
 * carried IS the terminal, and there is no terminal master data anywhere in
 * this system. So the filter can only offer what has actually been seen.
 */
export function listTripTerminals(signal?: AbortSignal): Promise<string[]> {
  return request<string[]>(`${TRIPS_PATH}/terminals`, { signal });
}

export function getTrip(tripId: string, signal?: AbortSignal): Promise<Trip> {
  return request<Trip>(`${TRIPS_PATH}/${tripId}`, { signal });
}

/**
 * The fields a Trip may be created with by hand.
 *
 * ── EVERYTHING IS OPTIONAL, AND THAT IS THE POINT ───────────────────────────
 * A Trip entered by hand records a job that was announced before its paperwork
 * arrived. It may have no booking number, no container, no destination and no
 * date — and no PDF, because nothing was imported.
 *
 * Omitting a field means "not known", which the backend stores as null. There
 * is no placeholder to send and none to invent: a string like "MANUAL-1" would
 * become a value the whole business then has to recognise and strip.
 *
 * `driverId` is absent on purpose. A Trip's driver follows from its vehicle's
 * assignment, and offering a second way to set one is exactly what this product
 * removed.
 * ────────────────────────────────────────────────────────────────────────────
 */
export interface CreateTripPayload {
  bookingNumber?: string | null;
  planningDate?: string | null;
  vehicleId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  containerNumber?: string | null;
  containerType?: string | null;
  terminal?: string | null;
  destinationCity?: string | null;
  destinationCountry?: string | null;
  waitingTimeMinutes?: number | null;
  distanceKm?: number | null;
  internalNotes?: string | null;
}

export function createTrip(
  payload: CreateTripPayload,
  signal?: AbortSignal,
): Promise<Trip> {
  return request<Trip>(TRIPS_PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

/**
 * The Trip fields the backend accepts as manual edits.
 *
 * Exactly `UpdateTripDto`, no more: the backend runs its validation with
 * `forbidNonWhitelisted`, so sending an immutable field — a booking number, a
 * status, a parser-controlled value — is rejected as a 400 rather than ignored.
 *
 * Every field is nullable where the backend documents null as "clear this
 * value", and a field left undefined is simply not part of the update.
 */
export interface UpdateTripPayload {
  containerNumber?: string | null;
  planningDate?: string;
  vehicleId?: string | null;
  driverId?: string | null;
  waitingTimeMinutes?: number | null;
  distanceKm?: number | null;
  executionDatetime?: string | null;
  internalNotes?: string | null;
}

export function updateTrip(
  tripId: string,
  payload: UpdateTripPayload,
  signal?: AbortSignal,
): Promise<Trip> {
  return request<Trip>(`${TRIPS_PATH}/${tripId}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/**
 * Moves a Trip to another status.
 *
 * The backend owns the state machine and rejects a move it does not allow. The
 * UI offers only the transitions it believes are valid, but the backend's
 * refusal is what decides — this never assumes success.
 */
export function changeTripStatus(
  tripId: string,
  status: ChangeableTripStatus,
  signal?: AbortSignal,
): Promise<Trip> {
  return request<Trip>(`${TRIPS_PATH}/${tripId}/status`, {
    method: "PATCH",
    body: { status },
    signal,
  });
}

/**
 * Soft delete. The row is kept; only the status changes.
 *
 * A sub-resource rather than `DELETE /trips/:id`, which deliberately does not
 * exist: a Trip is never physically removed, and an HTTP DELETE would imply
 * that it is.
 */
export function deleteTrip(
  tripId: string,
  signal?: AbortSignal,
): Promise<Trip> {
  return request<Trip>(`${TRIPS_PATH}/${tripId}/deletion`, {
    method: "PATCH",
    signal,
  });
}

/**
 * Puts several Trips into one new group.
 *
 * A MANUAL group, which is not a Combination: the backend applies no rule about
 * directions, dates or statuses, only that there are at least two distinct
 * Trips and that none of them is already grouped. It answers with the group and
 * its Trips, or refuses the whole request — there is no partial grouping.
 */
export function createTripGroup(
  tripIds: readonly string[],
  signal?: AbortSignal,
): Promise<TripGroup> {
  return request<TripGroup>("/api/v1/trip-groups", {
    method: "POST",
    body: { tripIds: [...tripIds] },
    signal,
  });
}

/**
 * Takes one Trip out of its group.
 *
 * The body may only say null: reassignment is deliberately not possible here,
 * because moving a Trip between groups would change what the group it left
 * means. The group survives even when one Trip remains in it.
 */
export function removeTripFromGroup(
  tripId: string,
  signal?: AbortSignal,
): Promise<Trip> {
  return request<Trip>(`${TRIPS_PATH}/${tripId}/group`, {
    method: "PATCH",
    body: { tripGroupId: null },
    signal,
  });
}

/** Returns a DELETED Trip to OPEN. */
export function restoreTrip(
  tripId: string,
  signal?: AbortSignal,
): Promise<Trip> {
  return request<Trip>(`${TRIPS_PATH}/${tripId}/restoration`, {
    method: "PATCH",
    signal,
  });
}
