/**
 * What to do when the WhatsApp socket closes.
 *
 * ── WHY THIS IS A PURE MODULE ───────────────────────────────────────────────
 * It decides from a disconnect code and an attempt count, so every branch is
 * testable without a socket, a network or a WhatsApp account. Baileys is not
 * imported here — the numeric codes are duplicated as named constants below, so
 * this file stays loadable in a CommonJS test runner that cannot require an ESM
 * package. The duplicate is pinned to the real library at build time; see
 * `DisconnectCode`.
 *
 * ── THE RULE IT ENFORCES ────────────────────────────────────────────────────
 * A closed socket is NOT a logged-out account. Almost everything that closes a
 * WhatsApp Web connection is temporary — a dropped network, a server restart, a
 * timeout, a stream error — and the stored session remains perfectly valid
 * through all of it. Demanding a QR code for any of those is what makes an
 * operator scan one every morning.
 *
 * So the default is RECONNECT, and pairing is required only where WhatsApp has
 * SAID the credentials are dead. An unrecognised code reconnects, deliberately:
 * guessing "probably logged out" costs a person a trip to their phone, while
 * guessing "probably temporary" costs one more reconnect attempt.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Baileys' `DisconnectReason` values, by name.
 *
 * Copied rather than imported, because this module must stay loadable in a
 * CommonJS test runner and Baileys 7 is ESM-only. The duplicate is pinned to the
 * real library by `verify-disconnect-codes.cjs`, which runs against the actual
 * package during the Docker build — a renumbered reason fails the build rather
 * than leaving this file to silently decide the wrong thing.
 */
export const DisconnectCode = {
  /** 401 — the phone unlinked this device. The stored session is dead. */
  LOGGED_OUT: 401,
  /** 403 — the account is blocked or restricted by WhatsApp. */
  FORBIDDEN: 403,
  /** 408 — no response in time. Ordinary. */
  TIMED_OUT: 408,
  /** 411 — the account moved to a multi-device state this session predates. */
  MULTIDEVICE_MISMATCH: 411,
  /** 428 — the stream closed. By far the most common, and always temporary. */
  CONNECTION_CLOSED: 428,
  /** 440 — another connection took over this session. */
  CONNECTION_REPLACED: 440,
  /** 500 — the stored credentials no longer decrypt. */
  BAD_SESSION: 500,
  /** 503 — WhatsApp is unavailable. Theirs, not ours. */
  UNAVAILABLE_SERVICE: 503,
  /** 515 — part of the login handshake: reopen the socket at once. */
  RESTART_REQUIRED: 515,
} as const;

export const CloseAction = {
  /** Reopen after the backoff delay. The session on disk stays untouched. */
  RECONNECT: "RECONNECT",
  /**
   * Reopen IMMEDIATELY, with no delay and without counting as a failure.
   *
   * Only `restartRequired`, which is not a failure at all: WhatsApp asks for a
   * fresh socket to finish the login it just accepted. Waiting here is what
   * makes a freshly scanned QR appear to hang.
   */
  RECONNECT_NOW: "RECONNECT_NOW",
  /**
   * The stored credentials are dead. Clear them and produce a new QR.
   *
   * The ONLY action that ever deletes the session, and it is reached only when
   * WhatsApp has explicitly said the credentials are invalid.
   */
  PAIRING_REQUIRED: "PAIRING_REQUIRED",
  /**
   * Something a reconnect cannot fix and a QR would not fix either.
   *
   * A blocked account, for instance. Retrying would hammer WhatsApp and
   * re-pairing would fail, so this stops and says so rather than pretending
   * either would help.
   */
  FATAL: "FATAL",
} as const;

export type CloseAction = (typeof CloseAction)[keyof typeof CloseAction];

/**
 * The codes on which the stored session is genuinely worthless.
 *
 * Each one is WhatsApp telling us the credentials will not work again — not an
 * inference from the socket having closed. Nothing else clears the session.
 */
const PAIRING_CODES: readonly number[] = [
  DisconnectCode.LOGGED_OUT,
  DisconnectCode.BAD_SESSION,
  DisconnectCode.MULTIDEVICE_MISMATCH,
];

/** Decides what a close means. `null` covers a plain network error. */
export function decideAfterClose(statusCode: number | null): CloseAction {
  if (statusCode === DisconnectCode.RESTART_REQUIRED) {
    return CloseAction.RECONNECT_NOW;
  }

  if (statusCode === DisconnectCode.FORBIDDEN) {
    return CloseAction.FATAL;
  }

  if (statusCode !== null && PAIRING_CODES.includes(statusCode)) {
    return CloseAction.PAIRING_REQUIRED;
  }

  /*
   * Everything else reconnects, INCLUDING codes this table does not know.
   *
   * `connectionReplaced` is here on purpose. It means another connection took
   * over the session — the session itself is still valid, so it is not a
   * pairing problem. The backoff keeps a reconnect from turning into a fight
   * between two sockets.
   */
  return CloseAction.RECONNECT;
}

/**
 * How long to wait before the next attempt.
 *
 * The ladder is short at the start because most drops recover within seconds,
 * and it stops growing at half a minute because a service that has been down
 * for minutes should still notice the network returning promptly. It is a fixed
 * table rather than a formula so the sequence is legible and testable.
 */
const BACKOFF_LADDER_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

export const MAXIMUM_BACKOFF_MS = BACKOFF_LADDER_MS[BACKOFF_LADDER_MS.length - 1];

/**
 * The delay before attempt number `consecutiveFailures + 1`.
 *
 * Zero failures means the first retry after a working connection, which waits
 * the shortest step. The count is reset the moment a connection opens, so a
 * link that drops once an hour always retries after one second.
 */
export function backoffDelayMs(consecutiveFailures: number): number {
  const index = Math.min(
    Math.max(consecutiveFailures, 0),
    BACKOFF_LADDER_MS.length - 1,
  );

  return BACKOFF_LADDER_MS[index];
}
