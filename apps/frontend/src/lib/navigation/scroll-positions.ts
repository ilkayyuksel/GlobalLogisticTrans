import type { EntryScroll, ScrollOffset } from "./entry-store";

/**
 * Reading and setting the scroll positions an entry remembers.
 *
 * ── WHICH SCROLLERS ─────────────────────────────────────────────────────────
 * The window, always: every page scrolls the document. And the few containers
 * that are a page's own main scroller — the Ritten table sideways when its
 * columns outgrow the screen, the Agenda grid in both directions. Those opt in
 * by declaring an id with this attribute; an arbitrary `overflow: auto` box (a
 * dialog body, a dropdown list) is not remembered, because returning to it is
 * not something a user does.
 *
 * The id must be stable across visits and unique on the page, e.g. one per
 * day section of the Ritten week.
 */
export const SCROLL_CONTAINER_ATTRIBUTE = "data-scroll-restoration-id";

function containerElements(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(`[${SCROLL_CONTAINER_ATTRIBUTE}]`),
  ];
}

export function containerElement(id: string): HTMLElement | null {
  return (
    containerElements().find(
      (element) => element.getAttribute(SCROLL_CONTAINER_ATTRIBUTE) === id,
    ) ?? null
  );
}

/** Where the window and every declared container are scrolled to now. */
export function readScroll(): EntryScroll {
  const containers: Record<string, ScrollOffset> = {};

  for (const element of containerElements()) {
    const id = element.getAttribute(SCROLL_CONTAINER_ATTRIBUTE) as string;

    // Unscrolled containers are the default and need no memory.
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
      containers[id] = { top: element.scrollTop, left: element.scrollLeft };
    }
  }

  return {
    window: { top: window.scrollY, left: window.scrollX },
    containers,
  };
}

/** How far a scroller can go, from its content as it stands right now. */
interface ScrollRange {
  readonly maxTop: number;
  readonly maxLeft: number;
}

function windowRange(): ScrollRange {
  const root = document.documentElement;

  return {
    maxTop: Math.max(0, root.scrollHeight - window.innerHeight),
    maxLeft: Math.max(0, root.scrollWidth - window.innerWidth),
  };
}

function elementRange(element: HTMLElement): ScrollRange {
  return {
    maxTop: Math.max(0, element.scrollHeight - element.clientHeight),
    maxLeft: Math.max(0, element.scrollWidth - element.clientWidth),
  };
}

export function isReachable(target: ScrollOffset, range: ScrollRange): boolean {
  return target.top <= range.maxTop && target.left <= range.maxLeft;
}

/** The target, or the nearest point the content still allows. */
export function nearestReachable(
  target: ScrollOffset,
  range: ScrollRange,
): ScrollOffset {
  return {
    top: Math.min(target.top, range.maxTop),
    left: Math.min(target.left, range.maxLeft),
  };
}

/**
 * Applies the window position when it can be reached — or, when `clamp` is
 * set, its nearest reachable point. Returns whether it was applied.
 */
export function applyWindowScroll(target: ScrollOffset, clamp: boolean): boolean {
  const range = windowRange();

  if (!clamp && !isReachable(target, range)) {
    return false;
  }

  const offset = nearestReachable(target, range);
  window.scrollTo({ top: offset.top, left: offset.left, behavior: "instant" });

  return true;
}

/** The same for one declared container; false while it is not on the page. */
export function applyContainerScroll(
  id: string,
  target: ScrollOffset,
  clamp: boolean,
): boolean {
  const element = containerElement(id);

  if (!element) {
    return false;
  }

  const range = elementRange(element);

  if (!clamp && !isReachable(target, range)) {
    return false;
  }

  const offset = nearestReachable(target, range);
  element.scrollTop = offset.top;
  element.scrollLeft = offset.left;

  return true;
}
