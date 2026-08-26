import { ImapFlow } from "imapflow";

import { ImapMailboxSession } from "./imap-mailbox.client";

/**
 * What a normal poll asks the SERVER for.
 *
 * The criteria are the whole subject here, because they decide how much mail a
 * five-minute poll touches. Every other rule — trusted sender, subject prefix,
 * `imported_email` — runs afterwards on what came back, and none of them can
 * recover a message the search never returned.
 *
 * Only the fetch is faked: the session is constructed around it directly, so
 * the query asserted below is the one imapflow would put on the wire.
 */

interface FetchCall {
  readonly query: Record<string, unknown>;
  readonly options: Record<string, unknown>;
}

/**
 * A mailbox that records what it was asked, and answers with an empty folder.
 *
 * What came back does not matter to these tests — the query does, and it is
 * recorded before the iteration starts, exactly as imapflow would send it.
 */
function sessionRecording(calls: FetchCall[]): ImapMailboxSession {
  const client = {
    fetch(query: Record<string, unknown>, options: Record<string, unknown>) {
      calls.push({ query, options });

      return emptyFolder();
    },
  };

  return new ImapMailboxSession(client as unknown as ImapFlow);
}

async function* emptyFolder(): AsyncGenerator<never> {
  // Nothing arrived today. `yield*` over nothing keeps this a generator, which
  // is what the caller iterates.
  yield* [];
}

describe("ImapMailboxSession.findCandidates", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
  });

  it("asks the server for today's messages only", async () => {
    await sessionRecording(calls).findCandidates();

    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // SINCE is applied by the server, so yesterday's mail is never described,
    // listed or counted — a mailbox holding years of orders costs the same.
    expect(calls).toHaveLength(1);
    expect(calls[0].query.since).toEqual(midnight);
  });

  /**
   * The failure this replaced: a transport order that somebody opened in a mail
   * client before the next poll was `\Seen`, so `{ seen: false }` never
   * returned it and the order was lost with no trace anywhere.
   */
  it("does not filter on the unread flag", async () => {
    await sessionRecording(calls).findCandidates();

    expect(calls[0].query.seen).toBeUndefined();
  });

  /**
   * ── RETRYING NEVER REACHES INTO HISTORY ──────────────────────────────────
   * A failed message is retried because today's search keeps offering it, not
   * because anything looks for failures. So the window is the limit: a message
   * that failed yesterday is simply not returned any more, and the 38 rows
   * that failed in December 2023 can never be offered by a normal scan.
   *
   * Asserted as the ABSENCE of any widening criterion, because that is how a
   * recovery mode would arrive — an extra `before`, a `seen`, a date range.
   * ──────────────────────────────────────────────────────────────────────────
   */
  it("asks for no message older than today, whatever failed before", async () => {
    await sessionRecording(calls).findCandidates();

    const { query } = calls[0];
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);

    expect(Object.keys(query)).toEqual(["since"]);
    expect(query.since).toEqual(midnight);
    // Nothing that could reach back: no range, no flag, no status.
    expect(query.before).toBeUndefined();
    expect(query.sentSince).toBeUndefined();
    expect(query.all).toBeUndefined();
  });

  it("describes messages without downloading any attachment", async () => {
    await sessionRecording(calls).findCandidates();

    // Envelope and structure only: bytes are fetched per accepted message, and
    // asking for them here would download every PDF that arrived today.
    expect(calls[0].options).toEqual({
      uid: true,
      envelope: true,
      bodyStructure: true,
    });
  });
});
