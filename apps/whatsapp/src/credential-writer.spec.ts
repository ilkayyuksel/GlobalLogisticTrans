import { createCredentialWriter } from "./credential-writer";

/**
 * Persisting the credentials without losing them.
 *
 * ── THE TWO FAILURES THESE TESTS PIN ────────────────────────────────────────
 * The original handler was `() => void saveCreds()`, which loses sessions in
 * two ways. Two updates in quick succession ran two writes over the same file
 * at once, and either could win — leaving a mixture that will not parse. And a
 * write still in flight when the process exited simply never landed, or landed
 * truncated. Both end with a QR code on somebody's desk in the morning.
 */
describe("writing the WhatsApp credentials", () => {
  /** Two saves must never overlap: interleaved writes corrupt the file. */
  it("never runs two writes at the same time", async () => {
    let running = 0;
    let maximumConcurrent = 0;
    const writer = createCredentialWriter(async () => {
      running += 1;
      maximumConcurrent = Math.max(maximumConcurrent, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    });

    writer.save();
    writer.save();
    writer.save();
    await writer.flush();

    expect(maximumConcurrent).toBe(1);
    expect(writer.completed()).toBe(3);
  });

  it("writes in the order the updates arrived", async () => {
    const order: number[] = [];
    let next = 0;
    const writer = createCredentialWriter(async () => {
      const mine = ++next;
      await new Promise((resolve) => setTimeout(resolve, 5 - mine));
      order.push(mine);
    });

    writer.save();
    writer.save();
    writer.save();
    await writer.flush();

    expect(order).toEqual([1, 2, 3]);
  });

  /** The shutdown guarantee: flush resolves only once the disk has the data. */
  it("flush waits for a write that is still running", async () => {
    let finished = false;
    const writer = createCredentialWriter(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
    });

    writer.save();
    expect(finished).toBe(false);

    await writer.flush();

    expect(finished).toBe(true);
  });

  it("flush resolves immediately when nothing is queued", async () => {
    const writer = createCredentialWriter(async () => undefined);

    await expect(writer.flush()).resolves.toBeUndefined();
    expect(writer.completed()).toBe(0);
  });

  describe("when a write fails", () => {
    /**
     * A failed write must not break the chain. The next `creds.update` writes
     * the newer state anyway, and a rejected shared promise would make shutdown
     * throw for a write that has since been superseded.
     */
    it("keeps accepting later writes", async () => {
      let attempt = 0;
      const writer = createCredentialWriter(async () => {
        attempt += 1;

        if (attempt === 1) {
          throw new Error("disk full");
        }
      });

      writer.save();
      writer.save();
      await writer.flush();

      expect(attempt).toBe(2);
      expect(writer.completed()).toBe(1);
    });

    it("does not reject the flush that shutdown awaits", async () => {
      const writer = createCredentialWriter(async () => {
        throw new Error("disk full");
      });

      writer.save();

      await expect(writer.flush()).resolves.toBeUndefined();
    });

    /** A filesystem error's message carries the session path. Only the type. */
    it("reports the failure type and never its message", async () => {
      const reported: string[] = [];
      const writer = createCredentialWriter(
        async () => {
          throw new Error("EACCES: permission denied, open '/app/session/creds.json'");
        },
        { onError: (errorName) => reported.push(errorName) },
      );

      writer.save();
      await writer.flush();

      expect(reported).toEqual(["Error"]);
      expect(reported.join()).not.toContain("/app/session");
    });
  });

  /** It hands the credentials to Baileys' own writer and never inspects them. */
  it("passes nothing of its own to the writer", async () => {
    const saveCreds = jest.fn(async () => undefined);
    const writer = createCredentialWriter(saveCreds);

    writer.save();
    await writer.flush();

    expect(saveCreds).toHaveBeenCalledWith();
  });
});
