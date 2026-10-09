import { persistEntries, readEntry, writeEntry } from "./entry-store";
import {
  createEntryKey,
  currentUrl,
  readEntryKey,
  stampEntryKey,
} from "./history-entry";
import { readScroll } from "./scroll-positions";
import { restoreScroll } from "./scroll-restorer";

/**
 * The application's one scroll-restoration mechanism.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *
 *   while a page is shown     its scroll positions are recorded for its entry
 *   Back / Forward            the entry returned to gets its positions back
 *   a reload                  the same, as the browser itself would do
 *   any other navigation      nothing: a page opened anew starts at the top,
 *                             which the router already does
 *
 * A refetch, a checkbox, a deletion or an inline edit is not a navigation, so
 * none of them triggers anything here — the page keeps whatever position the
 * browser gives it, exactly as before.
 *
 * ── WHY THE BROWSER'S OWN RESTORATION IS SWITCHED OFF ───────────────────────
 * It restores at the moment of `popstate`, when the page coming back still
 * shows "Laden…" — so a position 3,800 pixels down is cut to the bottom of a
 * loading placeholder, and the list then renders from the top. Two mechanisms
 * would also fight over the same scroll. `history.scrollRestoration` is
 * therefore `manual`, and this is the only code that restores.
 */
export class ScrollTracker {
  private current: { key: string; url: string } | null = null;
  /** Between `popstate` and the router showing the entry it went to. */
  private isTraversing = false;
  private cancelRestore: (() => void) | null = null;
  private frame: number | null = null;

  /** Starts listening. Returns the call that stops it. */
  start(): () => void {
    window.history.scrollRestoration = "manual";

    const onScroll = () => this.scheduleRecord();
    const onPopState = () => this.traverseStarted();
    const onLeave = () => persistEntries();

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onLeave);

    this.syncEntry();

    if (isReload()) {
      this.restoreCurrentEntry();
    }

    return () => {
      this.cancelRestore?.();
      if (this.frame !== null) {
        window.cancelAnimationFrame(this.frame);
      }
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onLeave);
      persistEntries();
    };
  }

  /** Called once the router has rendered a new address. */
  routeChanged(): void {
    this.syncEntry();
    persistEntries();

    if (this.isTraversing) {
      this.isTraversing = false;
      this.restoreCurrentEntry();
    }
  }

  private traverseStarted(): void {
    this.cancelRestore?.();
    persistEntries();

    // Back to an entry with this very address: no render will follow, so the
    // entry is already the one on screen.
    if (this.current && this.current.url === currentUrl()) {
      this.syncEntry();
      this.restoreCurrentEntry();

      return;
    }

    this.isTraversing = true;
  }

  /**
   * Which entry is on screen, giving it a key when it has none.
   *
   * No key and the same address as a moment ago: the router rewrote this
   * entry's state and dropped our key, so it gets the same one back. No key
   * and a new address: a push — a new entry, opened from the one before it.
   */
  private syncEntry(): string {
    const url = currentUrl();
    let key = readEntryKey();

    if (key === null) {
      const isSameEntry =
        this.current !== null && this.current.url === url && !this.isTraversing;
      key = isSameEntry && this.current ? this.current.key : createEntryKey();
      stampEntryKey(key);

      if (!isSameEntry) {
        writeEntry(key, {
          url,
          openedFromUrl: this.isTraversing ? null : (this.current?.url ?? null),
          scroll: null,
        });
      }
    }

    const record = readEntry(key);
    writeEntry(key, {
      url,
      openedFromUrl: record?.openedFromUrl ?? null,
      scroll: record?.scroll ?? null,
    });
    this.current = { key, url };

    return key;
  }

  /** One recording per frame, however many scroll events it carried. */
  private scheduleRecord(): void {
    if (this.frame !== null) {
      return;
    }

    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.record();
    });
  }

  private record(): void {
    // While returning, the positions on screen are the OLD page's or a half-
    // loaded one's; recording them would overwrite the very value being restored.
    if (this.isTraversing || this.cancelRestore !== null) {
      return;
    }

    const key = this.syncEntry();
    const record = readEntry(key);

    if (record) {
      writeEntry(key, { ...record, scroll: readScroll() });
    }
  }

  private restoreCurrentEntry(): void {
    const key = this.syncEntry();
    // An entry with nothing remembered — evicted, or opened before this
    // existed — is a fresh visit and starts at the top.
    const scroll = readEntry(key)?.scroll ?? {
      window: { top: 0, left: 0 },
      containers: {},
    };

    let hasFinished = false;
    const cancel = restoreScroll(scroll, () => {
      hasFinished = true;
      this.cancelRestore = null;
    });

    // A page with nothing to load is restored on the spot, before this line.
    if (!hasFinished) {
      this.cancelRestore = cancel;
    }
  }
}

function isReload(): boolean {
  const [navigation] =
    typeof performance.getEntriesByType === "function"
      ? (performance.getEntriesByType("navigation") as PerformanceNavigationTiming[])
      : [];

  return navigation?.type === "reload";
}
