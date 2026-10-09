/**
 * Which browser history entry the page is showing.
 *
 * ── WHY AN ENTRY AND NOT A URL ──────────────────────────────────────────────
 * A scroll position belongs to a VISIT, not to an address: the same Ritten URL
 * can sit twice in the history, scrolled to different rows, and Back must
 * return to the one it left. So every entry gets a key of its own, stored in
 * `history.state` — the one place the browser keeps per entry, across Back,
 * Forward and a reload of the tab.
 *
 * ── LIVING ALONGSIDE THE NEXT.JS ROUTER ─────────────────────────────────────
 * The App Router owns two fields of that state (`__NA` and its route tree) and
 * patches `pushState`/`replaceState` so a native call keeps them and keeps
 * `useSearchParams` in step. That is the documented way to add state of one's
 * own, and the only one used here.
 *
 * A navigation made by the router itself writes a fresh state without our key.
 * A new entry then simply gets a new key; the same entry losing its key is
 * re-stamped with the one it had — see `ScrollTracker`.
 *
 * ── THE ONE ORDERING HAZARD ─────────────────────────────────────────────────
 * The router installs its patch in an effect of its own, which on a hard page
 * load runs AFTER the page's effects. A native call made before then is not
 * patched, and a state written without `__NA` would make the router RELOAD the
 * page when Back later returns to that entry. So stamping a key always keeps
 * the router's fields, and a URL is only rewritten in answer to the user,
 * never while the page is mounting — see `useUrlState`.
 */

const ENTRY_KEY_FIELD = "__tranoEntry";

/** Fields the Next.js App Router keeps in `history.state` for itself. */
const ROUTER_FIELDS = ["__NA", "__PRIVATE_NEXTJS_INTERNALS_TREE"] as const;

type HistoryState = Record<string, unknown>;

let keyCounter = 0;

/** Unique within the tab, which is as far as history entries reach. */
export function createEntryKey(): string {
  keyCounter += 1;

  return `${Date.now().toString(36)}-${keyCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** The key of the entry being shown, or null when it has none yet. */
export function readEntryKey(): string | null {
  const key = (window.history.state as HistoryState | null)?.[ENTRY_KEY_FIELD];

  return typeof key === "string" ? key : null;
}

/** Our part of the state: everything except what the router owns. */
function customHistoryState(): HistoryState {
  const state = { ...((window.history.state as HistoryState | null) ?? {}) };

  for (const field of ROUTER_FIELDS) {
    delete state[field];
  }

  return state;
}

/**
 * Gives the entry being shown its key, leaving its URL as it is.
 *
 * The router's own fields are passed along, so the state stays one the router
 * can return to whether or not its patch is installed yet. With them present
 * the patch passes the call straight through, which is right: the address does
 * not change, so there is nothing for the router to follow.
 */
export function stampEntryKey(key: string): void {
  window.history.replaceState(
    { ...((window.history.state as HistoryState | null) ?? {}), [ENTRY_KEY_FIELD]: key },
    "",
    window.location.href,
  );
}

/**
 * Rewrites the address of the entry being shown, keeping it the same entry.
 *
 * For view state that lives in the URL: a filter or a date changes WHERE the
 * entry points, not which visit it is, so its key and its saved scroll travel
 * with it. Replace, never push — a filter click is not a step Back undoes.
 *
 * The router's fields are left OUT, which is what makes the patched call copy
 * them back and update `useSearchParams` — the documented integration. Only
 * call it once the page is interactive (see the ordering hazard above).
 */
export function replaceCurrentUrl(url: string): void {
  window.history.replaceState(customHistoryState(), "", url);
}

/** The address of the entry being shown, as the router compares it. */
export function currentUrl(): string {
  const { pathname, search } = window.location;

  return `${pathname}${search}`;
}
