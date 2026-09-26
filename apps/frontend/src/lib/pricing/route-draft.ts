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
