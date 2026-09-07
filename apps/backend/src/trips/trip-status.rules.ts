import { TripStatus } from "@prisma/client";

/**
 * The Trip status state machine.
 *
 * Kept as pure data outside the service so the whole lifecycle is readable in
 * one place and testable without a database, a logger or a repository.
 *
 * Sources — database_model.md §4.1 "Trip Status" and "Lifecycle":
 *   - OPEN is the entry state.
 *   - CANCELLED is a business cancellation; DELETED is an administrative soft
 *     delete, and the two must never be treated as the same value.
 *   - "Trip reopened" is a recorded event.
 *
 * ── CLOSED IS NO LONGER TERMINAL ────────────────────────────────────────────
 * It used to be, on the reasoning that a pricing snapshot exists from that
 * point on and reopening would invalidate it. That reasoning does not hold:
 * reopening writes ONE column and touches no pricing at all. The snapshot
 * stays exactly as it was — `announceIfClosed` fires only when a Trip becomes
 * CLOSED, so no recalculation is triggered on the way out, and the amounts a
 * Trip was charged remain readable and unchanged.
 *
 * A closed transport that turns out to be unfinished is an ordinary operational
 * fact, and the alternative was to leave the record permanently wrong.
 */

/**
 * Statuses a Trip may be moved to through the status endpoint.
 *
 * DELETED is deliberately absent: soft delete and restore are separate
 * operations with their own rules, so the two concerns cannot be confused.
 */
export const CHANGEABLE_TRIP_STATUSES = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
  TripStatus.CANCELLED,
] as const;

export type ChangeableTripStatus = (typeof CHANGEABLE_TRIP_STATUSES)[number];

/**
 * Allowed transitions, keyed by current status.
 *
 * CLOSED reopens to OPEN and nothing else: a finished transport that turns out
 * to be unfinished goes back into the planning, and cancelling it afterwards is
 * a second, separate decision made from OPEN.
 *
 * DELETED is left only through restore.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<TripStatus, readonly TripStatus[]>> =
  {
    [TripStatus.OPEN]: [TripStatus.CLOSED, TripStatus.CANCELLED],
    [TripStatus.CLOSED]: [TripStatus.OPEN],
    [TripStatus.CANCELLED]: [TripStatus.OPEN],
    [TripStatus.DELETED]: [],
  };

/**
 * The statuses a Trip may be soft-deleted from.
 *
 * ── WHY CANCELLED IS HERE ───────────────────────────────────────────────────
 * A cancelled transport is exactly the kind an operator wants out of the way,
 * and requiring them to reopen it first — CANCELLED → OPEN → DELETED — moved
 * the Trip through a state it was never in, announcing that it was live again
 * on the way past.
 *
 * ── AND WHAT THAT COSTS ─────────────────────────────────────────────────────
 * Restore returns a Trip to OPEN, and the status it held before deletion is
 * recorded nowhere. So a Trip deleted FROM CANCELLED comes back OPEN rather
 * than cancelled. That is a real loss of information, stated here rather than
 * hidden: restoring is an administrator recovering a record, not an undo of the
 * cancellation, and the Trip can be cancelled again in one step.
 *
 * ── AND WHY CLOSED IS HERE NOW ──────────────────────────────────────────────
 * It used to be excluded, on the reasoning that a Trip carried out and priced
 * is not tidied away. But a Trip created in error can be discovered after it
 * was closed, and the exclusion left no way to remove it at all — the record
 * stayed in every list permanently.
 *
 * The same soft delete applies, and it is exactly as reversible: the row is
 * kept, its pricing snapshot is kept, and restore brings it back. It comes back
 * OPEN rather than CLOSED, for the same reason a cancelled one does — the
 * previous status is recorded nowhere — and it can be closed again in one step.
 */
export const DELETABLE_FROM_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CANCELLED,
  TripStatus.CLOSED,
];

/**
 * The status a restored Trip returns to.
 *
 * OPEN, whatever it was deleted from — see the note above on what that costs.
 */
export const RESTORED_STATUS = TripStatus.OPEN;

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** The transitions available from a status. Used for actionable error messages. */
export function allowedTransitionsFrom(
  from: TripStatus,
): readonly TripStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * Statuses that occupy a Vehicle.
 *
 * A cancelled transport releases the vehicle, and a deleted record never held
 * it, so neither may block a new assignment.
 */
export const VEHICLE_OCCUPYING_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
];

/**
 * Statuses that hold on to a Booking Number.
 *
 * DELETED is excluded on purpose: the model describes soft delete as the remedy
 * for a Trip that "was created incorrectly or is a duplicate", so the deleted
 * record must not permanently block re-entering the same booking.
 */
export const BOOKING_NUMBER_HOLDING_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
  TripStatus.CANCELLED,
];
