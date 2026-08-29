import { TripDirection } from "@prisma/client";

import { toCanonicalTerminal } from "../common/terminal";

/*
 * Re-exported so the route and the matching stay one vocabulary for callers,
 * while the RULE itself lives in `common` — RoutePricing and RouteCost match on
 * it too, and neither should have to reach into the Trip domain for it.
 */
export { isSameTerminal, toCanonicalTerminal } from "../common/terminal";

/**
 * The canonical route of a Trip: where it starts, where it ends.
 *
 * ── ONE REPRESENTATION, FOUR CONSUMERS ──────────────────────────────────────
 * The Ritten list, the Trip detail, the Excel exports and the future pricing
 * rules all need the same answer, and they must not each build it. So it is
 * derived HERE, once, and travels on the Trip response. A route assembled
 * separately in a React component and in an export would eventually disagree
 * about which end is which, and the direction is exactly what pricing will key
 * on.
 *
 * ── DERIVED, NEVER STORED ───────────────────────────────────────────────────
 * Nothing new is written to the database. A Trip already carries the three
 * facts a route is made of — its direction, its terminal and its destination
 * city — so a column or a table would only be a copy that could drift from
 * them. It costs no query and no request: the Trip response already has all
 * three.
 *
 * ── THE DIRECTION DECIDES THE ORDER ─────────────────────────────────────────
 * A transport order prints `LOADING 1:` and `DELIVERY 1:` sections, and one
 * document can produce a Trip from each. The parser records which section a
 * Trip came from as its DIRECTION — `LOADING` becomes COLLECTION — and that
 * recorded fact is what orders the route here. It is never inferred from the
 * order the sections happen to appear in, from the terminal, or from anything
 * else on the page.
 *
 *     DELIVERY     out of the quay to the customer:  TERMINAL -> CITY
 *     COLLECTION   from the customer to the quay:    CITY -> TERMINAL
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface TripRoute {
  /** Where the Trip starts. */
  readonly from: string;
  /** Where the Trip ends. */
  readonly to: string;
}

/** The three facts a route is made of. Nothing else is consulted. */
export interface RoutableTrip {
  readonly direction: TripDirection | null;
  readonly terminal: string | null;
  readonly destinationCity: string | null;
}

/**
 * The canonical route of one Trip, or null when it has neither end.
 *
 * A Trip missing one end still has a route — the end it has, with the other
 * blank — because a half-known route is information and an absent one is not.
 *
 * ── A TRIP WITH NO STATED DIRECTION ─────────────────────────────────────────
 * A Trip created by hand has no document that could have said which half it is.
 * It keeps the terminal-first reading, which is the order this system has
 * always shown such a Trip in: that is a fallback, NOT an inference that it is
 * a delivery. Only `direction` may claim a direction, and pricing rules that
 * care must read `direction` rather than the order of these two fields.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function toTripRoute(trip: RoutableTrip): TripRoute | null {
  const terminal = toCanonicalTerminal(trip.terminal);
  const city = toCanonicalCity(trip.destinationCity);

  if (terminal === null && city === null) {
    return null;
  }

  const isCollection = trip.direction === TripDirection.COLLECTION;

  return {
    from: (isCollection ? city : terminal) ?? "",
    to: (isCollection ? terminal : city) ?? "",
  };
}

/**
 * The city, as the parser read it from the address block of this Trip's own
 * section.
 *
 * Whitespace only. The city is NEVER renamed, translated, abbreviated or
 * derived from a company name, a street, a postcode or a remark — the parser is
 * its source, and this layer only tidies the spacing around what it produced.
 */
function toCanonicalCity(city: string | null): string | null {
  if (city === null) {
    return null;
  }

  const collapsed = city.replace(/\s+/g, " ").trim();

  return collapsed === "" ? null : collapsed;
}
