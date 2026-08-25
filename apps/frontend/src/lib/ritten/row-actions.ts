import type { UpdateTripPayload } from "@/lib/api/trips";
import type { ChangeableTripStatus, Trip } from "@/lib/api/types";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * What a Ritten row can ask the page to do.
 *
 * One object rather than nine props: every one of these ends in the same place
 * — a backend call followed by a refetch of the authoritative data — and the
 * page owns that sequence. A row never mutates anything itself, and never
 * decides that something succeeded.
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
 * Cancelling still asks. It is not routine, and it is the one an operator would
 * regret.
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
