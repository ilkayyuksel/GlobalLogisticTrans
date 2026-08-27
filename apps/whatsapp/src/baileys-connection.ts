import { mkdir, rm } from "node:fs/promises";

import type makeWASocket from "@whiskeysockets/baileys";
import type { useMultiFileAuthState, WASocket } from "@whiskeysockets/baileys";
import pino from "pino";

import { createCredentialWriter } from "./credential-writer";
import { toJid } from "./jid";
import {
  CloseAction,
  backoffDelayMs,
  decideAfterClose,
} from "./reconnect-policy";
import {
  WhatsAppStatus,
  WhatsAppUnavailableError,
  type SendDocumentRequest,
  type WhatsAppConnection,
} from "./status";

/**
 * The WhatsApp Web connection, and the ONLY file in TRANO that knows Baileys.
 *
 * ── WHY THE LIBRARY IS SEALED IN HERE ───────────────────────────────────────
 * This is an UNOFFICIAL integration: it drives WhatsApp Web the way a browser
 * would, which is not something WhatsApp supports and which can get a number
 * blocked. Baileys is imported nowhere else — not in the HTTP layer, not in the
 * backend, and certainly not in the Trip domain. Swapping to the official Cloud
 * API means writing another `WhatsAppConnection`.
 *
 * ── THE SESSION IS THE ACCOUNT, AND IT IS PRECIOUS ──────────────────────────
 * `useMultiFileAuthState` writes the pairing keys as files under the session
 * directory. Those files ARE the logged-in WhatsApp account. They survive
 * restarts, rebuilds and `docker compose down` because they live on a named
 * volume, and NOTHING in this file deletes them except the one branch where
 * WhatsApp has explicitly said they are dead — see `CloseAction`.
 *
 * `logout()` is never called anywhere. It would revoke the pairing, and an
 * ordinary restart would then cost somebody a trip to their phone.
 *
 * ── ONE SOCKET AT A TIME ────────────────────────────────────────────────────
 * Every socket is stamped with a generation number, and events from a socket
 * that is no longer the current one are ignored. Without that guard a closing
 * socket's late events schedule reconnects of their own, two sockets end up
 * live, WhatsApp replaces one with the other, and the resulting fight ends in a
 * genuine logout — which is exactly the daily-QR symptom this phase exists to
 * remove.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Baileys is chatty at info level and its logs would carry message content. */
const SILENT_LOGGER = pino({ level: "silent" });

/**
 * Baileys, loaded on FIRST USE rather than at module load.
 *
 * ── WHY LAZILY ──────────────────────────────────────────────────────────────
 * Baileys 7 ships as ESM. Node loads it happily, but the CommonJS test runner
 * cannot — so a static import at the top of this file would make the whole
 * module unloadable in a test, and the lifecycle below (reconnect, backoff,
 * session preservation, shutdown) is precisely what needs testing.
 *
 * Loading it here instead means a test that supplies its own socket factory
 * never touches the library at all, while production still gets the real one.
 */
type Baileys = {
  default: typeof makeWASocket;
  useMultiFileAuthState: typeof useMultiFileAuthState;
};

let loadedBaileys: Baileys | null = null;

async function resolveBaileys(): Promise<Baileys> {
  loadedBaileys ??= (await import("@whiskeysockets/baileys")) as unknown as Baileys;

  return loadedBaileys;
}

export interface ConnectionEvents {
  /** Called on every transition, for logging. Never receives credentials. */
  onStatusChange?: (status: WhatsAppStatus, detail: string | null) => void;
}

/** Seams for the tests, which drive the lifecycle without a real socket. */
export interface ConnectionDependencies {
  /** Creates a socket. Defaults to Baileys. */
  readonly createSocket?: typeof makeWASocket;
  /** Loads and persists the auth state. Defaults to Baileys. */
  readonly loadAuthState?: typeof useMultiFileAuthState;
  /** Schedules the reconnect. Defaults to `setTimeout`. */
  readonly schedule?: (run: () => void, delayMs: number) => NodeJS.Timeout;
  readonly cancel?: (timer: NodeJS.Timeout) => void;
}

/**
 * A connection that manages itself: it opens, it recovers, and it says what it
 * is doing.
 *
 * Returns as soon as the auth state is loaded — the socket comes up in the
 * background. That matters: the HTTP interface must be answering `/status` long
 * before WhatsApp is ready, because reading the status is how an operator finds
 * out that pairing is needed at all.
 */
