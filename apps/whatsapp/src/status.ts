/**
 * What this service can currently do, in the only vocabulary its callers need.
 *
 * ── WHY AN EXPLICIT STATUS AT ALL ───────────────────────────────────────────
 * WhatsApp Web is a long-lived socket that drops, reconnects and occasionally
 * needs a human with a phone. A caller that could only find out by trying would
 * have to send a real message to discover the connection is down, and TRANO
 * must never report a delivery that did not happen. So the connection says what
 * it is, and the button upstream can refuse cleanly instead of guessing.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const WhatsAppStatus = {
  /** Paired and online. Sending is possible. */
  CONNECTED: "CONNECTED",
  /** A socket is being opened, or a dropped one is being re-established. */
  CONNECTING: "CONNECTING",
  /** Offline with a session on disk. It will retry by itself. */
  DISCONNECTED: "DISCONNECTED",
  /**
   * There is no usable session: the account has never been paired, or WhatsApp
   * logged this device out. Only a person scanning the QR resolves it, so it is
   * deliberately distinct from DISCONNECTED — waiting will not fix it.
   */
  PAIRING_REQUIRED: "PAIRING_REQUIRED",
  /** The connection failed in a way retrying has not resolved. */
  ERROR: "ERROR",
} as const;

export type WhatsAppStatus =
  (typeof WhatsAppStatus)[keyof typeof WhatsAppStatus];

/** One PDF, addressed to one phone number. */
export interface SendDocumentRequest {
  /** Digits only, country code first. Validated by the caller — see the backend. */
  readonly phoneNumber: string;
  readonly filename: string;
  readonly caption: string;
  readonly content: Buffer;
}

/**
 * The WhatsApp account, as everything outside this service sees it.
 *
 * Baileys appears nowhere in this shape. That is the seam: replacing the
 * unofficial Web transport with the official Cloud API means writing another
 * implementation of these four methods and changing nothing else.
 */
export interface WhatsAppConnection {
  status(): WhatsAppStatus;
  /**
   * The QR string to be rendered for pairing, or null when none is pending.
   *
   * The QR is a short-lived pairing challenge, not a credential of the account:
   * it expires within seconds and is reissued. The session keys it produces are
   * the secret, and those never leave the volume.
   */
  pendingQrCode(): string | null;
  sendDocument(request: SendDocumentRequest): Promise<void>;
  close(): Promise<void>;
}

/** Raised when a send is refused before anything is transmitted. */
export class WhatsAppUnavailableError extends Error {
  constructor(readonly status: WhatsAppStatus) {
    super(`WhatsApp is not available for sending: ${status}`);
    this.name = "WhatsAppUnavailableError";
  }
}
