import type { Trip } from "@prisma/client";

import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";

/** Which match problem an unresolved line names a Trip with. */
export const UnresolvedClaim = {
  /** The line could be this Trip or another one: nothing was chosen. */
  AMBIGUOUS_MATCH: "AMBIGUOUS_MATCH",
  /** The line and another line both lead to this Trip. */
  MATCH_CONFLICT: "MATCH_CONFLICT",
  /** The line found this Trip, which is not finished. */
  NOT_FINISHED: "NOT_FINISHED",
} as const;

export type UnresolvedClaim = (typeof UnresolvedClaim)[keyof typeof UnresolvedClaim];

const CLAIM_OF: Partial<Record<InvoiceRowStatus, UnresolvedClaim>> = {
  [InvoiceRowStatus.AMBIGUOUS]: UnresolvedClaim.AMBIGUOUS_MATCH,
  [InvoiceRowStatus.CONFLICT]: UnresolvedClaim.MATCH_CONFLICT,
  [InvoiceRowStatus.NOT_FINISHED]: UnresolvedClaim.NOT_FINISHED,
};

export interface TripClaims {
  readonly trip: Trip;
  readonly claims: ReadonlySet<UnresolvedClaim>;
  /** The unresolved lines naming the Trip, in row order. */
  readonly rowNumbers: readonly number[];
}

/**
 * Every Trip an UNRESOLVED transport line names as a candidate, with why and
 * on which rows — the evidence that a transport may not be settled yet, and
 * the rows a person has to fix for it to be.
 *
 * ── A COST CONFIRMATION LINE NEVER CLAIMS A TRANSPORT ───────────────────────
 * An EC line charges an amount beside a transport; it is never the transport's
 * own line. One that could not be linked leaves that EK unchecked and nothing
 * more: the transport is matched, checked and settled on its own line.
 */
export function claimsByTrip(matches: readonly InvoiceRowMatch[]): Map<string, TripClaims> {
  const byTrip = new Map<string, { trip: Trip; claims: Set<UnresolvedClaim>; rowNumbers: number[] }>();

  for (const match of matches) {
    const claim = CLAIM_OF[match.status];

    if (claim === undefined || match.row.costLine !== null) {
      continue;
    }

    for (const trip of match.candidates) {
      const entry = byTrip.get(trip.id) ?? { trip, claims: new Set(), rowNumbers: [] };

      entry.claims.add(claim);
      entry.rowNumbers.push(match.row.rowNumber);
      byTrip.set(trip.id, entry);
    }
  }

  for (const entry of byTrip.values()) {
    entry.rowNumbers.sort((left, right) => left - right);
  }

  return byTrip;
}
