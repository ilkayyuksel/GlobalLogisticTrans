import { request } from "./client";
import type { CustomProperty, Paginated } from "./types";

/**
 * The Custom Property endpoints.
 *
 * ── TWO KINDS OF PROPERTY, ONE TABLE ────────────────────────────────────────
 * A property is either FIXED-PRICE — it carries a `defaultPrice` the Pricing
 * Engine reads — or ROUTE-PRICED, meaning it links to a pricing component and
 * the amount comes from the route configuration. The backend enforces that a
 * linked property has no default price, so the UI must never offer one.
 *
 * `pricingComponentId` is the marker of that distinction, and it is the only
 * thing this side reads it for. It is never displayed: an identifier is not
 * information an operator can use, and there is no endpoint that would turn it
 * into a component name.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `defaultPrice` is a fixed-2 STRING, shown exactly as received. Nothing here
 * calculates a price — this is configuration, and what a property actually
 * contributed to a Trip lives in that Trip's pricing snapshot.
 */

const CUSTOM_PROPERTIES_PATH = "/api/v1/custom-properties";

export interface ListCustomPropertiesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
}

export function listCustomProperties(
  params: ListCustomPropertiesParams = {},
  signal?: AbortSignal,
): Promise<Paginated<CustomProperty>> {
  return request<Paginated<CustomProperty>>(CUSTOM_PROPERTIES_PATH, {
    query: {
      page: params.page,
      pageSize: params.pageSize,
      search: params.search,
      isActive: params.isActive,
    },
    signal,
  });
}

/**
 * Exactly what `CreateCustomPropertyDto` accepts, minus the two fields this
 * screen has no way to fill honestly.
 *
 * `pricingComponentId` is absent because there is no endpoint listing pricing
 * components — a picker would have nothing to show, and a typed identifier is
 * not something to ask of an operator. Existing route-priced properties keep
 * their link untouched.
 *
 * `displayOrder` and `color` are absent because this screen offers neither.
 */
export interface CustomPropertyPayload {
  name: string;
  description?: string | null;
  defaultPrice?: number | null;
}

export function createCustomProperty(
  payload: CustomPropertyPayload,
  signal?: AbortSignal,
): Promise<CustomProperty> {
  return request<CustomProperty>(CUSTOM_PROPERTIES_PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateCustomProperty(
  customPropertyId: string,
  payload: Partial<CustomPropertyPayload>,
  signal?: AbortSignal,
): Promise<CustomProperty> {
  return request<CustomProperty>(
    `${CUSTOM_PROPERTIES_PATH}/${customPropertyId}`,
    { method: "PATCH", body: payload, signal },
  );
}

/**
 * Activation and deactivation, as sub-resources.
 *
 * A deactivated property stays on the Trips that already carry it, and its
 * priced line stays in their snapshots. Deactivation only stops it being
 * assigned again.
 */
export function activateCustomProperty(
  customPropertyId: string,
  signal?: AbortSignal,
): Promise<CustomProperty> {
  return request<CustomProperty>(
    `${CUSTOM_PROPERTIES_PATH}/${customPropertyId}/activation`,
    { method: "PATCH", signal },
  );
}

export function deactivateCustomProperty(
  customPropertyId: string,
  signal?: AbortSignal,
): Promise<CustomProperty> {
  return request<CustomProperty>(
    `${CUSTOM_PROPERTIES_PATH}/${customPropertyId}/deactivation`,
    { method: "PATCH", signal },
  );
}

/** A property whose amount comes from the route configuration. */
export function isRoutePriced(property: CustomProperty): boolean {
  return property.pricingComponentId !== null;
}
