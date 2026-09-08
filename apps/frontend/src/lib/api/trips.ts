import { request } from "./client";
import type {
  ChangeableTripStatus,
  Paginated,
  Trip,
  TripDocument,
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
export type TripSortField = "licensePlate" | "startTime" | "endTime";
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
   * BETAALD (true) or NIET BETAALD (false).
   *
   * OMIT it for "Alle". `undefined` is the absence of a filter; `false` is the
   * question "which Trips are unpaid", and the two must never be conflated.
   */
  isPaid?: boolean;
  /**
   * Which time to order a day's Trips by. The backend keeps the planning date
   * as the first ordering key and groups a Vehicle's Trips together, so this
   * chooses the order INSIDE that grouping.
   */
  sortBy?: TripSortField;
  sortDirection?: TripSortDirection;
  /**
   * Exactly these Trips, whatever day they fall on.
   *
   * For a screen that already knows which Trips it means — a selection spanning
   * several days — and needs them all in one request rather than one each.
   */
  tripIds?: string[];
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
      isPaid: params.isPaid,
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
      tripGroupId: params.tripGroupId,
      tripIds: params.tripIds,
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
  /** The window the duration comes from; the backend derives the minutes. */
  waitingTimeStart?: string | null;
  waitingTimeEnd?: string | null;
  distanceKm?: number | null;
  /** Free text, optional, not unique. Whitespace-only is stored as null. */
  tarNummer?: string | null;
  internalNotes?: string | null;
  /** LOSRIT. Omitted means an ordinary Trip; the backend defaults it to false. */
  isLooseTrip?: boolean;
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
  /**
   * The waiting-time window. BOTH or NEITHER: an end with no beginning is an
   * incomplete entry rather than a duration of zero, and the backend refuses
   * it. Both null removes the waiting time entirely.
   *
   * `waitingTimeMinutes` is deliberately absent: the backend DERIVES it from
   * these two, so the money and the evidence for it cannot disagree. Sending it
   * is a 400.
   */
  waitingTimeStart?: string | null;
  waitingTimeEnd?: string | null;
  distanceKm?: number | null;
  executionDatetime?: string | null;
  /**
   * Free text, optional, not unique. Send null to clear; the backend turns a
   * whitespace-only value into null, so the browser does not have to.
   */
  tarNummer?: string | null;
  internalNotes?: string | null;
  /**
   * Accepted only on a Trip created by hand. On an imported Trip the document
   * is the authority for these and the backend refuses them with a 409 — see
   * `canEditDocumentFields`, which is why they are not offered there.
   *
   * The times are the TRANSPORT window, not the waiting time: that is entered
   * as two clock times and stored as `waitingTimeMinutes`, which this never
   * touches. There is no rule that the end must follow the start — a transport
   * running past midnight is ordinary, and a single-time order carries the same
   * value in both.
   */
  destinationCity?: string | null;
  destinationCountry?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  /** The operator's own classification; no document ever writes it. */
  isLooseTrip?: boolean;
}

/**
 * Marks several Trips as LOSRIT in one request.
 *
 * The classification the operator already applies when creating a Trip by hand,
 * applied to a selection. ONE request for the whole selection, like completion:
 * a request per row would be a dozen round trips and a dozen ways to end up
 * half-applied.
 *
 * The backend refuses the whole selection if any Trip belongs to a TripGroup or
 * is DELETED — a leg of a Combination is not a loose trip — and a Trip that is
 * already classified is left alone rather than refused.
 *
 * There is deliberately no "unmark" counterpart. Taking the classification off
 * is a single-Trip edit through PATCH, which is where a correction belongs.
 */
export function markTripsLoose(
  tripIds: readonly string[],
  signal?: AbortSignal,
): Promise<Trip[]> {
  return request<Trip[]>(`${TRIPS_PATH}/loose`, {
    method: "POST",
    body: { tripIds: [...tripIds] },
    signal,
  });
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
 * Marks a Trip BETAALD or NIET BETAALD.
 *
 * Its own endpoint, and deliberately not part of `updateTrip`: payment is a
 * decision of its own rather than a field edited among others.
 *
 * The backend answers with the WHOLE updated Trip, which is what lets the
 * Ritten row refresh from the response instead of refetching the list — the
 * operator keeps their filter, page, period, selection and scroll position.
 *
 * It never changes the Trip's status. That is the backend's guarantee, not an
 * assumption made here.
 */
export function changeTripPayment(
  tripId: string,
  isPaid: boolean,
  signal?: AbortSignal,
): Promise<Trip> {
  return request<Trip>(`${TRIPS_PATH}/${tripId}/payment`, {
    method: "PATCH",
    body: { isPaid },
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
/**
 * Every transport document that concerns this Trip, newest first.
 *
 * One request. The bytes are fetched through the existing PDF content endpoint
 * using the id each entry carries — there is no second content route, and no
 * storage path ever reaches this side.
 */
export async function listTripDocuments(
  tripId: string,
  signal?: AbortSignal,
): Promise<TripDocument[]> {
  const response = await request<{ items: TripDocument[] }>(
    `${TRIPS_PATH}/${tripId}/documents`,
    { signal },
  );

  return response.items;
}

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
/**
 * Marks several Trips CLOSED in one request.
 *
 * ONE request for the whole selection, not one per row: the backend applies the
 * same transition rule to each and refuses the lot if any Trip cannot be
 * closed, so a per-Trip loop here would turn one atomic decision into a partial
 * one that nobody asked for.
 */
export function completeTrips(
  tripIds: readonly string[],
  signal?: AbortSignal,
): Promise<Trip[]> {
  return request<Trip[]>("/api/v1/trips/completions", {
    method: "POST",
    body: { tripIds: [...tripIds] },
    signal,
  });
}

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
