import { InvoiceRowStatus, type InvoiceRowMatch } from "./invoice-row-match";

/**
 * ── ONE TRANSPORT IS NOT TWO LINES ──────────────────────────────────────────
 * A corrected number is only as good as the evidence that no other line is the
 * transport it corrects to. When a line reaches its Trip only by correcting its
 * container or booking, and ANOTHER line of the same document names that same
 * Trip, the two cannot both be right: the correction is withdrawn, the line
 * becomes a CONFLICT and a person decides.
 *
 * Lines stating exactly the same day, booking and container are one transport
 * split over several rows (its EK per Cost Confirmation) and never conflict.
 * Cost Confirmation lines charge a Trip without claiming to BE its transport
 * line, so they never conflict either.
 */
export function withIdentityConflicts(
  matches: readonly InvoiceRowMatch[],
): InvoiceRowMatch[] {
  const claimsByTrip = new Map<string, InvoiceRowMatch[]>();

  for (const match of matches) {
    if (match.trip === null || match.row.costLine !== null) {
      continue;
    }

    claimsByTrip.set(match.trip.id, [...(claimsByTrip.get(match.trip.id) ?? []), match]);
  }

  return matches.map((match) => {
    if (match.trip === null || !isCorrected(match)) {
      return match;
    }

    const others = (claimsByTrip.get(match.trip.id) ?? []).filter(
      (other) => other !== match && identityKey(other) !== identityKey(match),
    );

    if (others.length === 0) {
      return match;
    }

    return {
      ...match,
      status: InvoiceRowStatus.CONFLICT,
      trip: null,
      candidates: [match.trip],
      containerCorrection: null,
      bookingCorrection: null,
      problem: `Door deze regel te corrigeren, zou hij dezelfde rit krijgen als rij ${others
        .map((other) => other.row.rowNumber)
        .join(", ")}.`,
    };
  });
}

function isCorrected(match: InvoiceRowMatch): boolean {
  return match.containerCorrection !== null || match.bookingCorrection !== null;
}

function identityKey(match: InvoiceRowMatch): string {
  const { row } = match;

  return `${row.planningDate}|${row.bookingNumber}|${row.normalizedContainerNumber}`;
}
