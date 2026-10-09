import { resetEntryStore } from "@/lib/navigation/entry-store";
import { ScrollTracker } from "@/lib/navigation/scroll-tracker";

/**
 * A browser viewport and history for scroll-restoration specs, under jsdom.
 *
 * ── WHY IT IS NEEDED ────────────────────────────────────────────────────────
 * jsdom has no layout: every element is 0×0, `window.scrollTo` is not
 * implemented and `scrollTop` cannot move. Restoration is entirely about
 * layout — can the content hold this position yet? — so the specs give the
 * document and its scroll containers explicit sizes and scroll them the way a
 * browser would: clamped to what the content allows, firing `scroll`.
 *
 * Navigation goes through the REAL History API, as the App Router uses it: a
 * push writes a fresh state carrying only the router's own field, Back and
 * Forward are `history.back()`/`forward()` with their real `popstate`. The
 * router's "I have rendered the new address" is `routeChanged()`, which is
 * what the root layout component calls.
 */

interface Size {
  height: number;
  width: number;
}

const VIEWPORT: Size = { height: 800, width: 1200 };

let content: Size = { ...VIEWPORT };
const resizeCallbacks = new Set<() => void>();

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

function define(target: object, name: string, get: () => number): void {
  Object.defineProperty(target, name, { configurable: true, get });
}

/** Called by the harness whenever content changes size, as a browser would. */
class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(): void {
    resizeCallbacks.add(this.callback);
  }
  disconnect(): void {
    resizeCallbacks.delete(this.callback);
  }
  unobserve(): void {}
}

export function installViewport(): void {
  content = { ...VIEWPORT };
  let scrollY = 0;
  let scrollX = 0;

  define(window, "innerHeight", () => VIEWPORT.height);
  define(window, "innerWidth", () => VIEWPORT.width);
  define(window, "scrollY", () => scrollY);
  define(window, "scrollX", () => scrollX);
  define(document.documentElement, "scrollHeight", () => content.height);
  define(document.documentElement, "scrollWidth", () => content.width);

  window.scrollTo = ((options: ScrollToOptions) => {
    scrollY = clamp(options.top ?? scrollY, content.height - VIEWPORT.height);
    scrollX = clamp(options.left ?? scrollX, content.width - VIEWPORT.width);
    document.dispatchEvent(new Event("scroll"));
  }) as typeof window.scrollTo;

  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
}

/** The page's content size changed — rows arrived, or rows went away. */
export function setContentSize(size: Partial<Size>): void {
  content = { ...content, ...size };
  // A browser clamps the scroll position to what the content still allows.
  window.scrollTo({ top: window.scrollY, left: window.scrollX });
  resizeCallbacks.forEach((callback) => callback());
}

/** The user scrolls the page. */
export async function userScrollsTo(top: number, left = 0): Promise<void> {
  window.scrollTo({ top, left });
  await nextFrame();
}

/**
 * A declared scroll container — like the Ritten table — with a fixed client
 * size and content of the given size, scrolling as a browser element does.
 */
export function addScrollContainer(id: string, size: Size, client: Size): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-scroll-restoration-id", id);
  let top = 0;
  let left = 0;

  define(element, "clientHeight", () => client.height);
  define(element, "clientWidth", () => client.width);
  define(element, "scrollHeight", () => size.height);
  define(element, "scrollWidth", () => size.width);
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = clamp(value, size.height - client.height);
    },
  });
  Object.defineProperty(element, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      left = clamp(value, size.width - client.width);
    },
  });

  document.body.appendChild(element);

  return element;
}

/** The user scrolls a container; scroll does not bubble, so it is captured. */
export async function userScrollsContainer(
  element: HTMLElement,
  top: number,
  left: number,
): Promise<void> {
  element.scrollTop = top;
  element.scrollLeft = left;
  element.dispatchEvent(new Event("scroll"));
  await nextFrame();
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

/** Navigation as the App Router performs it, around one running tracker. */
export class NavigationDriver {
  readonly tracker = new ScrollTracker();
  private stop: (() => void) | null = null;

  start(url = "/trips"): this {
    window.history.replaceState({ __NA: true }, "", url);
    this.stop = this.tracker.start();

    return this;
  }

  /** A link click: a new entry, opened at the top by the router. */
  push(url: string, newContent: Partial<Size> = VIEWPORT): void {
    window.history.pushState({ __NA: true }, "", url);
    setContentSize({ height: VIEWPORT.height, width: VIEWPORT.width, ...newContent });
    window.scrollTo({ top: 0, left: 0 });
    this.tracker.routeChanged();
  }

  /** Back, with the page coming back at `newContent` size (often still loading). */
  async back(newContent: Partial<Size> = VIEWPORT): Promise<void> {
    await this.traverse(() => window.history.back(), newContent);
  }

  async forward(newContent: Partial<Size> = VIEWPORT): Promise<void> {
    await this.traverse(() => window.history.forward(), newContent);
  }

  private async traverse(go: () => void, newContent: Partial<Size>): Promise<void> {
    const popped = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    go();
    await popped;
    setContentSize({ height: VIEWPORT.height, width: VIEWPORT.width, ...newContent });
    this.tracker.routeChanged();
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
    resizeCallbacks.clear();
    resetEntryStore();
    document.body.innerHTML = "";
  }
}
