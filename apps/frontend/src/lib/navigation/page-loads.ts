/**
 * Whether the page shown is still loading the data it renders.
 *
 * ── WHY SCROLL RESTORATION NEEDS TO KNOW ────────────────────────────────────
 * Every page fetches in the browser, after it mounts. Coming Back to the
 * Ritten list therefore shows "Laden…" first, a few hundred pixels tall, and a
 * position 3,800 pixels down cannot be reached until the rows arrive. Waiting a
 * fixed time would be a guess; this is the fact instead.
 *
 * `useAsync` — the application's one data hook — reports each load here from
 * the moment it starts until the render CARRYING ITS RESULT has been committed
 * to the DOM. So "idle" means the page has drawn everything it fetched, and a
 * position that is still out of reach then is genuinely out of reach: the list
 * got shorter while the user was away.
 */

let pendingLoads = 0;
const idleListeners = new Set<() => void>();

/** Marks a load as started. Returns the call that marks it finished. */
export function beginPageLoad(): () => void {
  pendingLoads += 1;
  let hasEnded = false;

  return () => {
    if (hasEnded) {
      return;
    }

    hasEnded = true;
    pendingLoads -= 1;

    if (pendingLoads === 0) {
      for (const listener of [...idleListeners]) {
        listener();
      }
    }
  };
}

export function isPageIdle(): boolean {
  return pendingLoads === 0;
}

/** Called each time the last pending load finishes. Returns the unsubscribe. */
export function onPageIdle(listener: () => void): () => void {
  idleListeners.add(listener);

  return () => {
    idleListeners.delete(listener);
  };
}
