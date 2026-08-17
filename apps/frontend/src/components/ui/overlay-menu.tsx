"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * A dropdown that is not part of the layout it belongs to.
 *
 * ── WHY A PORTAL ────────────────────────────────────────────────────────────
 * A menu opened from a wide, horizontally scrolling table used to be an
 * absolutely positioned box inside a table cell, which meant the table's
 * `overflow-x-auto` clipped it: the last rows showed a menu cut off at the
 * bottom edge, and raising z-index cannot fix that — a clipping ancestor clips
 * regardless of stacking order.
 *
 * So the panel is rendered into `document.body` and positioned in viewport
 * coordinates from the trigger's own rectangle. Nothing above it can clip it,
 * and the table keeps the scrolling behaviour it needs.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * It reopens the usual questions a portal creates, and answers them here so no
 * caller has to: it closes on Escape (returning focus to the trigger), on a
 * click anywhere outside, and on Tab; arrow keys walk the items; and it flips
 * above the trigger when the space below is too small.
 */

/** Wide enough for the longest action label, narrow enough for a phone. */
const MENU_WIDTH_PX = 240;

/** Breathing room so the panel never touches the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

/** The gap between the trigger and the panel. */
const TRIGGER_GAP_PX = 4;

interface Position {
  readonly top: number;
  readonly left: number;
}

export function OverlayMenu({
  triggerLabel,
  menuLabel,
  isDisabled,
  children,
}: {
  /** Accessible name of the button that opens the menu. */
  triggerLabel: string;
  /** Accessible name of the panel itself. */
  menuLabel: string;
  isDisabled?: boolean;
  /** The items. `close` is passed so an item can dismiss the menu it lives in. */
  children: (close: () => void) => ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    setPosition(null);
  }, []);

  const closeAndRefocus = useCallback(() => {
    close();
    triggerRef.current?.focus();
  }, [close]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;

    if (!trigger || !panel) {
      return;
    }

    setPosition(placeMenu(trigger.getBoundingClientRect(), panel.offsetHeight));
  }, []);

  // Layout effect, so the panel is placed before the browser paints it —
  // otherwise it appears at the top-left corner for one frame and jumps.
  useLayoutEffect(() => {
    if (isOpen) {
      reposition();
    }
  }, [isOpen, reposition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        close();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAndRefocus();
        return;
      }

      // The panel is a sibling of the page in the DOM, so tabbing out of it
      // would land somewhere unrelated. Closing keeps the tab order sensible.
      if (event.key === "Tab") {
        close();
        return;
      }

      moveFocus(event, panelRef.current);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Anything that moves the trigger moves the panel with it.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, close, closeAndRefocus, reposition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={triggerLabel}
        disabled={isDisabled}
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        className="rounded-md border border-border px-2 py-1 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
      >
        ⋯
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label={menuLabel}
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                width: MENU_WIDTH_PX,
                // Hidden until placed, rather than shown in the wrong place.
                visibility: position ? "visible" : "hidden",
              }}
              className="fixed z-50 rounded-md border border-border bg-card py-1 shadow-lg"
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Where the panel goes, in viewport coordinates.
 *
 * Right-aligned to the trigger, because the trigger sits at the right edge of
 * its row and a left-aligned panel would run off the screen. Both axes are then
 * clamped to the viewport, and the panel flips above the trigger when it does
 * not fit below — the last row of a long table is exactly where that matters.
 */
function placeMenu(trigger: DOMRect, panelHeight: number): Position {
  const spaceBelow = window.innerHeight - trigger.bottom - VIEWPORT_MARGIN_PX;
  const fitsBelow = panelHeight <= spaceBelow;

  const top = fitsBelow
    ? trigger.bottom + TRIGGER_GAP_PX
    : Math.max(VIEWPORT_MARGIN_PX, trigger.top - TRIGGER_GAP_PX - panelHeight);

  const maximumLeft = window.innerWidth - MENU_WIDTH_PX - VIEWPORT_MARGIN_PX;
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN_PX, trigger.right - MENU_WIDTH_PX),
    Math.max(VIEWPORT_MARGIN_PX, maximumLeft),
  );

  return { top, left };
}

/** Arrow keys, Home and End walk the items, as a menu is expected to. */
function moveFocus(event: KeyboardEvent, panel: HTMLElement | null): void {
  if (!panel) {
    return;
  }

  const items = Array.from(
    panel.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  );

  if (items.length === 0) {
    return;
  }

  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = nextIndex(event.key, current, items.length);

  if (next === null) {
    return;
  }

  event.preventDefault();
  items[next].focus();
}

function nextIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
