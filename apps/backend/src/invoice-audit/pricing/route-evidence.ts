import { RouteMatchMethod, TripDirection } from "@prisma/client";

import {
  cityEndOf,
  roadForms,
  type EndForm,
  type TerminalEnd,
} from "../../route-pricing/location-forms";
import { roadKey, type TripRoad } from "../../route-pricing/route-matcher";
import type { RouteMatchLegView, RouteMatchView } from "../../trip-pricing/route-match-view";
import { toTripRoute, type RoutableTrip } from "../../trips/trip-route";
import { APPROVED_BRACKETED_PLACES } from "./approved-bracketed-places";

/**
 * What the STORED snapshot proves about the road a Trip was priced on.
 *
 * ── READ, NEVER MATCHED AGAIN ───────────────────────────────────────────────
 * The route matcher decided which configured road prices a Trip, and the
 * snapshot recorded that road (`routeMatch.legs`). This module compares the
 * Trip's own road with the RECORDED one, using the very forms the matcher
 * reads (`roadForms`, `roadKey`) — it never asks the matcher, never picks a
 * road and never prices anything.
 *
 * ── WHY `NORMALIZED` NEEDS A SECOND LOOK ────────────────────────────────────
 * The snapshot stores one method for three different matcher steps: the same
 * road after safe normalisation (`ANTWERPEN` = `Antwerpen`), a qualifier given
 * on one side only (`Kallo` = `Kallo (Beveren)`), and — since 15 October 2026 —
 * the place IN the brackets (`Beveren` → `Kallo (Beveren)`). The last one is
 * only confirmed for `ROESELARE (RUMBEKE)`. So the relation between the two
 * recorded names is reconstructed here, and anything that is not one of the
 * safe relations, or cannot be shown at all, is NOT relied on.
 *
 * Limitation, stated plainly: the snapshot does not record WHICH step chose the
 * road. A relation that fits a safe step is accepted as that step; a relation
 * that fits none is reported, never guessed.
 */
export const RouteRelation = {
  /** The matcher found the road exactly. */
  EXACT: "EXACT",
  /** The matcher accepted a unique, uncontested typo. */
  FUZZY: "FUZZY",
  /** The same road after the matcher's safe normalisation. */
  SAME_ROAD: "SAME_ROAD",
  /** A qualifier given on one side only: `Kallo` = `Kallo (Beveren)`. */
  OPTIONAL_QUALIFIER: "OPTIONAL_QUALIFIER",
  /** The place in brackets, confirmed by the owner: `Rumbeke`. */
  APPROVED_BRACKETED_PLACE: "APPROVED_BRACKETED_PLACE",
  /** The place in brackets, NOT confirmed: `Beveren` → `Kallo (Beveren)`. */
  UNCONFIRMED_BRACKETED_PLACE: "UNCONFIRMED_BRACKETED_PLACE",
  /** The two recorded names are none of the above. */
  NOT_EXPLAINED: "NOT_EXPLAINED",
  /** The snapshot recorded no priced road to compare with. */
  NO_LEG_RECORDED: "NO_LEG_RECORDED",
  /** The Trip itself lacks a terminal or a city. */
  NO_TRIP_ROAD: "NO_TRIP_ROAD",
} as const;

export type RouteRelation = (typeof RouteRelation)[keyof typeof RouteRelation];

const RELIABLE_RELATIONS: readonly RouteRelation[] = [
  RouteRelation.EXACT,
  RouteRelation.FUZZY,
  RouteRelation.SAME_ROAD,
  RouteRelation.OPTIONAL_QUALIFIER,
  RouteRelation.APPROVED_BRACKETED_PLACE,
];

export interface RouteEvidence {
  readonly relation: RouteRelation;
  readonly reliable: boolean;
  /** The Trip's own road, `Beveren → Quay 869`; null without one. */
  readonly tripRoute: string | null;
  /** The road the snapshot priced it on, as configured; null without one. */
  readonly pricedRoute: string | null;
}

/**
 * The evidence for a snapshot whose route WAS found — EXACT, NORMALIZED or
 * FUZZY. A NOT_FOUND, AMBIGUOUS or unrecorded match is unreliable before it
 * gets here (see `price-reliability.ts`).
 */
