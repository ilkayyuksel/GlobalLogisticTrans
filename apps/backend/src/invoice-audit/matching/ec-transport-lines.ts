import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import type { InvoiceRowMatch } from "./invoice-row-match";

/**
 * ── AN EK LINE IS ITS TRANSPORT'S LINE WHEN THE TRANSPORT HAS NONE ──────────
 * A row shaped like a Cost Confirmation line — an EK and `EC <nr>`, none of a
 * transport's other details — still states at least two of a day, a booking
 * and a container, so it names a transport the way any line does. When no
 * transport line of the document is that transport, it IS its line (owner,
 * October 2026, week 41 R53-R54): matched on those values — never on its EC
 * number — its prices filled from Trano like any transport line's, and EK
 * lines stating the same values are that one transport over several rows.
 * Its EC number is then only a Remarks part, its confirmation checked apart.
 *
 * Beside a transport line of its own, it stays the EC charge it is.
 */
export function toTransportCandidates(rows: readonly InvoiceSheetRow[]): InvoiceSheetRow[] {
  return rows.filter((row) => row.costLine !== null).map((row) => ({ ...row, costLine: null }));
}

/**
 * The EK lines that are their transport's own line: those the transport match
 * found ANY Trip for — one, several, an unfinished one, one in conflict —
 * that no transport line of the document names, not even as a candidate.
 *
 * A Trip a transport line does name already has its line: the EK line stays
 * the EC charge it is. Only an EK line the three values find NO Trip for goes
 * on to its EC number; the EC number never chooses between Trips the transport
 * match found.
 */
export function toOwnTransportLines(
  candidates: readonly InvoiceRowMatch[],
  transportLines: readonly InvoiceRowMatch[],
): InvoiceRowMatch[] {
  const named = new Set(transportLines.flatMap(tripIdsOf));

  return candidates.filter((match) => {
    const found = tripIdsOf(match);

    return found.length > 0 && found.every((tripId) => !named.has(tripId));
  });
}

function tripIdsOf(match: InvoiceRowMatch): string[] {
  return [match.trip, ...match.candidates].flatMap((trip) => (trip ? [trip.id] : []));
}
