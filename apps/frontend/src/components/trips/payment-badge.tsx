"use client";

import { Badge } from "@/components/ui/badge";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * BETAALD / NIET BETAALD — whether a Trip has been paid.
 *
 * ── IT IS NOT A STATUS, AND MUST NOT LOOK LIKE ONE ──────────────────────────
 * The same reasoning as `LosritBadge`. Payment sits BESIDE the lifecycle badge
 * rather than instead of it, because the two answer different questions: one
 * says what has happened to the transport, the other says whether the money
 * arrived. A Trip is BETAALD or NIET BETAALD whether it is OPEN, CLOSED or
 * CANCELLED.
 *
 * So it borrows no lifecycle colour. In this design system `info` means OPEN,
 * `success` means CLOSED, `danger` means CANCELLED and `neutral` means DELETED
 * — a paid badge in green would read as "finished", an unpaid one in red as
 * "cancelled". Both states therefore use `outline`, the tone this system
 * reserves for markers that are not states, and the WORDS carry the meaning.
 * The difference between them is weight, never hue.
 *
 * ── WHY BOTH STATES ARE SHOWN ───────────────────────────────────────────────
 * Unlike LOSRIT, where an absent badge is the statement, "not paid yet" is
 * something an operator actively scans for. A row with nothing on it would be
 * indistinguishable from one whose badge failed to render.
 *
 * ── THE BADGE IS THE BUTTON ─────────────────────────────────────────────────
 * The same shape `LosritBadge` uses for its own control: the whole marker is
 * the toggle, so the row gains no second element and the thing you read is the
 * thing you click. It saves immediately and asks nothing first — this is a
 * routine, visible, instantly reversible change, and a dialog in front of one
 * is a dialog people learn to dismiss without reading.
 *
 * The accessible name says what the click will DO, not what the badge says.
 * "Betaald" as a button name would leave a screen-reader user guessing whether
 * they are about to set it or unset it.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function PaymentBadge({
  trip,
  onToggle,
  isDisabled,
}: {
  trip: Trip;
  /**
   * Flips the state. Absent where the badge is only being DISPLAYED, which is
   * why the control appears in the Ritten list and not on every screen that
   * shows a Trip.
   */
  onToggle?: (trip: Trip, isPaid: boolean) => void;
  isDisabled?: boolean;
}) {
  const t = useTranslation();

  const label = t(trip.isPaid ? "ritten.payment.paid" : "ritten.payment.unpaid");
  const tone = trip.isPaid ? "font-semibold text-foreground" : "text-muted";

  if (!onToggle) {
    return (
      <Badge tone="outline" className={tone}>
        {label}
      </Badge>
    );
  }

  const actionLabel = t(
    trip.isPaid ? "ritten.payment.markUnpaid" : "ritten.payment.markPaid",
  );

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => {
        /*
         * The page reports every failure in its own feedback line and rethrows
         * so an inline editor can keep its cell open. A badge has no cell to
         * keep open, so the rejection ends here rather than becoming an
         * unhandled promise.
         */
        void Promise.resolve(onToggle(trip, !trip.isPaid)).catch(
          () => undefined,
        );
      }}
      title={actionLabel}
      aria-label={`${actionLabel} ${trip.bookingNumber ?? trip.id}`}
      className={`inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium hover:bg-hover hover:text-foreground disabled:opacity-50 ${tone}`}
    >
      {label}
    </button>
  );
}
