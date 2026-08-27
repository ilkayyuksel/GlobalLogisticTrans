/**
 * Persisting the WhatsApp credentials, reliably.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ──────────────────────────────────────
 * Baileys emits `creds.update` often, and the obvious handler is
 * `() => void saveCreds()`. That is fire-and-forget, and it fails in two ways
 * that both end with an operator scanning a QR code in the morning:
 *
 *   OVERLAPPING WRITES — two updates in quick succession run two writes over
 *     the same file at once. `useMultiFileAuthState` writes with a plain
 *     `writeFile`, so the second can interleave with the first and leave
 *     `creds.json` holding a mixture of two states, which will not parse.
 *
 *   A WRITE LOST TO SHUTDOWN — SIGTERM arrives, the process exits, and a write
 *     that had not reached disk simply never happens. Worse, a write that was
 *     PART WAY through leaves a truncated file. Either way the next start finds
 *     credentials it cannot load and asks to be paired again.
 *
 * ── WHAT THIS DOES ABOUT IT ─────────────────────────────────────────────────
 * Writes are SERIALISED onto a single promise chain, so two never run at once,
 * and `flush()` returns that chain — so shutdown can wait for the last write to
 * finish before the process exits.
 *
 * It never inspects, copies or logs what it is writing. The credentials pass
 * straight through to Baileys' own writer.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface CredentialWriter {
  /** Queues a save. Returns at once; the write happens in order. */
  save(): void;
  /** Resolves when every queued write has finished. */
  flush(): Promise<void>;
  /** How many saves have completed. For tests and for a shutdown log line. */
  completed(): number;
}

export interface CredentialWriterEvents {
  /**
   * A save failed.
   *
   * Receives the error's TYPE only — never its message, which for a filesystem
   * error carries the path of the session directory.
   */
  onError?: (errorName: string) => void;
}

/**
 * Serialises calls to Baileys' `saveCreds`.
 *
 * A failed write does not break the chain: the next `creds.update` will write
 * the newer state anyway, and rejecting the shared promise would make `flush()`
 * throw during shutdown for a write that has since been superseded.
 */
export function createCredentialWriter(
  saveCreds: () => Promise<void>,
  events: CredentialWriterEvents = {},
): CredentialWriter {
  let chain: Promise<void> = Promise.resolve();
  let completedWrites = 0;

  return {
    save(): void {
      chain = chain.then(async () => {
        try {
          await saveCreds();
          completedWrites += 1;
        } catch (error: unknown) {
          events.onError?.(
            error instanceof Error ? error.name : "UnknownError",
          );
        }
      });
    },

    flush(): Promise<void> {
      return chain;
    },

    completed(): number {
      return completedWrites;
    },
  };
}
