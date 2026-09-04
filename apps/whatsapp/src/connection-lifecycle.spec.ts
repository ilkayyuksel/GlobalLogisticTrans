import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBaileysConnection } from "./baileys-connection";
import { DisconnectCode } from "./reconnect-policy";
import { WhatsAppStatus, type WhatsAppConnection } from "./status";

/**
 * The connection lifecycle, driven by a FAKE socket and a REAL session directory.
 *
 * ── WHY THIS SHAPE ──────────────────────────────────────────────────────────
 * The behaviour worth testing is entirely about what happens BETWEEN sockets:
 * whether a drop deletes the session, whether two reconnects can run at once,
 * whether shutdown cancels a pending retry. None of that needs WhatsApp, and a
 * test that needed a real account could never run in CI.
 *
 * So the socket factory and the timer are injected, and the events Baileys
 * would emit are emitted by hand. The session directory is a real temporary
 * directory, because "does a reconnect delete the credentials" is a question
 * about files and deserves to be answered with files.
 *
 * ── THE BUG ALL OF THIS EXISTS FOR ──────────────────────────────────────────
 * An operator was scanning a QR code every morning. A closed socket was being
 * read as a logged-out account, overlapping sockets were fighting over one
 * session until WhatsApp resolved it by logging the device out, and a
 * credential write could be lost to `process.exit` on shutdown.
 */

/** The events a socket hands back, recorded so a test can emit them. */
interface FakeSocket {
  emitConnectionUpdate: (update: Record<string, unknown>) => void;
  emitCredsUpdate: () => void;
  ended: boolean;
  sent: unknown[];
}

/** A Baileys-shaped socket that does nothing until a test tells it to. */
function createFakeSocketFactory() {
  const sockets: FakeSocket[] = [];

  const factory = jest.fn(() => {
    const handlers: Record<string, ((payload: never) => void)[]> = {};
    const socket: FakeSocket = {
      ended: false,
      sent: [],
      emitConnectionUpdate: (update) => {
        for (const handler of handlers["connection.update"] ?? []) {
          handler(update as never);
        }
      },
      emitCredsUpdate: () => {
        for (const handler of handlers["creds.update"] ?? []) {
          handler(undefined as never);
        }
      },
    };

    sockets.push(socket);

    return {
      ev: {
        on: (event: string, handler: (payload: never) => void) => {
          (handlers[event] ??= []).push(handler);
        },
      },
      end: () => {
        socket.ended = true;
      },
      sendMessage: (_jid: string, message: unknown) => {
        socket.sent.push(message);

        return Promise.resolve();
      },
    };
  });

  return { factory, sockets };
}

/** A controllable clock: a test decides when a scheduled reconnect runs. */
function createFakeScheduler() {
  const pending: {
    run: () => void;
    delayMs: number;
    cancelled: boolean;
    fired: boolean;
  }[] = [];

  return {
    pending,
    schedule: ((run: () => void, delayMs: number) => {
      const entry = { run, delayMs, cancelled: false, fired: false };
      pending.push(entry);

      return entry as unknown as NodeJS.Timeout;
    }) as never,
    cancel: ((timer: unknown) => {
      (timer as { cancelled: boolean }).cancelled = true;
    }) as never,
    /** Runs the most recently scheduled reconnect, if it is still armed. */
    runLatest(): void {
      const entry = pending[pending.length - 1];

      if (entry && !entry.cancelled && !entry.fired) {
        entry.fired = true;
        entry.run();
      }
    },
    /** Timers still waiting to fire — neither cancelled nor already run. */
    active(): number {
      return pending.filter((entry) => !entry.cancelled && !entry.fired).length;
    },
  };
}

/** A Baileys-shaped auth state backed by a real directory. */
function createFileAuthState(directory: string) {
  const credentialsPath = join(directory, "creds.json");
  let writes = 0;

  const loadAuthState = jest.fn(async (path: string) => {
    let existing: unknown = { note: "fresh" };

    try {
      existing = JSON.parse(await readFile(join(path, "creds.json"), "utf8"));
    } catch {
      // No session yet, which is what a first run looks like.
    }

    return {
      state: { creds: existing, keys: {} },
      saveCreds: async () => {
        writes += 1;
        await writeFile(
          credentialsPath,
          JSON.stringify({ note: "saved", writes }),
          "utf8",
        );
      },
    };
  });

  return { loadAuthState, credentialsPath, writes: () => writes };
}

