"use client";

import { Badge, TONE_CLASSES } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/badge";
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
 * ── AND YET IT NOW CARRIES A COLOUR ─────────────────────────────────────────
 * Both states used `outline` for the reason above: `success` already means
 * CLOSED and `danger` already means CANCELLED, so a coloured payment marker can
 * be misread as a lifecycle one.
 *
 * That was overruled deliberately. Payment is what an operator scans a long
 * list for, and a row of identically outlined markers makes them read every
 * word. The tones come from the same semantic set as everywhere else — no new
 * palette — and the risk of confusion is reduced rather than ignored:
 *
 *   BETAALD       success, the settled state
 *   NIET BETAALD  warning, not danger — danger is CANCELLED, and an unpaid
 *                 Trip is something to chase, not something that went wrong
 *
 * The lifecycle badge still sits beside this one, so the two are read together
 * and the colour is a second signal rather than the only one.
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
  const tone: BadgeTone = trip.isPaid ? "success" : "warning";

  if (!onToggle) {
    return (
      <Badge tone={tone} className="font-semibold">
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
      /*
       * The same tone the badge wears, from the same table, so the display and
       * the control cannot end up different colours. Only the hover and the
       * disabled state are the button's own.
       */
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold hover:opacity-80 disabled:opacity-50 ${TONE_CLASSES[tone]}`}
    >
      {label}
    </button>
  );
}
