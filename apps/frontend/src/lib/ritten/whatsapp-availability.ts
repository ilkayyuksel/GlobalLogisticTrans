import type { WhatsAppStatus } from "@/lib/api/whatsapp";
import type { Trip } from "@/lib/api/types";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Whether a row may offer to send its transport order, and why not when it may
 * not.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS IS A MIRROR OF THE BACKEND'S RULE, NOT A SECOND SOURCE OF TRUTH — the
 * same arrangement `trip-actions.ts` documents for lifecycle transitions. The
 * backend re-checks every condition below and refuses in its own words; this
 * exists so an operator is told WHY the button is unavailable instead of
 * pressing something that can only fail.
 *
 * If the two ever disagree, the backend wins and the refusal is displayed.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The statuses a transport order may be sent for. Mirrors SENDABLE_STATUSES.
 *
 * CANCELLED is absent deliberately. A cancelled transport was called off, and
 * the only way out of CANCELLED is back to OPEN — so sending a driver the order
 * would say it is happening again, which is a decision about the day's work
 * rather than a side effect of pressing a button. It is reopened first.
 */
const SENDABLE_STATUSES: readonly Trip["status"][] = ["OPEN", "CLOSED"];

export const SendUnavailableReason = {
  WRONG_STATUS: "WRONG_STATUS",
  NO_DRIVER: "NO_DRIVER",
  NO_PHONE_NUMBER: "NO_PHONE_NUMBER",
  NO_DOCUMENT: "NO_DOCUMENT",
  WHATSAPP_UNAVAILABLE: "WHATSAPP_UNAVAILABLE",
} as const;

export type SendUnavailableReason =
  (typeof SendUnavailableReason)[keyof typeof SendUnavailableReason];

/**
 * The sentence shown as the button's accessible description.
 *
 * Operational reasons, never technical ones: "WhatsApp is niet verbonden" is
 * something an operator can act on, and a status code in a row is not.
 */
export const SEND_UNAVAILABLE_KEYS: Record<
  SendUnavailableReason,
  TranslationKey
> = {
  WRONG_STATUS: "ritten.whatsapp.unavailable.status",
  NO_DRIVER: "ritten.whatsapp.unavailable.noDriver",
  NO_PHONE_NUMBER: "ritten.whatsapp.unavailable.noPhone",
  NO_DOCUMENT: "ritten.whatsapp.unavailable.noDocument",
  // Replaced per status by `WHATSAPP_STATUS_KEYS` — a connection that is coming
  // back by itself and one that needs a person are different situations.
  WHATSAPP_UNAVAILABLE: "ritten.whatsapp.status.disconnected",
};

/**
 * What each connection state means to the operator looking at the row.
 *
 * ── WHY THESE ARE NOT ONE SENTENCE ──────────────────────────────────────────
 * They used to be: every state that was not CONNECTED said "WhatsApp is niet
 * verbonden". That reads as a fault in all four cases, and only one of them is.
 * A reconnecting service needs no action at all — it is back within seconds —
 * whereas PAIRING_REQUIRED needs somebody to walk over with a phone. Telling an
 * operator to scan a QR code for a two-second network blip is exactly the habit
 * this phase set out to remove.
 */
export const WHATSAPP_STATUS_KEYS: Record<WhatsAppStatus, TranslationKey> = {
  CONNECTED: "ritten.whatsapp.status.connected",
  CONNECTING: "ritten.whatsapp.status.connecting",
  DISCONNECTED: "ritten.whatsapp.status.disconnected",
  PAIRING_REQUIRED: "ritten.whatsapp.status.pairingRequired",
  ERROR: "ritten.whatsapp.status.error",
  DISABLED: "ritten.whatsapp.status.disabled",
};

/**
 * The sentence explaining why this row cannot send.
 *
 * For everything except a WhatsApp outage the reason is about the Trip, and it
 * is the same whatever the connection is doing. For an outage it is the
 * CONNECTION's own state that matters, so that is what is shown.
 */
export function sendUnavailableKey(
  reason: SendUnavailableReason,
  whatsAppStatus: WhatsAppStatus,
): TranslationKey {
  return reason === SendUnavailableReason.WHATSAPP_UNAVAILABLE
    ? WHATSAPP_STATUS_KEYS[whatsAppStatus]
    : SEND_UNAVAILABLE_KEYS[reason];
}

/**
 * Why this row cannot send, or null when it can.
 *
 * ── THE ORDER OF THE CHECKS IS THE MESSAGE ──────────────────────────────────
 * A CANCELLED Trip with no driver is reported as cancelled, because that is
 * what an operator would fix first. WhatsApp being down is checked LAST, so a
 * row that could never send says so for its own reason rather than blaming a
 * connection that is not the problem.
 */
export function sendUnavailableReason(
  trip: Trip,
  whatsAppStatus: WhatsAppStatus,
): SendUnavailableReason | null {
  if (!SENDABLE_STATUSES.includes(trip.status)) {
    return SendUnavailableReason.WRONG_STATUS;
  }

  if (!trip.effectiveDriver) {
    return SendUnavailableReason.NO_DRIVER;
  }

  if (!trip.effectiveDriver.hasPhoneNumber) {
    return SendUnavailableReason.NO_PHONE_NUMBER;
  }

  /*
   * The Trip's own source document. A Trip created by hand has none, and the
   * backend would then find no applied UPDATE either — which is exactly the
   * case where there is nothing to send. A Trip that HAS a source document
   * always has something sendable, so this one field answers the question.
   */
  if (!trip.pdfDocumentId) {
    return SendUnavailableReason.NO_DOCUMENT;
  }

  if (whatsAppStatus !== "CONNECTED") {
    return SendUnavailableReason.WHATSAPP_UNAVAILABLE;
  }

  return null;
}

/**
 * Whether the button appears at all.
 *
 * It is SHOWN but disabled for a row that could send if something were fixed —
 * a missing phone number, a WhatsApp outage — because that is information an
 * operator wants. It is HIDDEN entirely for a status that will never send: a
 * cancelled or deleted Trip is not waiting for anything, and a permanently
 * disabled control in every such row is clutter rather than explanation.
 */
export function isSendVisible(trip: Trip): boolean {
  return SENDABLE_STATUSES.includes(trip.status);
}
