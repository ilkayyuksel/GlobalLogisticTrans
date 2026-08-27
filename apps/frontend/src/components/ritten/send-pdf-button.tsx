"use client";

import { useState } from "react";

import type { Trip } from "@/lib/api/types";
import type { WhatsAppStatus } from "@/lib/api/whatsapp";
import { useTranslation } from "@/lib/i18n/language-provider";
import {
  isSendVisible,
  sendUnavailableKey,
  sendUnavailableReason,
} from "@/lib/ritten/whatsapp-availability";

/**
 * "Versturen" — the transport order, to the driver, over WhatsApp.
 *
 * ── NO CONFIRMATION, DELIBERATELY ───────────────────────────────────────────
 * Sending a driver their own transport order is routine and reversible in the
 * only sense that matters: the worst outcome is a driver receiving the same PDF
 * twice. A dialog in front of it would be one people learn to dismiss without
 * reading, which then dismisses the delete dialog beside it too. Deleting asks;
 * this does not.
 *
 * ── ONE CLICK, ONE MESSAGE ──────────────────────────────────────────────────
 * The button disables itself for the duration of the request, so a second click
 * cannot produce a second WhatsApp message. That is in-flight protection only —
 * deliberately not a deduplication scheme, because two sends a minute apart are
 * a legitimate thing for an operator to want.
 *
 * ── WHY IT EXPLAINS ITSELF ──────────────────────────────────────────────────
 * A disabled button with no reason is worse than no button. When it cannot
 * send, the reason travels as `title` and `aria-describedby` — a driver with no
 * phone number, an unlinked WhatsApp — so the explanation reaches a mouse and a
 * screen reader without adding anything to a narrow row.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function SendPdfButton({
  trip,
  whatsAppStatus,
  isBusy,
  onSend,
}: {
  trip: Trip;
  whatsAppStatus: WhatsAppStatus;
  /** True while another action on this row is running. */
  isBusy: boolean;
  /** Resolves when the backend has answered. The page reports the outcome. */
  onSend: (trip: Trip) => Promise<void>;
}) {
  const t = useTranslation();
  const [isSending, setIsSending] = useState(false);

  /*
   * Hidden entirely for a status that will never send — a cancelled or deleted
   * Trip is not waiting for anything to be fixed, and a permanently dead
   * control in every such row is clutter rather than explanation.
   */
  if (!isSendVisible(trip)) {
    return null;
  }

  const reason = sendUnavailableReason(trip, whatsAppStatus);
  const explanation = reason
    ? t(sendUnavailableKey(reason, whatsAppStatus))
    : null;
  const isDisabled = isBusy || isSending || reason !== null;

  /*
   * The accessible name says what happens and to whom, because a column of
   * identical "Versturen" buttons is unusable read aloud. The visible label
   * stays one word: the column is narrow and the row says which Trip it is.
   */
  const accessibleName = trip.effectiveDriver
    ? t("ritten.whatsapp.actionFor").replace(
        "{driver}",
        trip.effectiveDriver.name,
      )
    : t("ritten.whatsapp.action");

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-label={accessibleName}
      title={explanation ?? undefined}
      aria-description={explanation ?? undefined}
      onClick={() => {
        setIsSending(true);

        /*
         * The page owns reporting the outcome and shows every failure in its
         * own feedback line. A button has no cell to keep open, so the
         * rejection ends here rather than becoming an unhandled promise — but
         * the busy state is cleared either way, or the row would stay stuck
         * after the first failure.
         */
        void Promise.resolve(onSend(trip))
          .catch(() => undefined)
          .finally(() => setIsSending(false));
      }}
      className="whitespace-nowrap rounded-md border border-success/40 px-2 py-1 text-xs font-medium text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {t(isSending ? "ritten.whatsapp.sending" : "ritten.whatsapp.send")}
    </button>
  );
}
