import type { ChangeableTripStatus, Trip, TripStatus } from "@/lib/api/types";

/**
 * Which lifecycle actions to OFFER for a Trip.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS IS A MIRROR OF THE BACKEND'S STATE MACHINE, NOT A SECOND SOURCE OF
 * TRUTH. The backend decides; this only decides what to put on screen.
 *
 * It exists because no endpoint reports which transitions a Trip may currently
 * make — the permitted set appears only inside the text of a rejection message,
 * which cannot be read programmatically. Without this map the UI would have to
 * offer every action and let most of them fail, which is a worse experience
 * than offering the ones that work.
 *
 * The consequence is a duplication that must be kept honest:
 *   - Every action here is still sent to the backend, and a refusal is shown as
 *     the backend worded it. Nothing is assumed to have succeeded.
 *   - If this map ever disagrees with the backend, the backend wins and the
 *     user sees why.
 *
 * The proper fix is for the Trip response to carry its allowed transitions.
 * That is reported as an API gap rather than worked around any further.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Mirrors ALLOWED_TRANSITIONS in the backend's trip-status.rules.ts. */
const OFFERED_TRANSITIONS: Readonly<
  Record<TripStatus, readonly ChangeableTripStatus[]>
> = {
  // CLOSED is terminal: a pricing snapshot exists from that point on.
  OPEN: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: ["OPEN"],
  // A DELETED Trip leaves only through restoration.
  DELETED: [],
};

/**
 * Mirrors DELETABLE_FROM_STATUSES in the backend's `trip-status.rules.ts`.
 *
 * A cancelled transport is exactly the kind an operator wants out of the way,
 * and CANCELLED → OPEN → DELETED moved it through a state it was never in on
 * the way past. CLOSED stays absent: a Trip that has been carried out and
 * priced is not tidied away.
 */
const DELETABLE_FROM: readonly TripStatus[] = ["OPEN", "CANCELLED"];

/**
 * An offered transition.
 *
 * There is no label here on purpose. Labels and confirmations are translated
 * text, and this module is about which transitions EXIST — mixing the two once
 * produced an English-only action bar beside a translated menu. Both consumers
 * now read the same keys from `ritten/row-actions.ts`.
 */
export interface StatusAction {
  readonly target: ChangeableTripStatus;
  /** True for actions a user cannot undo, so the UI can mark them clearly. */
  readonly isIrreversible: boolean;
}

const ACTION_BY_TARGET: Record<ChangeableTripStatus, StatusAction> = {
  // Closing is permanent: CLOSED is terminal and pricing is snapshotted there.
  CLOSED: { target: "CLOSED", isIrreversible: true },
  CANCELLED: { target: "CANCELLED", isIrreversible: false },
  OPEN: { target: "OPEN", isIrreversible: false },
};

export function statusActionsFor(trip: Trip): StatusAction[] {
  return OFFERED_TRANSITIONS[trip.status].map(
    (target) => ACTION_BY_TARGET[target],
  );
}

/**
 * The ONE lifecycle action a Ritten row offers.
 *
 * ── WHY ONE, AND WHY THESE ──────────────────────────────────────────────────
 * The row used to hide every transition behind an "Acties" dropdown, which cost
 * two clicks and a read to do the thing an operator does all day. A row now
 * carries the action that follows from its status, visibly:
 *
 *   OPEN       → Afwerken   (CLOSED)
 *   CANCELLED  → Openen     (OPEN)
 *   CLOSED     → nothing. CLOSED is terminal in the backend's state machine;
 *                see `allowedTransitionsFrom` there. Offering "Heropenen" would
 *                be a button that can only ever fail.
 *   DELETED    → nothing. A deleted Trip leaves only through restore.
 *
 * Cancelling is deliberately NOT here. It is the one transition an operator
 * would regret, it is not routine, and it keeps its confirmation on the Trip
 * detail page rather than sitting one stray click away in every row.
 *
 * LOSRIT changes none of this: it is a classification, not a state.
 * ────────────────────────────────────────────────────────────────────────────
 */
const PRIMARY_ROW_ACTION: Readonly<
  Record<TripStatus, ChangeableTripStatus | null>
> = {
  OPEN: "CLOSED",
  CLOSED: null,
  CANCELLED: "OPEN",
  DELETED: null,
};

/**
 * Returns the row's action, or null when the status has none.
 *
 * Cross-checked against the offered transitions rather than trusted on its own:
 * if the two ever disagree, the row shows nothing instead of a button the
 * backend will refuse.
 */
export function primaryRowAction(trip: Trip): StatusAction | null {
  const target = PRIMARY_ROW_ACTION[trip.status];

  if (target === null) {
    return null;
  }

  return (
    statusActionsFor(trip).find((action) => action.target === target) ?? null
  );
}

/**
 * Soft delete is offered only where the backend accepts it.
 *
 * Offering it on a CLOSED Trip would be a button that can only ever 409.
 */
export function canDelete(trip: Trip): boolean {
  return DELETABLE_FROM.includes(trip.status);
}

/**
 * Whether completing this Trip would move it.
 *
 * Read from the same transition table the row menu uses, so a bulk selection
 * offers completion for exactly the Trips a row would offer it for. A Trip
 * already CLOSED is not "completable" — there is nothing left to do to it.
 */
export function canComplete(trip: Trip): boolean {
  return statusActionsFor(trip).some((action) => action.target === "CLOSED");
}

export function canRestore(trip: Trip): boolean {
  return trip.status === "DELETED";
}

/**
 * A CLOSED Trip with no pricing snapshot.
 *
 * Automatic pricing runs when a Trip closes, and CLOSED is terminal — so this
 * combination means the calculation failed or has not produced a snapshot yet.
 * It is recoverable through Reprocess, and it is the one state that needs
 * explaining rather than merely displaying.
 */
export function needsPricingAttention(
  trip: Trip,
  hasPricing: boolean,
): boolean {
  return trip.status === "CLOSED" && !hasPricing;
}
