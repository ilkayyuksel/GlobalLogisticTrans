import { Fragment } from "../text/extract";
import { DocumentStatus } from "../types";

/**
 * Whether the document itself says the order is cancelled.
 *
 * ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
 * This is what the DOCUMENT states, and only that. It is not the action an
 * email asked for: a `CANCEL:` subject is an instruction from the sender, while
 * this is a stamp printed on the order. The two are separate concepts and are
 * kept separate — the parser never sees a subject, and nothing here reads a
 * filename.
 *
 * There is deliberately no UPDATE status. No real document carries a revision
 * marker of any kind; an update is an email action, and inventing a status the
 * documents do not print would be a guess.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── HOW IT IS DETECTED ──────────────────────────────────────────────────────
 * Every cancelled order prints `CANCELLED` on its own, in the page header,
 * directly under the `Page n of m` marker — on EVERY page. No other document
 * contains the word anywhere.
 *
 * The marker is anchored to that page marker rather than searched for across
 * the page, because "the word CANCELLED appears somewhere" would also match a
 * remark that merely mentions a cancellation. A stamp is a position as much as
 * a word.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The exact stamp. Matched whole, never as a substring. */
const CANCELLED_STAMP = "CANCELLED";

/** `Page 1 of 2` — the header line the stamp sits under. */
const PAGE_MARKER = /^Page \d+ of \d+$/;

/**
 * How far below the page marker the stamp may sit.
 *
 * The fixtures place it about 38 points lower, in the same header block. The
 * allowance is generous enough for a form whose header shifts slightly, and far
 * too small to reach the body of the order.
 */
const HEADER_BAND_HEIGHT = 60;

export function extractDocumentStatus(
  fragments: readonly Fragment[],
): DocumentStatus {
  const stamped = fragments.some(
    (fragment) =>
      fragment.text === CANCELLED_STAMP && isInPageHeader(fragments, fragment),
  );

  return stamped ? "CANCELLED" : "PLANNED";
}

function isInPageHeader(
  fragments: readonly Fragment[],
  candidate: Fragment,
): boolean {
  return fragments.some(
    (fragment) =>
      fragment.page === candidate.page &&
      PAGE_MARKER.test(fragment.text) &&
      candidate.y < fragment.y &&
      fragment.y - candidate.y <= HEADER_BAND_HEIGHT,
  );
}