export async function createBaileysConnection(
  sessionDirectory: string,
  events: ConnectionEvents = {},
  dependencies: ConnectionDependencies = {},
): Promise<WhatsAppConnection> {
  // Only reached when a caller did not supply its own, which in practice means
  // production. The tests inject both and never load the library.
  const needsBaileys =
    !dependencies.createSocket || !dependencies.loadAuthState;
  const baileys = needsBaileys ? await resolveBaileys() : null;

  const createSocket = dependencies.createSocket ?? baileys!.default;
  const loadAuthState =
    dependencies.loadAuthState ?? baileys!.useMultiFileAuthState;
  const schedule = dependencies.schedule ?? setTimeout;
  const cancel = dependencies.cancel ?? clearTimeout;

  await mkdir(sessionDirectory, { recursive: true });

  let auth = await loadAuthState(sessionDirectory);
  let credentials = createCredentialWriter(() => auth.saveCreds(), {
    onError: (errorName) =>
      report(WhatsAppStatus.ERROR, `the session could not be saved (${errorName})`),
  });

  let socket: WASocket | null = null;
  let status: WhatsAppStatus = WhatsAppStatus.CONNECTING;
  let pendingQr: string | null = null;
  let shuttingDown = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let consecutiveFailures = 0;

  /**
   * Which socket is current.
   *
   * Incremented every time a socket is created or abandoned, so a late event
   * from a previous socket can be recognised and dropped.
   */
  let generation = 0;

  function report(next: WhatsAppStatus, detail: string | null): void {
    // Only transitions are announced, so a reconnect ladder produces one line
    // per state change rather than a line per tick.
    if (status === next) {
      return;
    }

    status = next;
    events.onStatusChange?.(next, detail);
  }

  function cancelReconnect(): void {
    if (reconnectTimer) {
      cancel(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function open(): void {
    if (shuttingDown) {
      return;
    }

    cancelReconnect();

    const thisGeneration = ++generation;

    /*
     * PAIRING_REQUIRED is not downgraded to CONNECTING here.
     *
     * After an invalid session is cleared, a socket is opened purely to obtain
     * a fresh QR. Announcing CONNECTING for that half-second would take the
     * pairing notice off the operator's screen and put it back moments later,
     * and the thing they need to know has not changed: somebody has to scan.
     */
    if (status !== WhatsAppStatus.PAIRING_REQUIRED) {
      report(WhatsAppStatus.CONNECTING, "opening a connection");
    }

    socket = createSocket({
      auth: auth.state,
      logger: SILENT_LOGGER,
      // The pairing flow is an authenticated HTTP endpoint, never a line in a
      // container log that anyone with daemon access can read.
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });

    socket.ev.on("creds.update", () => {
      // Queued and serialised — see `credential-writer.ts` for why a bare
      // `void saveCreds()` loses sessions.
      credentials.save();
    });

    socket.ev.on("connection.update", (update) => {
      // A socket that has been superseded still emits. Its events describe a
      // connection nobody is using, and acting on them is what produces two
      // live sockets.
      if (thisGeneration !== generation) {
        return;
      }

      if (update.qr) {
        handleQr(update.qr);
      }

      if (update.connection === "open") {
        handleOpen();
      }

      if (update.connection === "close") {
        handleClose(statusCodeOf(update.lastDisconnect?.error));
      }
    });
  }

  /**
   * A QR code means WhatsApp does not recognise the credentials we presented.
   *
   * It is therefore the one signal that genuinely implies pairing — a socket
   * carrying a valid session is never offered one. This is deliberately the
   * ONLY place a transient disconnect could be mistaken for a pairing problem,
   * and it cannot be: no QR is emitted while the stored session works.
   */
  function handleQr(qr: string): void {
    pendingQr = qr;
    report(
      WhatsAppStatus.PAIRING_REQUIRED,
      "no valid session — a QR code is waiting to be scanned",
    );
  }

  function handleOpen(): void {
    pendingQr = null;
    // Reset here, not on the attempt: a link that drops once an hour should
    // always retry after one second rather than inheriting yesterday's ladder.
    consecutiveFailures = 0;
    report(WhatsAppStatus.CONNECTED, null);
  }

  /**
   * What a dropped socket means — decided by `decideAfterClose`, never by the
   * mere fact that the socket closed.
   */
  function handleClose(statusCode: number | null): void {
    socket = null;

    if (shuttingDown) {
      return;
    }

    switch (decideAfterClose(statusCode)) {
      case CloseAction.RECONNECT_NOW:
        // Part of the login handshake rather than a failure, so it does not
        // count against the backoff and does not wait.
        report(WhatsAppStatus.CONNECTING, "completing the login");
        open();

        return;

      case CloseAction.PAIRING_REQUIRED:
        void startFreshPairing(statusCode);

        return;

      case CloseAction.FATAL:
        pendingQr = null;
        report(
          WhatsAppStatus.ERROR,
          "WhatsApp refused this account; reconnecting will not help",
        );

        return;

      case CloseAction.RECONNECT:
      default:
        scheduleReconnect(statusCode);
    }
  }

  function scheduleReconnect(statusCode: number | null): void {
    const delayMs = backoffDelayMs(consecutiveFailures);

    consecutiveFailures += 1;

    report(
      WhatsAppStatus.DISCONNECTED,
      `the connection dropped (${statusCode ?? "network"}); retrying in ${Math.round(delayMs / 1000)}s`,
    );

    cancelReconnect();
    reconnectTimer = schedule(() => {
      reconnectTimer = null;
      open();
    }, delayMs);
  }

  /**
   * The ONE path that deletes the session.
   *
   * Reached only when WhatsApp has said the credentials are dead — a logout
   * from the phone, an unreadable session, a multi-device mismatch. Keeping the
   * dead files would be worse than useless: Baileys would present them, be
   * refused again, and no QR would ever appear.
   *
   * The auth state is reloaded from the now-empty directory and a fresh socket
   * is opened, which is what makes the new QR appear WITHOUT anybody having to
   * restart the container.
   */
  async function startFreshPairing(statusCode: number | null): Promise<void> {
    pendingQr = null;
    report(
      WhatsAppStatus.PAIRING_REQUIRED,
      `WhatsApp reported the session invalid (${statusCode ?? "unknown"}); a new pairing is needed`,
    );

    try {
      // Wait for any in-flight write, so a save cannot recreate what is about
      // to be removed.
      await credentials.flush();
      await rm(sessionDirectory, { recursive: true, force: true });
      await mkdir(sessionDirectory, { recursive: true });

      auth = await loadAuthState(sessionDirectory);
      credentials = createCredentialWriter(() => auth.saveCreds(), {
        onError: (errorName) =>
          report(
            WhatsAppStatus.ERROR,
            `the session could not be saved (${errorName})`,
          ),
      });
    } catch (error: unknown) {
      report(
        WhatsAppStatus.ERROR,
        `the invalid session could not be cleared (${error instanceof Error ? error.name : "UnknownError"})`,
      );

      return;
    }

    consecutiveFailures = 0;
    open();
  }

  open();

  return {
    status: () => status,

    /**
     * The QR, and only while pairing is genuinely required.
     *
     * Guarded by the status rather than by whether a string happens to be held,
     * so a stale code from an earlier pairing can never be shown during an
     * ordinary reconnect.
     */
    pendingQrCode: () =>
      status === WhatsAppStatus.PAIRING_REQUIRED ? pendingQr : null,

    async sendDocument(request: SendDocumentRequest): Promise<void> {
      /*
       * Checked before the send rather than after it fails. A message handed to
       * a closed socket can sit in Baileys' queue and resolve later, and TRANO
       * would report a delivery that never happened.
       *
       * Nothing is queued and nothing is retried after a reconnect: an operator
       * who was told a send failed will press the button again, and a message
       * that arrived by itself an hour later would be a surprise.
       */
      if (!socket || status !== WhatsAppStatus.CONNECTED) {
        throw new WhatsAppUnavailableError(status);
      }

      await socket.sendMessage(toJid(request.phoneNumber), {
        document: request.content,
        mimetype: "application/pdf",
        fileName: request.filename,
        caption: request.caption,
      });
    },

    /**
     * Stops cleanly WITHOUT touching the session.
     *
     * The order matters. Reconnects are stopped first and the generation is
     * advanced, so the socket's own close event cannot start a new attempt on
     * the way out. Then the last credential write is awaited — a write lost to
     * `process.exit` is the other way a session dies overnight.
     */
    async close(): Promise<void> {
      shuttingDown = true;
      generation += 1;

      cancelReconnect();

      socket?.end(undefined);
      socket = null;

      await credentials.flush();
    },
  };
}

/** The disconnect code Baileys wraps in a Boom error, when there is one. */
function statusCodeOf(error: unknown): number | null {
  const output = (error as { output?: { statusCode?: number } } | undefined)
    ?.output;

  return typeof output?.statusCode === "number" ? output.statusCode : null;
}
