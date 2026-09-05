import {
  CloseAction,
  DisconnectCode,
  MAXIMUM_BACKOFF_MS,
  backoffDelayMs,
  decideAfterClose,
} from "./reconnect-policy";

/**
 * The decision that stops the daily QR code.
 *
 * ── THE BUG THESE TESTS EXIST FOR ───────────────────────────────────────────
 * The first implementation treated the socket closing as the whole story: one
 * hard-coded check for `loggedOut`, everything else a flat five-second retry,
 * and no way back once pairing was required. Two consequences followed.
 *
 * A `connectionReplaced` or a `badSession` was retried forever, which put two
 * sockets on the same session; WhatsApp resolves that fight by logging the
 * device out, and the operator finds a QR code in the morning.
 *
 * And a genuine logout set PAIRING_REQUIRED without ever opening a socket
 * again, so no QR was ever produced — the status said "scan" and there was
 * nothing to scan.
 *
 * So the rule is: RECONNECT unless WhatsApp SAID the credentials are dead.
 */
describe("deciding what a closed socket means", () => {
  describe("the ordinary drops, which must never cost a QR", () => {
    it.each([
      ["a closed stream", DisconnectCode.CONNECTION_CLOSED],
      ["a timeout", DisconnectCode.TIMED_OUT],
      ["a WhatsApp outage", DisconnectCode.UNAVAILABLE_SERVICE],
    ])("reconnects after %s", (_name, code) => {
      expect(decideAfterClose(code)).toBe(CloseAction.RECONNECT);
    });

    /** A plain network error carries no code at all. */
    it("reconnects when there is no code", () => {
      expect(decideAfterClose(null)).toBe(CloseAction.RECONNECT);
    });

    /**
     * The session is still valid — another connection simply took over. Making
     * this a pairing problem would throw away working credentials.
     */
    it("reconnects after the connection was replaced", () => {
      expect(decideAfterClose(DisconnectCode.CONNECTION_REPLACED)).toBe(
        CloseAction.RECONNECT,
      );
    });

    /**
     * The important default. A code this table has never seen must not be read
     * as a logout: guessing wrong costs a person a trip to their phone, while
     * guessing the other way costs one more reconnect.
     */
    it.each([0, 42, 499, 4_711])("reconnects after unknown code %s", (code) => {
      expect(decideAfterClose(code)).toBe(CloseAction.RECONNECT);
    });
  });

  /** Not a failure at all: WhatsApp asks for a fresh socket to finish login. */
  it("reopens immediately when a restart is required", () => {
    expect(decideAfterClose(DisconnectCode.RESTART_REQUIRED)).toBe(
      CloseAction.RECONNECT_NOW,
    );
  });

  describe("the only reasons that demand a new pairing", () => {
    it.each([
      ["the phone unlinked this device", DisconnectCode.LOGGED_OUT],
      ["the stored session no longer decrypts", DisconnectCode.BAD_SESSION],
      ["the account moved multi-device", DisconnectCode.MULTIDEVICE_MISMATCH],
    ])("requires pairing when %s", (_name, code) => {
      expect(decideAfterClose(code)).toBe(CloseAction.PAIRING_REQUIRED);
    });

    /** Exactly three, and no more. Everything else keeps the session. */
    it("demands pairing for no other code", () => {
      const demanding = [
        DisconnectCode.LOGGED_OUT,
        DisconnectCode.FORBIDDEN,
        DisconnectCode.TIMED_OUT,
        DisconnectCode.MULTIDEVICE_MISMATCH,
        DisconnectCode.CONNECTION_CLOSED,
        DisconnectCode.CONNECTION_REPLACED,
        DisconnectCode.BAD_SESSION,
        DisconnectCode.UNAVAILABLE_SERVICE,
        DisconnectCode.RESTART_REQUIRED,
      ].filter((code) => decideAfterClose(code) === CloseAction.PAIRING_REQUIRED);

      expect(demanding).toEqual([
        DisconnectCode.LOGGED_OUT,
        DisconnectCode.MULTIDEVICE_MISMATCH,
        DisconnectCode.BAD_SESSION,
      ]);
    });
  });

  /**
   * A blocked account, which used to stop the service permanently.
   *
   * It retries on the ordinary ladder now: a 403 can be a temporary
   * restriction, and a state only a container restart can leave is worse than
   * a retry every half minute.
   */
  it("keeps retrying when WhatsApp refuses the account", () => {
    expect(decideAfterClose(DisconnectCode.FORBIDDEN)).toBe(
      CloseAction.RECONNECT,
    );
  });

  /**
   * The QR window, which closes with the SAME 408 a dead network produces.
   *
   * The only thing that separates them is whether the socket got as far as
   * issuing a code, so that is the one fact the policy is given.
   */
  describe("an expired QR window", () => {
    it("reopens pairing when the socket had a QR on offer", () => {
      expect(
        decideAfterClose(DisconnectCode.TIMED_OUT, { qrOffered: true }),
      ).toBe(CloseAction.PAIRING_EXPIRED);
    });

    /** No code was ever shown, so this is a failure to connect. */
    it("keeps the ordinary backoff when no QR was offered", () => {
      expect(
        decideAfterClose(DisconnectCode.TIMED_OUT, { qrOffered: false }),
      ).toBe(CloseAction.RECONNECT);
    });

    /** Absent context means no QR, which is what a connected socket has. */
    it("keeps the ordinary backoff when nothing is known", () => {
      expect(decideAfterClose(DisconnectCode.TIMED_OUT)).toBe(
        CloseAction.RECONNECT,
      );
    });

    /**
     * A pending QR does not turn every close into a pairing rotation. A session
     * WhatsApp has invalidated still has to be cleared, even mid-pairing.
     */
    it.each([
      ["the phone unlinked this device", DisconnectCode.LOGGED_OUT],
      ["the stored session no longer decrypts", DisconnectCode.BAD_SESSION],
    ])("still demands pairing when %s", (_name, code) => {
      expect(decideAfterClose(code, { qrOffered: true })).toBe(
        CloseAction.PAIRING_REQUIRED,
      );
    });

    /** And a restart is still a restart, QR or no QR. */
    it("still reopens at once when a restart is required", () => {
      expect(
        decideAfterClose(DisconnectCode.RESTART_REQUIRED, { qrOffered: true }),
      ).toBe(CloseAction.RECONNECT_NOW);
    });
  });
});

describe("the reconnect backoff", () => {
  it("climbs 1s, 2s, 5s, 10s, 30s", () => {
    expect([0, 1, 2, 3, 4].map(backoffDelayMs)).toEqual([
      1_000, 2_000, 5_000, 10_000, 30_000,
    ]);
  });

  /** Bounded, so a long outage does not turn into an hourly poll. */
  it("stops climbing at the maximum", () => {
    expect(backoffDelayMs(5)).toBe(MAXIMUM_BACKOFF_MS);
    expect(backoffDelayMs(50)).toBe(MAXIMUM_BACKOFF_MS);
    expect(backoffDelayMs(5_000)).toBe(MAXIMUM_BACKOFF_MS);
  });

  /** Never zero: a tight loop would hammer WhatsApp and invite a block. */
  it("always waits at least a second", () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(backoffDelayMs(attempt)).toBeGreaterThanOrEqual(1_000);
    }
  });

  it("treats a negative count as the first attempt", () => {
    expect(backoffDelayMs(-3)).toBe(1_000);
  });
});
