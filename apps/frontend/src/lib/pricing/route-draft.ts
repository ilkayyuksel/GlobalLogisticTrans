import type {
  CombinationOverSt,
  CombinationOverStPayload,
  RouteConfiguration,
  RouteConfigurationPayload,
} from "@/lib/api/route-configuration";

/**
 * A route being typed — an ordinary one, or one leg of a Combination.
 *
 * ── WHY IT IS THE SAME SHAPE FOR BOTH ───────────────────────────────────────
 * A Combination leg IS a route: it has a Van, a Naar, a Tarief, a Toll and a
 * Tunnel of its own, which is exactly why the two legs can cost different
 * amounts. What differs is how the record is saved — a leg only ever together
 * with its partner — and that difference belongs to the form, not to the draft.
 *
 * Every field is a STRING because it is what an operator typed. Converting to a
 * number happens once, at the edge, in `toRoutePayload`.
 */
export interface RouteDraft {
  /** The record being edited, or null while it is being added. */
  readonly id: string | null;
  departure: string;
  destination: string;
  tarief: string;
  toll: string;
  tunnel: string;
}

export const BLANK_ROUTE_DRAFT: RouteDraft = {
  id: null,
  departure: "",
  destination: "",
  tarief: "",
  toll: "",
  tunnel: "",
};

/**
 * What goes to the backend.
 *
 * Sent as typed: the backend validates the range and the decimals, and a check
 * repeated here would be the same rule kept in two places.
 */
export function toRoutePayload(draft: RouteDraft): RouteConfigurationPayload {
  return {
    departure: draft.departure.trim(),
    destination: draft.destination.trim(),
    tarief: Number(draft.tarief),
    toll: Number(draft.toll),
    tunnel: Number(draft.tunnel),
  };
}

/** The five fields of a route that can be edited in place. */
export type RouteField = "departure" | "destination" | "tarief" | "toll" | "tunnel";

/**
 * A stored route as a payload, with ONE field replaced.
 *
 * ── WHY THE WHOLE ROUTE GOES BACK ───────────────────────────────────────────
 * The update endpoint takes a complete configuration — it is the same call the
 * add form makes — so an inline edit of one value sends the other four exactly
 * as they are. Read from the route on screen, so nothing else can move: the one
 * field an operator changed is the one field that differs.
 */
export function toUpdatedRoutePayload(
  route: RouteConfiguration,
  field: RouteField,
  value: string,
): RouteConfigurationPayload {
  return { ...toRouteValues(route), [field]: toFieldValue(field, value) };
}

/** A route as the payload states it, before anything is changed. */
export function toRouteValues(
  route: RouteConfiguration,
): RouteConfigurationPayload {
  return {
    departure: route.departure,
    destination: route.destination,
    tarief: Number(route.tarief),
    toll: Number(route.toll),
    tunnel: Number(route.tunnel),
  };
}

/**
 * What one typed value means for its field.
 *
 * An empty amount is not turned into zero — `Number("")` would make it one
 * silently — so it goes out as it is and the backend refuses it in its own
 * words. No rule is invented here.
 */
function toFieldValue(field: RouteField, value: string): string | number {
  if (field === "departure" || field === "destination") {
    return value.trim();
  }

  return value.trim() === "" ? value : Number(value);
}

/**
 * ── OVER ST ──────────────────────────────────────────────────────────────────
 * The three amounts a Combination carries beside its legs. Edited in place like
 * a leg's amounts; the whole Over ST goes back with one value replaced.
 */
export type OverStField = "tarief" | "toll" | "tunnel";

export interface OverStDraft {
  tarief: string;
  toll: string;
  tunnel: string;
}

export const BLANK_OVER_ST_DRAFT: OverStDraft = { tarief: "", toll: "", tunnel: "" };

/** An empty Over ST box means "not stated", which the backend stores as null. */
function toOverStAmount(value: string | null): number | null {
  return value === null || value.trim() === "" ? null : Number(value);
}

export function toOverStPayload(draft: OverStDraft): CombinationOverStPayload {
  return {
    tarief: toOverStAmount(draft.tarief),
    toll: toOverStAmount(draft.toll),
    tunnel: toOverStAmount(draft.tunnel),
  };
}

/** The stored Over ST as a payload, with ONE field replaced. */
export function toUpdatedOverStPayload(
  overSt: CombinationOverSt,
  field: OverStField,
  value: string,
): CombinationOverStPayload {
  return {
    tarief: toOverStAmount(overSt.tarief),
    toll: toOverStAmount(overSt.toll),
    tunnel: toOverStAmount(overSt.tunnel),
    [field]: toOverStAmount(value),
  };
}

/** A stored route, opened for editing. */
export function draftOf(route: RouteConfiguration): RouteDraft {
  return {
    id: route.id,
    departure: route.departure,
    destination: route.destination,
    tarief: route.tarief,
    toll: route.toll,
    tunnel: route.tunnel,
  };
}
