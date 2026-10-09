/**
 * What is remembered about each history entry: where it was scrolled to, and
 * which entry it was opened from.
 *
 * ── WHERE IT LIVES ──────────────────────────────────────────────────────────
 * In memory while the tab runs, mirrored to `sessionStorage` when the page is
 * left or hidden. Session storage because that is exactly the reach of the
 * history it describes: one tab, until it closes. A reload keeps the history
 * entries, so it has to keep this too; another tab has its own history and
 * must not see it. Nothing here belongs in `localStorage`.
 *
 * ── AND HOW IT STAYS SMALL ──────────────────────────────────────────────────
 * Only the most recently used entries are kept. An entry far back in the
 * history that is evicted simply opens at the top, as it does today.
 */

export interface ScrollOffset {
  readonly top: number;
  readonly left: number;
}

export interface EntryScroll {
  readonly window: ScrollOffset;
  /** By the id a scroll container declares — see `SCROLL_CONTAINER_ATTRIBUTE`. */
  readonly containers: Readonly<Record<string, ScrollOffset>>;
}

export interface EntryRecord {
  readonly url: string;
  /** The address of the entry this one was opened from, when it was pushed. */
  readonly openedFromUrl: string | null;
  readonly scroll: EntryScroll | null;
}

const STORAGE_KEY = "tms.navigation.entries";

/** Far more entries than anyone walks back through. */
export const MAX_REMEMBERED_ENTRIES = 50;

/** Insertion order is recency order: a touched entry is moved to the end. */
const entries = new Map<string, EntryRecord>();
let hasLoaded = false;

function load(): void {
  if (hasLoaded) {
    return;
  }

  hasLoaded = true;

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];

    if (Array.isArray(parsed)) {
      for (const [key, record] of parsed as [string, EntryRecord][]) {
        entries.set(key, record);
      }
    }
  } catch {
    // Storage blocked or a malformed value: the session simply starts empty,
    // which costs a restore and nothing else.
    entries.clear();
  }
}

export function readEntry(key: string): EntryRecord | null {
  load();

  return entries.get(key) ?? null;
}

export function writeEntry(key: string, record: EntryRecord): void {
  load();
  entries.delete(key);
  entries.set(key, record);

  while (entries.size > MAX_REMEMBERED_ENTRIES) {
    const oldest = entries.keys().next().value as string;
    entries.delete(oldest);
  }
}

/** Mirrors the entries to session storage; called when the page is left. */
export function persistEntries(): void {
  if (!hasLoaded) {
    return;
  }

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...entries]));
  } catch {
    // Quota or blocked storage: positions survive in memory for this page's
    // life, and only a reload would forget them.
  }
}

/** For tests: forget everything, in memory and in storage. */
export function resetEntryStore(): void {
  entries.clear();
  hasLoaded = false;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
