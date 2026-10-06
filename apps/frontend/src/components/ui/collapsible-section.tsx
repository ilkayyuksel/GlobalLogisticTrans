"use client";

import { useId, type ReactNode } from "react";

/**
 * A titled section that opens and closes.
 *
 * ── CLOSED IS HIDDEN, NOT GONE ──────────────────────────────────────────────
 * The content stays mounted while the section is closed. An inline edit in
 * progress, a typed form and the rows' own state survive closing and reopening,
 * and a refetch never has to rebuild what was hidden. The open state belongs to
 * the caller, so it outlives every refetch too.
 *
 * The header is a real button with `aria-expanded`, so the state is announced
 * and the section opens from the keyboard.
 */
export function CollapsibleSection({
  title,
  count,
  isOpen,
  onToggle,
  actions,
  children,
}: {
  title: string;
  /** Shown beside the title: how many records the section holds right now. */
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  /** Controls that belong to the section, shown in its header when open. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const contentId = useId();

  return (
    <section className="mt-4 rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <span aria-hidden="true" className="text-xs text-muted">
            {isOpen ? "▾" : "▸"}
          </span>
          {title}
          {count === undefined ? null : (
            <span className="rounded-full bg-hover px-2 py-0.5 text-xs font-medium text-muted">
              {count}
            </span>
          )}
        </button>
        {isOpen && actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      <div id={contentId} hidden={!isOpen} className="border-t border-border px-3 pb-3">
        {children}
      </div>
    </section>
  );
}
