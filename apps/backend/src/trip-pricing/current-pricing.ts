import { TripStatus } from "@prisma/client";

/**
 * Which Trips have a CURRENT price.
 *
 * ── ONLY A CLOSED TRIP ──────────────────────────────────────────────────────
 * Pricing describes finished work: the Engine prices a Trip when it closes and
 * reprices it while it stays closed. A Trip that is reopened, cancelled or
 * deleted keeps its stored snapshot — it is history and is never removed —
 * but that snapshot no longer describes the Trip as it stands, so it is not
 * shown as its price anywhere: not in the API, not in the Ritten list, not in
 * either export, not on the detail page, not in the invoice check. Closing the
 * Trip again prices it afresh from its current data.
 *
 * The one place this is decided. The Engine's own precondition reads it too,
 * so "may be priced" and "has a price to show" cannot drift apart.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const PRICED_TRIP_STATUS = TripStatus.CLOSED;

export function hasCurrentPrice(status: TripStatus): boolean {
  return status === PRICED_TRIP_STATUS;
}
