import { request } from "./client";

/**
 * Sending a Trip's transport order to its driver over WhatsApp.
 *
 * Two calls, both narrow. There is deliberately no "send a message" function
 * here, because there is no such endpoint: the backend derives the driver, the
 * phone number and the document from the Trip itself, so the browser names a
 * Trip and nothing else. A client that could name a number and a file would be
 * a client that could message anyone.
 */

const TRIPS_PATH = "/api/v1/trips";
const WHATSAPP_PATH = "/api/v1/whatsapp";

/**
 * Whether WhatsApp can currently deliver anything.
 *
 * DISABLED means the feature is switched off in this environment, which is a
 * different sentence from an outage and deserves one.
 */
export type WhatsAppStatus =
  | "CONNECTED"
  | "CONNECTING"
  | "DISCONNECTED"
  | "PAIRING_REQUIRED"
  | "ERROR"
  | "DISABLED";

export interface SendPdfResult {
  /** Always true. A send that did not happen arrives as an error, not as false. */
  delivered: true;
  driverName: string;
  filename: string;
}

export function fetchWhatsAppStatus(): Promise<{ status: WhatsAppStatus }> {
  return request<{ status: WhatsAppStatus }>(`${WHATSAPP_PATH}/status`);
}

/**
 * Sends the latest applicable transport order to the Trip's effective driver.
 *
 * The Trip is not modified by this call, whether it succeeds or fails, so a
 * caller never needs to refetch the list afterwards.
 */
export function sendTripPdfOverWhatsApp(
  tripId: string,
): Promise<SendPdfResult> {
  return request<SendPdfResult>(`${TRIPS_PATH}/${tripId}/whatsapp/send-pdf`, {
    method: "POST",
  });
}

/**
 * The pairing state, for the administration screen.
 *
 * The QR is a short-lived challenge that WhatsApp reissues; it is never stored,
 * neither in the database nor in this browser. It arrives, it is drawn, and it
 * is replaced by the next one — or by nothing, once the account is linked.
 */
export interface WhatsAppPairing {
  status: WhatsAppStatus;
  /** Null unless the status is PAIRING_REQUIRED. */
  qr: string | null;
}

/**
 * Asks the backend for the pairing code.
 *
 * The browser can never reach the WhatsApp service itself: it publishes no port
 * and lives on an internal Docker network, which is exactly what keeps a code
 * that links a phone to the company account off the internet. The backend is
 * the bridge, and it checks the session on the way through.
 */
export function fetchWhatsAppPairing(
  signal?: AbortSignal,
): Promise<WhatsAppPairing> {
  return request<WhatsAppPairing>(`${WHATSAPP_PATH}/pairing`, { signal });
}
