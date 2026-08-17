import { request } from "./client";
import type {
  CustomProperty,
  Driver,
  Paginated,
  TripCustomProperty,
  Vehicle,
} from "./types";

/**
 * The lookups a Trip detail page needs to turn ids into names.
 *
 * A Trip response already embeds its vehicle summary and its resolved effective
 * driver, so neither is fetched per Trip any more. What remains is the FULL
 * Vehicle record — brand, model, year — which the detail page shows and the
 * embedded summary deliberately omits, and the Trip's Custom Properties.
 *
 * There is no driver lookup here on purpose: `trip.effectiveDriver` is the
 * answer, resolved by the backend from the Trip's own planning date.
 */

export function getVehicle(
  vehicleId: string,
  signal?: AbortSignal,
): Promise<Vehicle> {
  return request<Vehicle>(`/api/v1/vehicles/${vehicleId}`, { signal });
}

/**
 * Enough vehicles and drivers to fill a picker.
 *
 * One request each, asked for once when the edit form opens — not per Trip and
 * not per keystroke. The fleet of a family business fits comfortably inside a
 * single page, so there is no paging control here; if a list ever exceeded this
 * the picker would need a search, and that would be visible rather than silent
 * because the backend reports the true total.
 */
const PICKER_PAGE_SIZE = 200;

/** Only active vehicles: the backend refuses to assign an inactive one. */
export async function listActiveVehicles(
  signal?: AbortSignal,
): Promise<Paginated<Vehicle>> {
  return request<Paginated<Vehicle>>("/api/v1/vehicles", {
    query: { isActive: true, pageSize: PICKER_PAGE_SIZE },
    signal,
  });
}

/** Only active drivers, for the same reason. */
export async function listActiveDrivers(
  signal?: AbortSignal,
): Promise<Paginated<Driver>> {
  return request<Paginated<Driver>>("/api/v1/drivers", {
    query: { isActive: true, pageSize: PICKER_PAGE_SIZE },
    signal,
  });
}

/**
 * The Custom Properties assigned to a Trip.
 *
 * Returned in the properties' configured display order, so the response order
 * is the display order.
 */
export async function listTripCustomProperties(
  tripId: string,
  signal?: AbortSignal,
): Promise<TripCustomProperty[]> {
  const response = await request<{ items: TripCustomProperty[] }>(
    `/api/v1/trip-custom-properties/trip/${tripId}`,
    { signal },
  );

  return response.items;
}

/**
 * The properties a Trip can be given.
 *
 * Only ACTIVE ones: the backend refuses to assign an inactive property, so
 * offering one would produce a guaranteed rejection. A property that was
 * already assigned before it was deactivated is a different matter — it stays
 * on the Trip and stays visible, marked, and only the assignment itself can be
 * removed.
 */
export async function listAssignableCustomProperties(
  signal?: AbortSignal,
): Promise<CustomProperty[]> {
  const response = await request<Paginated<CustomProperty>>(
    "/api/v1/custom-properties",
    { query: { isActive: true, pageSize: PICKER_PAGE_SIZE }, signal },
  );

  return response.items;
}

/**
 * Assigns one property to one Trip.
 *
 * One request per assignment, because that is what the API models: an
 * assignment is its own row with its own id, and there is no bulk endpoint. For
 * the handful of properties a Trip carries that is the right trade — a bulk
 * endpoint would be a backend change made for a problem nobody has yet.
 */
export function assignCustomProperty(
  tripId: string,
  customPropertyId: string,
  signal?: AbortSignal,
): Promise<TripCustomProperty> {
  return request<TripCustomProperty>("/api/v1/trip-custom-properties", {
    method: "POST",
    body: { tripId, customPropertyId },
    signal,
  });
}

/** Removes one assignment by ITS id — not by the property's id. */
export function removeCustomPropertyAssignment(
  assignmentId: string,
  signal?: AbortSignal,
): Promise<TripCustomProperty> {
  return request<TripCustomProperty>(
    `/api/v1/trip-custom-properties/${assignmentId}`,
    { method: "DELETE", signal },
  );
}