async function sessionDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "trano-whatsapp-"));
}

describe("the WhatsApp connection lifecycle", () => {
  let directory: string;
  let sockets: FakeSocket[];
  let scheduler: ReturnType<typeof createFakeScheduler>;
  let auth: ReturnType<typeof createFileAuthState>;
  let statuses: { status: WhatsAppStatus; detail: string | null }[];
  let connection: WhatsAppConnection;

  async function start(): Promise<void> {
    const socketFactory = createFakeSocketFactory();
    sockets = socketFactory.sockets;
    scheduler = createFakeScheduler();
    auth = createFileAuthState(directory);
    statuses = [];

    connection = await createBaileysConnection(
      directory,
      {
        onStatusChange: (status, detail) => statuses.push({ status, detail }),
      },
      {
        createSocket: socketFactory.factory as never,
        loadAuthState: auth.loadAuthState as never,
        schedule: scheduler.schedule,
        cancel: scheduler.cancel,
      },
    );
  }

  /** The socket opens, WhatsApp accepts it, and the service is CONNECTED. */
  function connect(index = 0): void {
    sockets[index].emitConnectionUpdate({ connection: "open" });
  }

  function drop(index: number, statusCode: number | null): void {
    sockets[index].emitConnectionUpdate({
      connection: "close",
      lastDisconnect:
        statusCode === null
          ? { error: new Error("socket hang up") }
          : { error: { output: { statusCode } } },
    });
  }

  beforeEach(async () => {
    directory = await sessionDirectory();
    await start();
  });

  afterEach(async () => {
    await connection.close();
  });

  describe("an ordinary drop", () => {
    it("reconnects and comes back without a QR", async () => {
      connect();
      expect(connection.status()).toBe(WhatsAppStatus.CONNECTED);

      drop(0, DisconnectCode.CONNECTION_CLOSED);

      expect(connection.status()).toBe(WhatsAppStatus.DISCONNECTED);
      expect(connection.pendingQrCode()).toBeNull();

      scheduler.runLatest();
      expect(connection.status()).toBe(WhatsAppStatus.CONNECTING);

      connect(1);
      expect(connection.status()).toBe(WhatsAppStatus.CONNECTED);
      expect(connection.pendingQrCode()).toBeNull();
    });

    /** The whole point of the phase: a drop must not cost the credentials. */
    it("leaves the session files untouched", async () => {
      connect();
      sockets[0].emitCredsUpdate();
      await connection.close();
      const before = await readdir(directory);

      await start();
      connect();
      drop(0, DisconnectCode.CONNECTION_CLOSED);
      scheduler.runLatest();

      expect(await readdir(directory)).toEqual(before);
      expect(before).toContain("creds.json");
    });

    it.each([
      ["a timeout", DisconnectCode.TIMED_OUT],
      ["a WhatsApp outage", DisconnectCode.UNAVAILABLE_SERVICE],
      ["a replaced connection", DisconnectCode.CONNECTION_REPLACED],
      ["a bare network error", null],
    ])("recovers from %s without pairing", (_name, code) => {
      connect();

      drop(0, code as number | null);

      expect(connection.status()).toBe(WhatsAppStatus.DISCONNECTED);
      scheduler.runLatest();
      connect(1);
      expect(connection.status()).toBe(WhatsAppStatus.CONNECTED);
    });

    /** 1s, then 2s, then 5s — and back to 1s once a connection succeeds. */
    it("backs off between attempts and resets after a success", () => {
      connect();

      drop(0, DisconnectCode.CONNECTION_CLOSED);
      expect(scheduler.pending[0].delayMs).toBe(1_000);

      scheduler.runLatest();
      drop(1, DisconnectCode.CONNECTION_CLOSED);
      expect(scheduler.pending[1].delayMs).toBe(2_000);

      scheduler.runLatest();
      drop(2, DisconnectCode.CONNECTION_CLOSED);
      expect(scheduler.pending[2].delayMs).toBe(5_000);

      scheduler.runLatest();
      connect(3);
      drop(3, DisconnectCode.CONNECTION_CLOSED);
      expect(scheduler.pending[3].delayMs).toBe(1_000);
    });
  });

  /**
   * Two sockets on one session is how a working pairing dies: WhatsApp resolves
   * the conflict by logging the device out, and the morning brings a QR code.
   */
  describe("only one connection at a time", () => {
    it("ignores a late close from a socket that was replaced", () => {
      connect();
      drop(0, DisconnectCode.CONNECTION_CLOSED);
      scheduler.runLatest();

      // The abandoned socket finally reports its own close.
      drop(0, DisconnectCode.CONNECTION_CLOSED);

      expect(scheduler.active()).toBe(0);
      expect(sockets).toHaveLength(2);
    });

    it("never schedules two reconnects at once", () => {
      connect();

      drop(0, DisconnectCode.CONNECTION_CLOSED);
      drop(0, DisconnectCode.TIMED_OUT);
      drop(0, DisconnectCode.CONNECTION_CLOSED);

      expect(scheduler.active()).toBe(1);
    });

    it("opens exactly one socket per reconnect", () => {
      connect();

      for (let round = 0; round < 4; round += 1) {
        drop(round, DisconnectCode.CONNECTION_CLOSED);
        scheduler.runLatest();
      }

      expect(sockets).toHaveLength(5);
    });

    /** A late QR from an abandoned socket must not raise a pairing alarm. */
    it("ignores a QR from a socket that was replaced", () => {
      connect();
      drop(0, DisconnectCode.CONNECTION_CLOSED);
      scheduler.runLatest();
      connect(1);

      sockets[0].emitConnectionUpdate({ qr: "stale-qr" });

      expect(connection.status()).toBe(WhatsAppStatus.CONNECTED);
      expect(connection.pendingQrCode()).toBeNull();
    });
  });

  describe("a login that needs one more socket", () => {
    /** 515 is part of the handshake: reopen at once, and do not back off. */
    it("reopens immediately without scheduling a delay", () => {
      connect();

      drop(0, DisconnectCode.RESTART_REQUIRED);

      expect(scheduler.active()).toBe(0);
      expect(sockets).toHaveLength(2);
      expect(connection.status()).toBe(WhatsAppStatus.CONNECTING);
    });
  });

  describe("a session WhatsApp has invalidated", () => {
    it.each([
      ["the phone unlinked the device", DisconnectCode.LOGGED_OUT],
      ["the session no longer decrypts", DisconnectCode.BAD_SESSION],
    ])("clears the credentials and asks for a new pairing after %s", async (
      _name,
      code,
    ) => {
      connect();
      sockets[0].emitCredsUpdate();
      await connection.close();

      await start();
      connect();
      drop(0, code as number);

      /*
       * The status flips to PAIRING_REQUIRED before the files are removed —
       * deliberately, so an operator is told what is happening at once. The end
       * state is the fresh socket, which is opened only after the old session
       * has been cleared and a new auth state loaded.
       */
      await waitUntil(
        () => sockets.length > 1,
        "the invalid session to be cleared and a fresh socket opened",
      );

      expect(connection.status()).toBe(WhatsAppStatus.PAIRING_REQUIRED);
      expect(await readdir(directory)).not.toContain("creds.json");
    });

    /**
     * ── THE SESSION DIRECTORY ITSELF IS NEVER REMOVED ─────────────────────────
     * In production it is a Docker VOLUME mounted at `/app/session`, and a
     * recursive remove finishes by unlinking the directory it was given. The
     * kernel refuses to unlink a mount point:
     *
     *     EBUSY: resource busy or locked, rmdir '/app/session'
     *
     * The clear then threw, the dead credentials survived, no fresh socket was
     * opened and no QR was ever produced — with `error.name` reported as the
     * uninformative `Error`. Every test passed throughout, because a test
     * session directory is an ordinary `mkdtemp` folder that removes happily.
     *
     * A bind mount cannot be created inside a test, so this asserts the property
     * that makes the code mount-safe instead: the contents go, the directory
     * stays. Verified against a real Docker volume separately.
     */
    it("empties the session directory without removing it", async () => {
      await writeFile(join(directory, "creds.json"), "{}");
      await mkdir(join(directory, "keys"), { recursive: true });
      await writeFile(join(directory, "keys", "app-state.json"), "{}");

      /*
       * The identity of the directory, not merely its existence. Removing and
       * recreating it leaves a directory at the same PATH, so `stat` alone
       * cannot tell the two apart — but the inode changes, and on a mount point
       * the remove would not have been permitted at all.
       */
      const before = await stat(directory);

      connect();
      sockets[0].emitCredsUpdate();
      drop(0, DisconnectCode.LOGGED_OUT);

      await waitUntil(
        () => sockets.length > 1,
        "the invalid session to be cleared and a fresh socket opened",
      );

      const after = await stat(directory);

      expect(after.ino).toBe(before.ino);

      // And genuinely emptied, nested content included.
      expect(await readdir(directory)).toEqual([]);
    });

    /** A directory that is already empty is not an error to clear. */
    it("clears an empty session directory without complaint", async () => {
      connect();
      drop(0, DisconnectCode.LOGGED_OUT);

      await waitUntil(
        () => sockets.length > 1,
        "a fresh socket after clearing an already-empty directory",
      );

      expect(connection.status()).toBe(WhatsAppStatus.PAIRING_REQUIRED);
    });

    /**
     * The failure that made the old status useless: PAIRING_REQUIRED was set
     * and no socket was ever opened again, so no QR was ever produced. The
     * status said "scan" and there was nothing to scan.
     */
    it("opens a fresh socket so a QR can actually appear", async () => {
      connect();

      drop(0, DisconnectCode.LOGGED_OUT);
      await waitUntil(() => sockets.length > 1, "a fresh socket to be opened");

      sockets[sockets.length - 1].emitConnectionUpdate({ qr: "new-qr" });

      expect(connection.status()).toBe(WhatsAppStatus.PAIRING_REQUIRED);
      expect(connection.pendingQrCode()).toBe("new-qr");
    });

    /**
     * The pairing notice stays put while the fresh socket comes up. Flipping to
     * CONNECTING for half a second would take the instruction off the
     * operator's screen and put it straight back.
     */
    it("does not blink through CONNECTING while re-pairing", async () => {
      connect();

      drop(0, DisconnectCode.LOGGED_OUT);
      await waitUntil(() => sockets.length > 1, "a fresh socket to be opened");

      expect(connection.status()).toBe(WhatsAppStatus.PAIRING_REQUIRED);
      expect(
        statuses.filter((entry) => entry.status === WhatsAppStatus.CONNECTING),
      ).toHaveLength(0);
    });

    it("returns to CONNECTED once the new pairing is scanned", async () => {
      connect();
      drop(0, DisconnectCode.LOGGED_OUT);
      await waitUntil(() => sockets.length > 1, "a fresh socket to be opened");

      const fresh = sockets.length - 1;
      sockets[fresh].emitConnectionUpdate({ qr: "new-qr" });
      sockets[fresh].emitCredsUpdate();
      connect(fresh);

      expect(connection.status()).toBe(WhatsAppStatus.CONNECTED);
      expect(connection.pendingQrCode()).toBeNull();
    });
  });

  /** A blocked account: neither retrying nor re-pairing would help. */
  it("stops and reports an error when WhatsApp refuses the account", () => {
    connect();

    drop(0, DisconnectCode.FORBIDDEN);

    expect(connection.status()).toBe(WhatsAppStatus.ERROR);
    expect(scheduler.active()).toBe(0);
    expect(connection.pendingQrCode()).toBeNull();
  });

  describe("the QR is only offered when pairing is genuinely required", () => {
    it.each([
      WhatsAppStatus.CONNECTED,
      WhatsAppStatus.CONNECTING,
      WhatsAppStatus.DISCONNECTED,
    ])("returns no QR while %s", (status) => {
      connect();

      if (status === WhatsAppStatus.DISCONNECTED) {
        drop(0, DisconnectCode.CONNECTION_CLOSED);
      }

      if (status === WhatsAppStatus.CONNECTING) {
        drop(0, DisconnectCode.RESTART_REQUIRED);
      }

      expect(connection.status()).toBe(status);
      expect(connection.pendingQrCode()).toBeNull();
    });

    /** A first run with no session: this is the one case that shows a QR. */
    it("offers the QR on a first pairing", () => {
      sockets[0].emitConnectionUpdate({ qr: "first-qr" });

      expect(connection.status()).toBe(WhatsAppStatus.PAIRING_REQUIRED);
      expect(connection.pendingQrCode()).toBe("first-qr");
    });
  });

  describe("shutting down", () => {
    it("cancels a pending reconnect", async () => {
      connect();
      drop(0, DisconnectCode.CONNECTION_CLOSED);
      expect(scheduler.active()).toBe(1);

      await connection.close();

      expect(scheduler.active()).toBe(0);
    });

    it("opens no further sockets", async () => {
      connect();
      drop(0, DisconnectCode.CONNECTION_CLOSED);

      await connection.close();
      scheduler.runLatest();
      drop(0, DisconnectCode.CONNECTION_CLOSED);

      expect(sockets).toHaveLength(1);
    });

    /**
     * `end()` closes the websocket. `logout()` would revoke the pairing on
     * WhatsApp's side, and is never called anywhere in this service — which is
     * what makes an ordinary restart free.
     */
    it("closes the socket without logging out", async () => {
      connect();
      sockets[0].emitCredsUpdate();

      await connection.close();

      expect(sockets[0].ended).toBe(true);
      expect(await readdir(directory)).toContain("creds.json");
    });

    /** The other way a session dies: a write lost to `process.exit`. */
    it("waits for the last credential write to reach disk", async () => {
      connect();
      sockets[0].emitCredsUpdate();

      await connection.close();

      const saved = JSON.parse(await readFile(auth.credentialsPath, "utf8"));
      expect(saved).toMatchObject({ note: "saved" });
    });
  });

  describe("reusing a stored session", () => {
    /**
     * The requirement in one test: pair, destroy the service, start a new one,
     * and come up CONNECTED from the files on disk with no QR anywhere.
     */
    it("starts from the persisted credentials and needs no QR", async () => {
      sockets[0].emitConnectionUpdate({ qr: "first-qr" });
      sockets[0].emitCredsUpdate();
      connect();
      await connection.close();

      await start();

      expect(auth.loadAuthState).toHaveBeenCalledWith(directory);
      expect(connection.status()).toBe(WhatsAppStatus.CONNECTING);
      expect(connection.pendingQrCode()).toBeNull();

      connect();

      expect(connection.status()).toBe(WhatsAppStatus.CONNECTED);
      expect(connection.pendingQrCode()).toBeNull();
    });

    it("loads the credentials the previous run wrote", async () => {
      sockets[0].emitCredsUpdate();
      connect();
      await connection.close();

      const stored = JSON.parse(await readFile(auth.credentialsPath, "utf8"));

      await start();

      expect(stored).toMatchObject({ note: "saved" });
      expect(await readdir(directory)).toContain("creds.json");
    });
  });

  describe("sending", () => {
    it("is refused while reconnecting, and nothing is queued", async () => {
      connect();
      drop(0, DisconnectCode.CONNECTION_CLOSED);

      await expect(
        connection.sendDocument({
          phoneNumber: "32470112233",
          filename: "a.pdf",
          caption: "TRANO",
          content: Buffer.from("%PDF"),
        }),
      ).rejects.toThrow(/not available/i);

      scheduler.runLatest();
      connect(1);

      expect(sockets[1].sent).toHaveLength(0);
    });

    it("works again once the connection is back", async () => {
      connect();
      drop(0, DisconnectCode.CONNECTION_CLOSED);
      scheduler.runLatest();
      connect(1);

      await connection.sendDocument({
        phoneNumber: "32470112233",
        filename: "a.pdf",
        caption: "TRANO",
        content: Buffer.from("%PDF"),
      });

      expect(sockets[1].sent).toHaveLength(1);
    });
  });
});

/**
 * Waits for a condition the connection reaches asynchronously.
 *
 * Clearing an invalid session touches the real filesystem — `rm`, `mkdir`, then
 * reloading the auth state — so a handful of microtask ticks is not enough.
 * This polls on real timers instead, which is what those operations resolve on.
 */
async function waitUntil(
  condition: () => boolean,
  description: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`timed out waiting for ${description}`);
}
