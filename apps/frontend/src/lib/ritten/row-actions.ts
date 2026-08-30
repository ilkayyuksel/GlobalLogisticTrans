import type { OverridableComponent } from "@/lib/api/trip-pricing-overrides";
import type { UpdateTripPayload } from "@/lib/api/trips";
import type { ChangeableTripStatus, Trip } from "@/lib/api/types";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * What a Ritten row can ask the page to do.
 *
 * One object rather than a dozen props: almost every one of these ends in the
 * same place — a backend call followed by a refetch of the authoritative data —
 * and the page owns that sequence. A row never mutates anything itself, and
 * never decides that something succeeded.
 *
 * The two exceptions are named below and say why: sending a PDF changes
 * nothing, and a pricing correction is answered with the new figures, so
 * neither has anything to refetch.
 *
 * Restoring, reprocessing pricing and editing a Trip's less common fields are
 * deliberately NOT here. They left with the "Acties" dropdown, and all of them
 * live on the Trip detail page — one click away through the booking number in
 * every row. Restoring in particular was unreachable from this list in any
 * case: a DELETED Trip is hidden from it and cannot be filtered back into view.
 */
export interface RittenActions {
  /** Resolves when the backend accepted the change AND the list was refetched. */
  saveTrip: (tripId: string, payload: UpdateTripPayload) => Promise<void>;
  changeStatus: (trip: Trip, status: ChangeableTripStatus) => Promise<void>;
  /**
   * SOFT delete: the Trip leaves the planning, the row and its documents stay.
   * Confirmed first — see `DeleteConfirmDialog` — unlike every other row action.
   */
  deleteTrip: (trip: Trip) => Promise<void>;
  /**
   * Takes the LOSRIT classification off. The Trip itself is untouched: same
   * status, same planning, same identity, same documents, same pricing.
   */
  removeLosrit: (trip: Trip) => Promise<void>;
  /**
   * Marks a Trip BETAALD or NIET BETAALD.
   *
   * DELIBERATELY DOES NOT REFETCH THE LIST, for the same reason a pricing
   * correction does not: the endpoint answers with the whole updated Trip, so
   * the page patches that one row and the filter, the page, the period, the
   * selection and the scroll position all survive. Refetching would throw away
   * an answer already in hand and move every other row while an operator was
   * working through them.
   *
   * It never changes the Trip's status — that is the backend's guarantee, and
   * nothing on this side assumes otherwise.
   */
  changePayment: (trip: Trip, isPaid: boolean) => Promise<void>;
  openCombination: (tripGroupId: string) => void;
  /** Clears this Trip's group; the group and its other members survive. */
  unlinkFromGroup: (trip: Trip) => Promise<void>;
  openPdf: (trip: Trip) => void;
  downloadPdf: (trip: Trip) => Promise<void>;
  openCustomProperties: (trip: Trip) => void;
  /**
   * The Cost Confirmation's OWN document — never the transport order.
   *
   * A Trip's `pdfDocumentId` is the order it came from; the confirmation is a
   * separate document that arrived later, and opening the wrong one would show
   * an operator a transport order where they asked for the money.
   */
  openCostConfirmationPdf: (trip: Trip) => void;
  /**
   * Sends the Trip's transport order to its driver over WhatsApp.
   *
   * DELIBERATELY NOT A MUTATION. It changes nothing about the Trip — not the
   * status, not the driver, not the document history — so unlike every other
   * action here it does not refetch the list afterwards. There would be nothing
   * new to fetch, and a table that flickered after a send would suggest
   * otherwise.
   */
  sendPdf: (trip: Trip) => Promise<void>;
  /**
   * Corrects one pricing component of one Trip: Tarief, Tol or Tunnel.
   *
   * DELIBERATELY DOES NOT REFETCH THE LIST. The endpoint answers with the whole
   * recalculated breakdown for that Trip, so the page updates that one row from
   * the response — which is why Brandstof and Totaal are right afterwards
   * without anything on this side computing either. Refetching would throw away
   * an answer already in hand, and would move every other row on the page while
   * an operator was working through them.
   *
   * Rejects with the backend's own error so the cell can keep its editor open
   * and say what was wrong. Nothing is painted before it resolves.
   */
  savePricingOverride: (
    tripId: string,
    componentCode: OverridableComponent,
    amount: number,
  ) => Promise<void>;
  /** Withdraws such a correction. Same contract, same row-local update. */
  resetPricingOverride: (
    tripId: string,
    componentCode: OverridableComponent,
  ) => Promise<void>;
}

/** Translations for the transitions `statusActionsFor` offers. */
export const STATUS_LABEL_KEYS: Record<ChangeableTripStatus, TranslationKey> = {
  CLOSED: "ritten.menu.close",
  CANCELLED: "ritten.menu.cancel",
  OPEN: "ritten.menu.reopen",
};

/**
 * Confirmations, where the consequence is not obviously reversible.
 *
 * Reopening needs none: it is the undo of cancelling.
 */
/**
 * The transitions that ask before they happen.
 *
 * COMPLETING IS DELIBERATELY ABSENT. It is a state an operator sets a dozen
 * times an afternoon, the row says so immediately afterwards, and a dialog in
 * front of a routine action is one people learn to dismiss without reading —
 * which is worse protection than none, because it trains the habit that then
 * dismisses the cancellation dialog too.
 *
 * Cancelling asks. It is not routine, and it is the one an operator would
 * regret.
 *
 * REOPENING A CANCELLATION ASKS TOO, but through the application's own dialog
 * rather than this map — see `RowLifecycleActions`. A cancelled transport was
 * called off, and putting it back in the planning says it is happening after
 * all: a statement about the day's work rather than a correction.
 */
export const STATUS_CONFIRM_KEYS: Partial<
  Record<ChangeableTripStatus, TranslationKey>
> = {
  CANCELLED: "ritten.confirm.cancel",
};

/**
 * Whether the fields a transport order STATES may be typed on this Trip.
 *
 * Those are the destination and the transport times. A Trip created by hand has
 * no source document, so the operator is the only possible author of either —
 * and until the backend accepted them, a city or an hour entered wrongly at
 * creation could never be corrected. An IMPORTED Trip still belongs to its
 * document: a later UPDATE re-reads both from the PDF, so anything typed here
 * would be silently overwritten, and the backend refuses it.
 *
 * The same condition the backend applies, so these cells are read-only exactly
 * where a save would be refused rather than offering an edit that cannot work.
 */
export function canEditDocumentFields(trip: Trip): boolean {
  return canEdit(trip) && trip.pdfDocumentId === null;
}

/** A DELETED Trip is read-only until it is restored. */
export function canEdit(trip: Trip): boolean {
  return trip.status !== "DELETED";
}

/**
 * Every Trip has exactly one source document, so viewing it is always offered.
 *
 * The column is non-nullable in the database: a Trip cannot exist without the
 * PDF it came from.
 */
export function canViewPdf(trip: Trip): boolean {
  return Boolean(trip.pdfDocumentId);
}
