/**
 * The seam between TRANO and WhatsApp.
 *
 * ── WHY THIS INTERFACE EXISTS ───────────────────────────────────────────────
 * TRANO sends transport orders to drivers over an UNOFFICIAL WhatsApp Web
 * integration, which is a deliberate first step and not the end state. The
 * official Cloud API is the intended replacement, and when it arrives the whole
 * change is one new implementation of this interface: a different `sendDocument`
 * and a different `status`.
 *
 * Everything above this line is domain code — Trips, drivers, transport orders
 * — and it knows only these two methods. Baileys is not a dependency of the
 * backend at all: it lives in its own service, behind HTTP, in its own
 * container. The Trip domain could not import it if it tried.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The Nest injection token. An interface has no runtime identity to inject by. */
export const WHATSAPP_SENDER = Symbol("WHATSAPP_SENDER");

/**
 * What the transport can currently do.
 *
 * Mirrors the delivery service's own vocabulary. DISABLED is this side's
 * addition: a deployment that has not switched WhatsApp on is a different fact
 * from one whose connection is down, and an operator should be told so rather
 * than shown a service that appears permanently broken.
 */
export const WhatsAppStatus = {
  CONNECTED: "CONNECTED",
  CONNECTING: "CONNECTING",
  DISCONNECTED: "DISCONNECTED",
  PAIRING_REQUIRED: "PAIRING_REQUIRED",
  ERROR: "ERROR",
  DISABLED: "DISABLED",
} as const;

export type WhatsAppStatus =
  (typeof WhatsAppStatus)[keyof typeof WhatsAppStatus];

/**
 * One document, addressed to one number.
 *
 * The BYTES travel, not a path and not a URL. A driver must receive the
 * transport order itself: a link would need an account, would expire, and would
 * be useless in a cab with no signal. Nothing in this shape names a file on
 * disk, and the delivery service has no filesystem access to use one with.
 */
export interface SendDocumentCommand {
  /** Digits only, country code first. Already validated — see the phone rules. */
  readonly phoneNumber: string;
  readonly filename: string;
  readonly caption: string;
  readonly content: Buffer;
}

/**
 * Why a send did not happen.
 *
 * A refusal rather than a thrown error, because every one of these is something
 * an operator is shown as a sentence. `NOT_CONNECTED` carries the status so the
 * message can distinguish "waiting to reconnect" from "somebody has to scan".
 */
export const SendFailure = {
  NOT_CONNECTED: "NOT_CONNECTED",
  /** The message was attempted and WhatsApp did not accept it. */
  SEND_FAILED: "SEND_FAILED",
  /** The delivery service could not be reached at all. */
  SERVICE_UNREACHABLE: "SERVICE_UNREACHABLE",
} as const;

export type SendFailure = (typeof SendFailure)[keyof typeof SendFailure];

export interface SendResult {
  readonly delivered: boolean;
  readonly failure: SendFailure | null;
  /** The transport's status at the moment of the attempt. */
  readonly status: WhatsAppStatus;
}

/**
 * What the pairing screen needs, and nothing else.
 *
 * The QR is a short-lived pairing CHALLENGE, not a credential of the account:
 * it expires within seconds and WhatsApp reissues it. The session keys it
 * produces are the secret, and those never leave the delivery service's volume.
 * Even so it is returned only to an authenticated TRANO user, because anyone
 * who scans it links THEIR phone to this company's account.
 */
export interface WhatsAppPairing {
  readonly status: WhatsAppStatus;
  /** Null unless pairing is genuinely required. Never a stale code. */
  readonly qr: string | null;
}

export interface WhatsAppSender {
  /**
   * Sends the document, or reports why it could not.
   *
   * NEVER reports a delivery that did not happen: `delivered` is true only when
   * the transport confirmed it accepted the message.
   */
  sendDocument(command: SendDocumentCommand): Promise<SendResult>;

  /** What the transport can currently do, for the UI to enable or explain. */
  status(): Promise<WhatsAppStatus>;

  /**
   * The status together with the pairing code, when one is waiting.
   *
   * Separate from `status()` because the two have different audiences and
   * different costs: every Ritten page asks for the status, and only the
   * pairing screen asks for a QR.
   */
  pairing(): Promise<WhatsAppPairing>;
}
