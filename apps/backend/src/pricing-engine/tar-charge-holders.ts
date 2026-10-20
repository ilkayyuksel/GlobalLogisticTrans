import { TripStatus } from "@prisma/client";

/**
 * WHO HOLDS a TAR-nummer's automatic charge for one day — the rule alone,
 * without a query, so the database read and every test read decide it the
 * same way.
 *
 * ── THE RULE, AS THE BUSINESS FIXED IT ──────────────────────────────────────
 * One number is charged automatically once a day, on the first Trip priced
 * with it. A Trip holds the charge when its stored snapshot carries an
 * AUTOMATIC TAR line (`trip_pricing_item.is_automatic`) — an operator's manual
 * TAR is an extra and never holds it.
 *
 *   CANCELLED and DELETED Trips hold nothing: that transport did not incur it.
 *   A FAILED snapshot holds nothing: it is nobody's price (`current-pricing.ts`).
 *   A REOPENED Trip still holds its charge — its snapshot is a real charge
 *     until something replaces it; dropping it would let a second Trip take the
 *     TAR while the first, already invoiced, still has it.
 *
 * ── UNTIL SOMETHING REPLACES IT (owner, 20 October 2026) ────────────────────
 * "Something replaces it" is a CLOSED Trip charged LATER than that snapshot. A
 * CLOSED Trip can only have been charged while the earlier holder did not hold
 * it — it was cancelled or deleted and has come back, or it let the number go
 * — so the earlier, non-CLOSED snapshot no longer counts. Without this, a
 * cancelled Trip brought back would revive its old charge, and the Trip that
 * had rightly taken it would lose it at its next repricing.
 *
 * ── EXACTLY ONE ─────────────────────────────────────────────────────────────
 * Two Trips priced at the same moment can each find the number free and both
 * store a charge. Of the valid holders, the first priced — earliest
 * `calculated_at`, then the lower Trip id — keeps it; every other must be
 * priced again, and then finds it taken (`TarChargeSettlement`).
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A Trip whose stored snapshot carries an automatic TAR line for the day. */
export interface TarHolder {
  readonly tripId: string;
  readonly status: TripStatus;
  /** When the snapshot's calculation started — what "first priced" means. */
  readonly calculatedAt: Date;
}

/** The holders whose charge still counts — see "until something replaces it". */
export function validTarHolders(holders: readonly TarHolder[]): TarHolder[] {
  const closed = holders.filter((holder) => holder.status === TripStatus.CLOSED);

  return holders.filter(
    (holder) =>
      holder.status === TripStatus.CLOSED ||
      !closed.some((other) => other.calculatedAt.getTime() > holder.calculatedAt.getTime()),
  );
}

/** Whether a Trip other than `tripId` holds the day's charge. */
export function isHeldByAnother(holders: readonly TarHolder[], tripId: string): boolean {
  return validTarHolders(holders).some((holder) => holder.tripId !== tripId);
}

/**
 * The CLOSED holders that must give the charge up: all but the first priced.
 * Empty when one Trip, or none, holds it.
 */
export function surplusTarHolders(holders: readonly TarHolder[]): string[] {
  const closed = validTarHolders(holders)
    .filter((holder) => holder.status === TripStatus.CLOSED)
    .sort(
      (left, right) =>
        left.calculatedAt.getTime() - right.calculatedAt.getTime() ||
        left.tripId.localeCompare(right.tripId),
    );

  return closed.slice(1).map((holder) => holder.tripId);
}
