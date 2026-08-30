import { request } from "./client";

const PATH = "/api/v1/route-configuration";

/**
 * One route, as the operator configures it.
 *
 * ── ONE RECORD, THREE AMOUNTS ───────────────────────────────────────────────
 * The backend stores a route's price and each of its route-dependent costs in
 * separate tables. That split is invisible here, deliberately: an operator
 * configuring "Quay 869 to Dourges" means one route with three amounts, and the
 * composition is the backend's job. Nothing on this side assembles or splits a
 * route.
 *
 * Amounts are preformatted two-decimal STRINGS and are displayed exactly as
 * received. No arithmetic happens in the browser.
 */
export interface RouteConfiguration {
  id: string;
  departure: string;
  destination: string;
  tarief: string;
  toll: string;
  tunnel: string;
  /**
   * Whether a cost is actually configured, as opposed to absent.
   *
   * Both read "0.00" as a price, and the distinction matters to an operator: a
   * configured zero is a decision, an absent one is a gap the Pricing Engine
   * reports when a Trip carries the property.
   */
  hasToll: boolean;
  hasTunnel: boolean;
  isActive: boolean;
}

/** What a route is saved with. Amounts are numbers; the backend rounds. */
export interface RouteConfigurationPayload {
  departure: string;
  destination: string;
  tarief: number;
  toll: number;
  tunnel: number;
}

export function listRouteConfigurations(
  signal?: AbortSignal,
): Promise<RouteConfiguration[]> {
  return request<RouteConfiguration[]>(PATH, { signal });
}

export function createRouteConfiguration(
  payload: RouteConfigurationPayload,
  signal?: AbortSignal,
): Promise<RouteConfiguration> {
  return request<RouteConfiguration>(PATH, {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateRouteConfiguration(
  id: string,
  payload: RouteConfigurationPayload,
  signal?: AbortSignal,
): Promise<RouteConfiguration> {
  return request<RouteConfiguration>(`${PATH}/${id}`, {
    method: "PUT",
    body: payload,
    signal,
  });
}

/**
 * Switches a whole configuration on or off.
 *
 * The price and both costs move together — the backend guarantees it — so the
 * screen offers one switch rather than three.
 */
export function changeRouteConfigurationState(
  id: string,
  isActive: boolean,
  signal?: AbortSignal,
): Promise<RouteConfiguration> {
  return request<RouteConfiguration>(`${PATH}/${id}/state`, {
    method: "PATCH",
    body: { isActive },
    signal,
  });
}
