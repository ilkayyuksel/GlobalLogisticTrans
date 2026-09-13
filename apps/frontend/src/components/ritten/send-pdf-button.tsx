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
import { RowActionButton, SendIcon } from "./row-action-button";

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
   * identical send buttons is unusable read aloud. The tooltip stays one word —
   * "Versturen" — because the row already says which Trip it is.
   */
  const accessibleName = trip.effectiveDriver
    ? t("ritten.whatsapp.actionFor").replace(
        "{driver}",
        trip.effectiveDriver.name,
      )
    : t("ritten.whatsapp.action");
  const word = t(isSending ? "ritten.whatsapp.sending" : "ritten.whatsapp.send");

  return (
    <RowActionButton
      tone="success"
      // When it cannot send, the reason is the more useful tooltip.
      tooltip={explanation ?? word}
      accessibleName={accessibleName}
      description={explanation ?? undefined}
      isDisabled={isDisabled}
      isBusy={isSending}
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
    >
      {isSending ? (
        <>
          {/* A spinner while the request runs; the word stays in its text. */}
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-success/30 border-t-success"
          />
          <span className="sr-only">{word}</span>
        </>
      ) : (
        <SendIcon />
      )}
    </RowActionButton>
  );
}