export function assessRouteEvidence(
  trip: RoutableTrip,
  routeMatch: RouteMatchView,
): RouteEvidence {
  const road = toTripRoad(trip);
  const leg = pricedLegOf(routeMatch.legs);
  const evidence = (relation: RouteRelation): RouteEvidence => ({
    relation,
    reliable: RELIABLE_RELATIONS.includes(relation),
    tripRoute: road ? `${road.departure} → ${road.destination}` : null,
    pricedRoute: leg ? `${leg.departure} → ${leg.destination}` : null,
  });

  if (routeMatch.method === RouteMatchMethod.EXACT) {
    return evidence(RouteRelation.EXACT);
  }

  if (routeMatch.method === RouteMatchMethod.FUZZY) {
    return evidence(RouteRelation.FUZZY);
  }

  if (road === null || road.terminalEnd === undefined) {
    return evidence(RouteRelation.NO_TRIP_ROAD);
  }

  if (leg === null) {
    return evidence(RouteRelation.NO_LEG_RECORDED);
  }

  return evidence(relationBetween(road, road.terminalEnd, leg));
}

function relationBetween(
  road: TripRoad,
  terminalEnd: TerminalEnd,
  leg: RouteMatchLegView,
): RouteRelation {
  if (roadKey(leg, terminalEnd) === roadKey(road, terminalEnd)) {
    return RouteRelation.SAME_ROAD;
  }

  const cityEnd = cityEndOf(terminalEnd)!;
  const trip = roadForms(road, terminalEnd);
  const priced = roadForms(leg, terminalEnd);

  if (trip[terminalEnd].full !== priced[terminalEnd].full) {
    return RouteRelation.NOT_EXPLAINED;
  }

  const tripCity = trip[cityEnd];
  const pricedCity = priced[cityEnd];

  if (
    tripCity.base === pricedCity.base &&
    (tripCity.qualifier === null || pricedCity.qualifier === null)
  ) {
    return RouteRelation.OPTIONAL_QUALIFIER;
  }

  const bracketed = toBracketedPair(tripCity, pricedCity);

  if (bracketed === null) {
    return RouteRelation.NOT_EXPLAINED;
  }

  return isApproved(bracketed)
    ? RouteRelation.APPROVED_BRACKETED_PLACE
    : RouteRelation.UNCONFIRMED_BRACKETED_PLACE;
}

/**
 * The two names as `configured (place)` and `place`, when one side names the
 * place the other side holds in brackets — in either direction.
 */
function toBracketedPair(
  tripCity: EndForm,
  pricedCity: EndForm,
): { readonly configured: EndForm; readonly place: string } | null {
  if (tripCity.qualifier === null && pricedCity.qualifier === tripCity.base) {
    return { configured: pricedCity, place: tripCity.base };
  }

  if (pricedCity.qualifier === null && tripCity.qualifier === pricedCity.base) {
    return { configured: tripCity, place: pricedCity.base };
  }

  return null;
}

function isApproved(pair: { readonly configured: EndForm; readonly place: string }): boolean {
  return APPROVED_BRACKETED_PLACES.some((approved) => {
    const configured = cityFormOf(approved.configured);

    return (
      configured.base === pair.configured.base &&
      configured.qualifier === pair.configured.qualifier &&
      cityFormOf(approved.place).full === pair.place
    );
  });
}

/** A name read as the matcher reads a city end. */
function cityFormOf(value: string): EndForm {
  return roadForms({ departure: "", destination: value }, "departure").destination;
}

/**
 * The Trip's road exactly as the Engine priced it: its driving direction, and
 * which end is the terminal (`pricingRoadOf` in the pricing engine reads it the
 * same way — a collection runs city → terminal).
 */
function toTripRoad(trip: RoutableTrip): TripRoad | null {
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

  return {
    departure: route.from,
    destination: route.to,
    terminalEnd: trip.direction === TripDirection.COLLECTION ? "destination" : "departure",
  };
}

/** The road that priced THIS Trip: its own leg of a Combination, or the route. */
function pricedLegOf(legs: readonly RouteMatchLegView[]): RouteMatchLegView | null {
  return legs.find((leg) => leg.isPricedLeg) ?? (legs.length === 1 ? legs[0] : null);
}
