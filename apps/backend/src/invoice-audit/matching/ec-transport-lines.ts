import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import type { InvoiceRowMatch } from "./invoice-row-match";

/**
 * ── AN EK LINE THAT STATES A WHOLE TRANSPORT IS THAT TRANSPORT'S LINE ───────
 * A row shaped like a Cost Confirmation line — an EK and `EC <nr>`, none of a
 * transport's other details — that nonetheless states a day, a booking AND a
 * container names a transport, the way any transport line does. When no other
 * transport line of the document is that transport, it IS its line (owner,
 * October 2026): matched on those three values — never on its EC number —
 * and its prices compared and filled like any transport line's. Its EC number
 * is then only a Remarks part, its confirmation checked apart.
 *
 * One stating no container stays a Cost Confirmation line: it names a charge,
 * not a transport.
 */
export function toTransportCandidates(rows: readonly InvoiceSheetRow[]): InvoiceSheetRow[] {
  return rows
    .filter((row) => row.costLine !== null && row.normalizedContainerNumber !== "")
    .map((row) => ({ ...row, costLine: null }));
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
