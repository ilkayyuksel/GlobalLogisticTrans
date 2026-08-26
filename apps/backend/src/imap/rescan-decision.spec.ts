import { EmailProcessingStatus, ImportedEmail } from "@prisma/client";

import {
  RescanDecision,
  STALE_PROCESSING_MS,
  decideRescan,
} from "./rescan-decision";

/**
 * What a scan does with an email the mailbox offers again.
 *
 * ── THE BUG THESE TESTS EXIST FOR ───────────────────────────────────────────
 * Dedup skipped every Message-ID that already had a row, whatever its status.
 * That was correct while scanning filtered on the UNREAD flag — a failed
 * message stayed unread and came back by itself. Once scanning became
 * `SINCE today`, the flag stopped being what offered a message again, and a
 * FAILED row turned into a permanent refusal: a transport order that failed
 * once could never be imported, and nothing anywhere said so.
 *
 * So the status has to be read, not merely the existence of a row.
 * ────────────────────────────────────────────────────────────────────────────
 */

const NOW = new Date("2026-08-27T10:00:00.000Z");

function buildRow(overrides: Partial<ImportedEmail> = {}): ImportedEmail {
  return {
    id: "email-1",
    messageId: "<one@eucon.nl>",
    processingStatus: EmailProcessingStatus.FAILED,
    // Touched a minute ago unless a test says otherwise.
    updatedAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  } as unknown as ImportedEmail;
}

describe("deciding what to do with an email that is offered again", () => {
  it("processes one this system has never seen", () => {
    expect(decideRescan(null, NOW)).toBe(RescanDecision.PROCESS_NEW);
  });

  describe("an email that was already handled", () => {
    /** Importing it again would create the Trips a second time. */
    it("skips a PROCESSED email", () => {
      expect(
        decideRescan(
          buildRow({ processingStatus: EmailProcessingStatus.PROCESSED }),
          NOW,
        ),
      ).toBe(RescanDecision.SKIP_PROCESSED);
    });

    /** Set aside on purpose — an untrusted sender, an unrecognised subject. */
    it("skips an IGNORED email", () => {
      expect(
        decideRescan(
          buildRow({ processingStatus: EmailProcessingStatus.IGNORED }),
          NOW,
        ),
      ).toBe(RescanDecision.SKIP_IGNORED);
    });

    /** Both are final: re-deciding them every five minutes changes nothing. */
    it.each([EmailProcessingStatus.PROCESSED, EmailProcessingStatus.IGNORED])(
      "keeps skipping a %s email however old the row is",
      (processingStatus) => {
        const ancient = buildRow({
          processingStatus,
          updatedAt: new Date("2023-12-05T14:38:23.000Z"),
        });

        expect(decideRescan(ancient, NOW)).not.toBe(RescanDecision.RETRY);
      },
    );
  });

  /**
   * The fix. A failure describes the state of OUR records — a database that was
   * down, a truncated PDF, a route not configured yet — not a verdict on the
   * sender's document.
   */
  describe("an email that failed", () => {
    it("is retried", () => {
      expect(
        decideRescan(
          buildRow({ processingStatus: EmailProcessingStatus.FAILED }),
          NOW,
        ),
      ).toBe(RescanDecision.RETRY);
    });

    it("is retried however recently it failed", () => {
      expect(
        decideRescan(
          buildRow({
            processingStatus: EmailProcessingStatus.FAILED,
            updatedAt: NOW,
          }),
          NOW,
        ),
      ).toBe(RescanDecision.RETRY);
    });

    /**
     * No back-off and no attempt counter, deliberately. What limits the retries
     * is the SCAN WINDOW: the message is offered while it is in today's search
     * and stops being offered tomorrow. A counter would be a second, invisible
     * limit that could strand a message the window still offers.
     */
    it("is retried again after failing again", () => {
      const failedTwice = buildRow({
        processingStatus: EmailProcessingStatus.FAILED,
        updatedAt: new Date(NOW.getTime() - 5 * 60_000),
      });

      expect(decideRescan(failedTwice, NOW)).toBe(RescanDecision.RETRY);
    });
  });

  /**
   * PROCESSING means "a scan started this and has not finished". Retrying a
   * live one would import the same PDF twice; never retrying an abandoned one
   * strands the message exactly as the FAILED bug did. The row's age separates
   * them — see `STALE_PROCESSING_MS`.
   */
  describe("an email another scan may still be working on", () => {
    it("is left alone while the attempt is recent", () => {
      expect(
        decideRescan(
          buildRow({ processingStatus: EmailProcessingStatus.PROCESSING }),
          NOW,
        ),
      ).toBe(RescanDecision.SKIP_IN_FLIGHT);
    });

    it("is left alone right up to the threshold", () => {
      const justInside = buildRow({
        processingStatus: EmailProcessingStatus.PROCESSING,
        updatedAt: new Date(NOW.getTime() - STALE_PROCESSING_MS + 1_000),
      });

      expect(decideRescan(justInside, NOW)).toBe(RescanDecision.SKIP_IN_FLIGHT);
    });

    /** Past it, no scan that began this work is still alive. */
    it("is reclaimed once the attempt is stale", () => {
      const abandoned = buildRow({
        processingStatus: EmailProcessingStatus.PROCESSING,
        updatedAt: new Date(NOW.getTime() - STALE_PROCESSING_MS),
      });

      expect(decideRescan(abandoned, NOW)).toBe(RescanDecision.RETRY);
    });

    it("is reclaimed after a crash hours earlier", () => {
      const crashed = buildRow({
        processingStatus: EmailProcessingStatus.PROCESSING,
        updatedAt: new Date(NOW.getTime() - 6 * 60 * 60 * 1000),
      });

      expect(decideRescan(crashed, NOW)).toBe(RescanDecision.RETRY);
    });

    /** Three poll intervals: a live scan cannot survive that long unfinished. */
    it("waits three poll intervals before reclaiming", () => {
      expect(STALE_PROCESSING_MS).toBe(3 * 5 * 60 * 1000);
    });
  });

  /**
   * Nothing writes RECEIVED — a row is created as PROCESSING or as IGNORED.
   * One would describe work recorded and never begun, which is a retry for the
   * same reason a FAILED row is.
   */
  it("retries a row left at the column default", () => {
    expect(
      decideRescan(
        buildRow({ processingStatus: EmailProcessingStatus.RECEIVED }),
        NOW,
      ),
    ).toBe(RescanDecision.RETRY);
  });

  /**
   * Message-ID stays the key. Two messages with the same subject are two
   * messages, and one's outcome says nothing about the other.
   */
  it("decides per Message-ID, never per subject", () => {
    const processed = buildRow({
      messageId: "<first@eucon.nl>",
      processingStatus: EmailProcessingStatus.PROCESSED,
    });

    expect(decideRescan(processed, NOW)).toBe(RescanDecision.SKIP_PROCESSED);
    // The second message has no row of its own, whatever it is called.
    expect(decideRescan(null, NOW)).toBe(RescanDecision.PROCESS_NEW);
  });
});
