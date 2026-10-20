import { PricingCalculationStatus, TripStatus } from "@prisma/client";

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

/**
 * ── AND NOT A SNAPSHOT A LATER CALCULATION FAILED TO REPLACE ────────────────
 * When a Trip is priced again — on closing, after an edit, on a reprocess —
 * and that calculation fails, the stored snapshot describes the Trip as it
 * WAS, not as it is: closing a reopened Trip, or changing one while closed,
 * must never leave the old figures on screen as its price. Such a snapshot is
 * marked FAILED (`PricingSnapshotWriter.markFailed`) and is kept as history,
 * exactly like a reopened Trip's; the next successful calculation replaces it
 * as CALCULATED.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const FAILED_CALCULATION_STATUS = PricingCalculationStatus.FAILED;
