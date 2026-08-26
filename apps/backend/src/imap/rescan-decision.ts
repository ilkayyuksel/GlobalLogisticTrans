import { EmailProcessingStatus, ImportedEmail } from "@prisma/client";

/**
 * What to do with an email the mailbox has offered again.
 *
 * ── THE BUG THIS REPLACES ───────────────────────────────────────────────────
 * Every message whose Message-ID was already in `imported_email` was skipped,
 * whatever its status. That was written when scanning filtered on the UNREAD
 * flag, where a failed message stayed unread and so came back on its own. Once
 * scanning moved to `SINCE today`, the flag stopped being what offered a
 * message again — and a FAILED row became a permanent refusal. A transport
 * order that failed once could never be imported, and nothing said so.
 *
 * ── WHY THIS IS A PURE FUNCTION ─────────────────────────────────────────────
 * It decides from a row and a clock, so every branch is testable without a
 * mailbox, a database or a scan. The scanner asks it and does what it says.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const RescanDecision = {
  /** No record: an email this system has never seen. */
  PROCESS_NEW: "PROCESS_NEW",
  /** Already imported successfully. Doing it again would duplicate Trips. */
  SKIP_PROCESSED: "SKIP_PROCESSED",
  /** Deliberately set aside — untrusted sender, unrecognised subject. */
  SKIP_IGNORED: "SKIP_IGNORED",
  /** Another scan is working on it right now. */
  SKIP_IN_FLIGHT: "SKIP_IN_FLIGHT",
  /** Failed, or abandoned mid-import. Try again, on the existing row. */
  RETRY: "RETRY",
} as const;

export type RescanDecision =
  (typeof RescanDecision)[keyof typeof RescanDecision];

/**
 * How long a PROCESSING row is believed to be a scan that is still running.
 *
 * ── WHY A THRESHOLD AT ALL ──────────────────────────────────────────────────
 * PROCESSING means "a scan started this and has not finished". Two very
 * different things produce it: a scan genuinely working on the message now, and
 * a process that died holding it. Retrying the first would import the same PDF
 * twice; never retrying the second strands the message exactly as the FAILED
 * bug did.
 *
 * ── WHY FIFTEEN MINUTES ─────────────────────────────────────────────────────
 * Polling runs every five minutes and a scan refuses to start while another is
 * running, so within one instance a PROCESSING row from a live scan cannot
 * survive into the next poll at all. Three intervals is the margin for a
 * second instance and for one slow download; beyond it, no scan that began this
 * work is still alive in any ordinary deployment.
 *
 * Deliberately not configurable. A knob here would be tuned by whoever last saw
 * a stuck row, and the value only makes sense against the poll interval.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const STALE_PROCESSING_MS = 15 * 60 * 1000;

/**
 * Decides what a scan should do with a message it has been offered.
 *
 * `known` is the row holding this Message-ID, or null. `now` is passed in so
 * the staleness comparison is a value rather than a hidden read of the clock.
 */
export function decideRescan(
  known: ImportedEmail | null,
  now: Date,
): RescanDecision {
  if (!known) {
    return RescanDecision.PROCESS_NEW;
  }

  switch (known.processingStatus) {
    case EmailProcessingStatus.PROCESSED:
      return RescanDecision.SKIP_PROCESSED;

    case EmailProcessingStatus.IGNORED:
      return RescanDecision.SKIP_IGNORED;

    case EmailProcessingStatus.FAILED:
      /*
       * The whole point. A failure is a state of OUR records, not a verdict on
       * the sender's document: a database that was down, a PDF that arrived
       * truncated, a route that was not configured yet. The message is still in
       * today's window, so it is still offered, so it is tried again.
       */
      return RescanDecision.RETRY;

    case EmailProcessingStatus.PROCESSING:
      return isStale(known, now)
        ? RescanDecision.RETRY
        : RescanDecision.SKIP_IN_FLIGHT;

    /*
     * RECEIVED is the column default and nothing writes it: a row is created
     * as PROCESSING or as IGNORED. If one ever appears it describes work that
     * was recorded and never begun, which is a retry for the same reason a
     * FAILED row is.
     */
    case EmailProcessingStatus.RECEIVED:
      return RescanDecision.RETRY;
  }
}

/**
 * Whether a PROCESSING row is too old to be a scan that is still running.
 *
 * `updatedAt` is the last time anything touched the row, which for a row still
 * in PROCESSING is when the attempt began. A crashed process leaves it exactly
 * where it was, so its age is the age of the abandoned attempt.
 */
function isStale(known: ImportedEmail, now: Date): boolean {
  return now.getTime() - known.updatedAt.getTime() >= STALE_PROCESSING_MS;
}
