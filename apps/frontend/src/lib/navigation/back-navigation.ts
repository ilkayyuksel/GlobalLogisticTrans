import { readEntry } from "./entry-store";
import { readEntryKey } from "./history-entry";

/**
 * Whether going to `href` is the same as going Back.
 *
 * True when the entry on screen was opened from a page at that path — the
 * Ritten list, say, with whatever date, view and filters it had. Going Back is
 * then the better way there: it returns to that very entry, with its address,
 * its view state and its scroll position, instead of stacking a fresh copy of
 * the list on top. False when the page was opened any other way (typed in, a
 * new tab, a reload with no history), and the link is followed as usual.
 */
export function isBackTo(href: string): boolean {
  const key = readEntryKey();
  const openedFrom = key ? readEntry(key)?.openedFromUrl : null;

  if (!openedFrom) {
    return false;
  }

  const origin = window.location.origin;

  return new URL(openedFrom, origin).pathname === new URL(href, origin).pathname;
}
