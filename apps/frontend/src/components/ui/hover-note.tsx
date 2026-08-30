"use client";

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

/**
 * A note attached to something already on screen.
 *
 * ── WHY THIS EXISTS RATHER THAN A LIBRARY ───────────────────────────────────
 * The project had no tooltip or popover of any kind. Adding a floating-UI
 * dependency for one read-only panel would be a library to configure, keep and
 * upgrade for a component this small. This is the ONLY one: anything else that
 * needs a hover panel uses it rather than introducing a second.
 *
 * ── WHY A PORTAL ────────────────────────────────────────────────────────────
 * The same reason `OverlayMenu` uses one, and the same convention. The Ritten
 * table scrolls horizontally, and `overflow-x-auto` CLIPS an absolutely
 * positioned child regardless of z-index — a note opened on a lower row would
 * be cut off at the table's edge. Rendering into `document.body` and
 * positioning from the anchor's own rectangle puts it above every clipping
 * ancestor.
 *
 * ── WHAT MAKES IT ACCESSIBLE, AND WHY EACH PART IS THERE ────────────────────
 * WCAG 1.4.13 governs content shown on hover or focus, and asks for three
 * things. All three are implemented here rather than left to the caller:
 *
 *   Hoverable   the pointer may move ONTO the note without it vanishing, which
 *               is what makes a long, scrollable note reachable at all;
 *   Dismissible Escape closes it without moving the pointer;
 *   Persistent  it stays until the pointer or the focus actually leaves.
 *
 * Focus opens it exactly as hover does, so a note reachable only with a mouse
 * is not a note a keyboard user has to do without. `aria-describedby` ties the
 * panel to the element it describes, which is what makes a screen reader
 * announce it as a description of the booking number rather than as stray text.
 *
 * The panel is deliberately NOT focusable and holds no controls. It is
 * something to read; a focus trap or a close button would make a passive note
 * behave like a dialog.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Wide enough for a sentence or two, narrow enough for a phone. */
const PANEL_WIDTH_PX = 320;

/** Breathing room so the panel never touches the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

/** The gap between the anchor and the panel. */
const ANCHOR_GAP_PX = 6;

/**
 * How long the note survives the pointer leaving.
 *
 * Long enough to cross the gap between the anchor and the panel, short enough
 * that a note the operator has moved away from does not linger. Without it a
 * scrollable note would be unreachable: the pointer would dismiss it on the way
 * there.
 */
const POINTER_BRIDGE_MS = 120;

interface Position {
  readonly top: number;
  readonly left: number;
}

export function HoverNote({
  label,
  note,
  children,
}: {
  /**
   * What the note is ABOUT — a heading above the text, so a reader knows which
   * field they are looking at rather than seeing an unlabelled paragraph.
   */
  label: string;
  /**
   * The note itself. An absent or blank note renders no panel and no marker at
   * all: an empty popup tells the operator nothing and looks like a note that
   * failed to load.
   */
  note: string | null;
  /**
   * The element the note belongs to — the booking number link.
   *
   * A single ELEMENT rather than arbitrary nodes, because the description has
   * to land on the thing that takes focus. See the clone below.
   */
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  const hasNote = note !== null && note.trim() !== "";

  const cancelPendingClose = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const close = useCallback((): void => {
    cancelPendingClose();
    setIsOpen(false);
    setPosition(null);
  }, [cancelPendingClose]);

  const open = useCallback((): void => {
    cancelPendingClose();
    setIsOpen(true);
  }, [cancelPendingClose]);

  /** Leaves the note up long enough for the pointer to reach it. */
  const closeAfterBridge = useCallback((): void => {
    cancelPendingClose();
    closeTimerRef.current = setTimeout(close, POINTER_BRIDGE_MS);
  }, [cancelPendingClose, close]);

  const reposition = useCallback((): void => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;

    if (!anchor || !panel) {
      return;
    }

    const trigger = anchor.getBoundingClientRect();
    const height = panel.offsetHeight;

    /*
     * Below the anchor by default, above it when the space below cannot hold
     * the panel — the last rows of a long list are exactly where a note would
     * otherwise open off-screen.
     */
    const fitsBelow =
      trigger.bottom + ANCHOR_GAP_PX + height + VIEWPORT_MARGIN_PX <
      window.innerHeight;

    // Clamped so a note near the right edge stays inside the viewport.
    const maxLeft = window.innerWidth - PANEL_WIDTH_PX - VIEWPORT_MARGIN_PX;

    setPosition({
      top: fitsBelow
        ? trigger.bottom + ANCHOR_GAP_PX
        : trigger.top - ANCHOR_GAP_PX - height,
      left: Math.max(VIEWPORT_MARGIN_PX, Math.min(trigger.left, maxLeft)),
    });
  }, []);

  // A layout effect, so the panel is placed before the browser paints it —
  // otherwise it appears in the top-left corner for one frame and jumps.
  useLayoutEffect(() => {
    if (isOpen) {
      reposition();
    }
  }, [isOpen, reposition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Anything that moves the anchor moves the note with it; `capture` catches
    // the table's own scroll as well as the window's.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, close, reposition]);

  // A row can disappear while its note is open — a filter change, a refetch.
  useEffect(() => cancelPendingClose, [cancelPendingClose]);

  if (!hasNote) {
    return <>{children}</>;
  }

  return (
    <span
      ref={anchorRef}
      className="inline-flex items-center gap-1"
      onMouseEnter={open}
      onMouseLeave={closeAfterBridge}
      /*
       * React's onFocus/onBlur are focusin/focusout underneath and therefore
       * BUBBLE, which is what lets this span react to the link inside it taking
       * focus. That is the whole keyboard path to the note.
       */
      onFocus={open}
      onBlur={close}
    >
      {/*
        `aria-describedby` goes on the CHILD, not on a wrapper around it.
        A screen reader announces the description of the element that has
        focus, and that is the link — a wrapper carrying the attribute would be
        silently ignored, which is the kind of accessibility bug that looks
        correct in the markup.
      */}
      {cloneElement(children, {
        "aria-describedby": isOpen ? panelId : undefined,
      })}

      {/*
        A quiet marker that a note exists at all. Without it nothing tells an
        operator which rows are worth hovering, and a keyboard user has no
        reason to stop on the link. Hidden from assistive technology, because
        the note itself is already announced through `aria-describedby`.
      */}
      <span aria-hidden="true" className="text-[10px] leading-none text-muted">
        ●
      </span>

      {isOpen
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="tooltip"
              onMouseEnter={open}
              onMouseLeave={close}
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                width: PANEL_WIDTH_PX,
                // Hidden until placed, rather than shown in the wrong place.
                visibility: position ? "visible" : "hidden",
              }}
              className="fixed z-50 rounded-md border border-border bg-card p-3 shadow-lg"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                {label}
              </p>
              {/*
                `whitespace-pre-wrap` keeps the line breaks and the spacing the
                operator typed — a note is often a short list, and collapsing it
                into one paragraph loses the structure that made it readable.

                A long note SCROLLS rather than being cut. Silently truncating
                is worse than a scrollbar, because nothing on screen would say
                that there is more.
              */}
              <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground">
                {note}
              </p>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
