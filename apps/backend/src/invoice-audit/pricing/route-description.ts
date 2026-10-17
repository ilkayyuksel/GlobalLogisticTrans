import { RouteMatchMethod } from "@prisma/client";

import type { RouteMatchLegView, RouteMatchView } from "../../trip-pricing/route-match-view";
import { toTripRoute, type RoutableTrip } from "../../trips/trip-route";

/**
 * The Trip's own road beside the road its stored price was made on, and how
 * the system matched them — for an operator to READ.
 *
 * ── INFORMATION, NEVER A VERDICT ────────────────────────────────────────────
 * The route matcher decided which configured road prices a Trip, and the
 * snapshot recorded that decision. Whether a price can be relied on follows
 * from that stored decision alone (`price-reliability.ts`): `Eindhout` priced
 * on `LAAKDAL (EINDHOUT)` is the system's own successful match, and a different
 * spelling of the two names is not a reason to doubt it. Nothing here compares
 * the names, and nothing is matched again.
 */
export interface RouteDescription {
  /** How the system matched the route, as the snapshot recorded it; null when it did not. */
  readonly matchMethod: RouteMatchMethod | null;
  /** The Trip's own road, `Eindhout → Quay 869`; null without one. */
  readonly tripRoute: string | null;
  /** The road the snapshot priced it on, as configured; null when none was recorded. */
  readonly pricedRoute: string | null;
}

export function describeRoutes(trip: RoutableTrip, routeMatch: RouteMatchView): RouteDescription {
  const road = toTripRoad(trip);
  const leg = pricedLegOf(routeMatch.legs);

  return {
    matchMethod: routeMatch.method,
    tripRoute: road ? `${road.departure} → ${road.destination}` : null,
    pricedRoute: leg ? `${leg.departure} → ${leg.destination}` : null,
  };
}

/** The Trip's road in its driving direction: a collection runs city → terminal. */
function toTripRoad(trip: RoutableTrip): { departure: string; destination: string } | null {
  // An absent fact is an unknown one: a Trip read without its route fields has
  // no road, rather than a road made of `undefined`.
  const route = toTripRoute({
    direction: trip.direction ?? null,
    terminal: trip.terminal ?? null,
    destinationCity: trip.destinationCity ?? null,
  });

  if (route === null || route.from === "" || route.to === "") {
    return null;
  }

  return { departure: route.from, destination: route.to };
}

/** The road that priced THIS Trip: its own leg of a Combination, or the route. */
function pricedLegOf(legs: readonly RouteMatchLegView[]): RouteMatchLegView | null {
  return legs.find((leg) => leg.isPricedLeg) ?? (legs.length === 1 ? legs[0] : null);
}
