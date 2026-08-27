import {
  TripDocumentAction,
  type TripDocumentDto,
} from "../trips/dto/trip-document-response.dto";

/**
 * WHICH transport order a driver should be sent.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * The latest APPLIED UPDATE, and failing that the original NEW order the Trip
 * was created from. Nothing else is a transport order a driver can work from:
 *
 *   a CANCEL says the transport is off. Sending it as the day's instruction is
 *     the exact opposite of the instruction;
 *   a COST CONFIRMATION is money between Eucon and the office. It is not the
 *     driver's business and carries no transport data at all;
 *   a REFUSED UPDATE changed nothing. The Trip does not reflect it, so sending
 *     it would hand a driver a document that disagrees with their own planning.
 *
 * ── WHY "APPLIED" AND NOT "LATEST" ──────────────────────────────────────────
 * A document that arrived is not a document that took effect. `applied` is the
 * existing history's own word for "this moved the Trip", and it is what keeps a
 * refused UPDATE out without this file having to re-derive why it was refused.
 *
 * ── WHY ARRIVAL TIME ORDERS THEM ────────────────────────────────────────────
 * The same reason `TripDocumentsService` uses it to mark the effective
 * document: documents do not arrive in business order, and processing time is
 * reordered by a retry, a restart or a slow poll. Arrival time is the sender's
 * order, which is the one that means anything. This deliberately mirrors that
 * existing logic rather than inventing a second chronology.
 *
 * ── WHY NOT SIMPLY `isEffective` ────────────────────────────────────────────
 * Because the effective document can be a CANCEL, and a cancelled transport's
 * governing document is precisely the one a driver must not receive. The
 * effective marker answers "what governs this Trip"; this answers "what should
 * a driver drive from", and on a cancelled Trip those differ.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const DocumentRefusal = {
  /** No applied UPDATE and no original order — a Trip created by hand. */
  NO_TRANSPORT_DOCUMENT: "NO_TRANSPORT_DOCUMENT",
} as const;

export type DocumentRefusal =
  (typeof DocumentRefusal)[keyof typeof DocumentRefusal];

export interface DocumentSelection {
  readonly pdfDocumentId: string | null;
  readonly reason: DocumentRefusal | null;
}

/** When a document reached us. The same fallback the documents list uses. */
function arrivedAt(document: TripDocumentDto): number {
  return (document.receivedAt ?? document.occurredAt).getTime();
}

/**
 * Picks the transport order to send, or says that there is none.
 *
 * `originalPdfDocumentId` is `trip.pdfDocumentId` — the Trip's own source
 * document, which is the original NEW order by definition. It is read from the
 * Trip rather than found in the list because the list describes EVENTS, and the
 * original order caused no event on the Trip it created.
 */
export function selectTransportDocument(
  documents: readonly TripDocumentDto[],
  originalPdfDocumentId: string | null,
): DocumentSelection {
  const latestUpdate = latestAppliedUpdate(documents);

  if (latestUpdate) {
    return { pdfDocumentId: latestUpdate.pdfDocumentId, reason: null };
  }

  if (originalPdfDocumentId) {
    return { pdfDocumentId: originalPdfDocumentId, reason: null };
  }

  return {
    pdfDocumentId: null,
    reason: DocumentRefusal.NO_TRANSPORT_DOCUMENT,
  };
}

/**
 * The most recently arrived UPDATE that actually took effect.
 *
 * Ties keep the FIRST of the equal entries rather than flipping between reads.
 * Two documents sharing an arrival time is something the data cannot resolve,
 * and a send that picked a different one each time would be worse than either
 * answer.
 */
function latestAppliedUpdate(
  documents: readonly TripDocumentDto[],
): TripDocumentDto | null {
  let latest: TripDocumentDto | null = null;

  for (const document of documents) {
    if (!document.applied || document.action !== TripDocumentAction.Update) {
      continue;
    }

    if (!latest || arrivedAt(document) > arrivedAt(latest)) {
      latest = document;
    }
  }

  return latest;
}
