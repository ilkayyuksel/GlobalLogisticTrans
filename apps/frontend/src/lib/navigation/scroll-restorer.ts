import type { EntryScroll } from "./entry-store";
import { isPageIdle, onPageIdle } from "./page-loads";
import { applyContainerScroll, applyWindowScroll } from "./scroll-positions";

/**
 * Brings an entry back to where it was scrolled, once its content is there.
 *
 * ── THE ORDER OF EVENTS IT WAITS FOR ────────────────────────────────────────
 *
 *   Back → the page mounts → it loads its data → the rows are drawn → restore
 *
 * The position is applied as soon as the content can hold it, and again each
 * time the content grows, so a list arriving in pieces lands where it should.
 * When the page has drawn every load it started (`page-loads`), the position is
 * applied one last time — and if the list got SHORTER while the user was away
 * (a Trip deleted, a filter result changed), to the nearest point it still
 * reaches: the end of the list, never the top.
 *
 * Nothing here waits a fixed time. Every step is triggered by the event it
 * waits for: a resize of the document, or the last load finishing.
 *
 * ── AND WHEN THE USER GETS THERE FIRST ──────────────────────────────────────
 * Scrolling, clicking or pressing a key while the page is still loading ends
 * the restore on the spot. Pulling them back to an old position after they
 * have started reading would be worse than not restoring at all.
 */

const USER_INPUT_EVENTS = [
  "wheel",
  "touchstart",
  "keydown",
  "mousedown",
] as const;

/** Applies `target`, and returns the call that abandons the attempt. */
export function restoreScroll(
  target: EntryScroll,
  onFinished: () => void,
): () => void {
  let isFinished = false;
  const cleanups: (() => void)[] = [];

  function finish(): void {
    if (isFinished) {
      return;
    }

    isFinished = true;
    cleanups.forEach((cleanup) => cleanup());
    onFinished();
  }

  function apply(clamp: boolean): void {
    applyWindowScroll(target.window, clamp);

    for (const [id, offset] of Object.entries(target.containers)) {
      applyContainerScroll(id, offset, clamp);
    }
  }

  function applyFinal(): void {
    apply(true);
    finish();
  }

  apply(false);

  if (isPageIdle()) {
    applyFinal();

    return finish;
  }

  cleanups.push(onPageIdle(applyFinal));

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => apply(false));
    observer.observe(document.body);
    cleanups.push(() => observer.disconnect());
  }

  for (const eventName of USER_INPUT_EVENTS) {
    window.addEventListener(eventName, finish, { capture: true, passive: true });
    cleanups.push(() =>
      window.removeEventListener(eventName, finish, { capture: true }),
    );
  }

  return finish;
}
