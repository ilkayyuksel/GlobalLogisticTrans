import type {
  RouteConfiguration,
  RouteConfigurationPayload,
} from "@/lib/api/route-configuration";

/**
 * A route being typed — an ordinary one, or one leg of a Combination.
 *
 * ── WHY IT IS THE SAME SHAPE FOR BOTH ───────────────────────────────────────
 * A Combination leg IS a route: it has a Van, a Naar, a Tarief, a distance and a
 * tunnel of its own, which is exactly why the two legs can cost different
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
  kilometres: string;
  tunnel: string;
}

export const BLANK_ROUTE_DRAFT: RouteDraft = {
  id: null,
  departure: "",
  destination: "",
  tarief: "",
  kilometres: "",
  tunnel: "",
};

/**
 * What goes to the backend.
 *
 * Sent as typed: the backend validates the range and the decimals, and a check
 * repeated here would be the same rule kept in two places. An empty distance
 * reaches it as zero rather than as a guess, which is what the input's own
 * minimum already implies.
 */
export function toRoutePayload(draft: RouteDraft): RouteConfigurationPayload {
  return {
    departure: draft.departure.trim(),
    destination: draft.destination.trim(),
    tarief: Number(draft.tarief),
    kilometres: Number(draft.kilometres),
    tunnel: Number(draft.tunnel),
  };
}

/** The five fields of a route that can be edited in place. */
export type RouteField =
  | "departure"
  | "destination"
  | "tarief"
  | "kilometres"
  | "tunnel";

/**
 * A stored route as a payload, with ONE field replaced.
 *
 * ── WHY THE WHOLE ROUTE GOES BACK ───────────────────────────────────────────
 * The update endpoint takes a complete configuration — it is the same call the
 * add form makes — so an inline edit of one value sends the other four exactly
 * as they are. Read from the route on screen, so nothing else can move: the one
 * field an operator changed is the one field that differs.
 *
 * ── AND WHY NULL SURVIVES ───────────────────────────────────────────────────
 * A route whose distance nobody has stated carries null, not zero, and the two
 * mean different things: no toll because nobody measured the road, against no
 * toll because somebody decided it is free. Editing the TARIEF of such a route
 * must not quietly measure it at zero on the way past.
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
    kilometres: route.kilometres === null ? null : Number(route.kilometres),
    tunnel: Number(route.tunnel),
  };
}

/**
 * What one typed value means for its field.
 *
 * An empty DISTANCE is null: nobody has stated how long the road is, which is
 * what the column has always meant. An empty amount is not turned into zero —
 * `Number("")` would make it one silently — so it goes out as it is and the
 * backend refuses it in its own words. No rule is invented here.
 */
function toFieldValue(field: RouteField, value: string): string | number | null {
  if (field === "departure" || field === "destination") {
    return value.trim();
  }

  if (field === "kilometres" && value.trim() === "") {
    return null;
  }

  return Number(value);
}

/** A stored route, opened for editing. */
export function draftOf(route: RouteConfiguration): RouteDraft {
  return {
    id: route.id,
    departure: route.departure,
    destination: route.destination,
    tarief: route.tarief,
    // An empty box rather than a 0: nobody has stated this road's length, and
    // typing a zero would claim somebody decided it is free.
    kilometres: route.kilometres ?? "",
    tunnel: route.tunnel,
  };
}
