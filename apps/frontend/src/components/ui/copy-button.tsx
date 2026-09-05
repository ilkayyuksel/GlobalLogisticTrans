"use client";

import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/language-provider";
import { cn } from "@/lib/cn";

/**
 * Copies one value to the clipboard, and says it did.
 *
 * ── WHY A COMPONENT AND NOT A UTILITY CALL ──────────────────────────────────
 * The project had neither a clipboard helper nor a toast system, and adding a
 * toast for this would be a new piece of architecture for one confirmation. So
 * the feedback lives on the control itself: the icon becomes a tick for a
 * moment and an `aria-live` region announces it once. Nothing global, nothing
 * to wire into a page, and it works the same wherever the button is dropped.
 *
 * ── IT COPIES THE VALUE, AND ONLY THE VALUE ─────────────────────────────────
 * No label, no prefix, no surrounding whitespace — an operator pastes this into
 * a customer's search box, and anything extra means a search that finds
 * nothing. The value is passed in already trimmed by the caller.
 *
 * ── IT MUST NOT SWALLOW THE ROW'S OWN BEHAVIOUR ─────────────────────────────
 * `stopPropagation` because these buttons sit inside cells that are themselves
 * editable or clickable: copying a booking number must not also open the Trip,
 * and copying a container number must not open its inline editor. `preventDefault`
 * for the same reason inside a link.
 *
 * ── WHEN THE CLIPBOARD IS NOT THERE ─────────────────────────────────────────
 * `navigator.clipboard` is absent over plain HTTP on a non-localhost origin and
 * in some embedded browsers, and it can reject when permission is refused. The
 * failure is silent by design: the number is still on screen to be selected by
 * hand, and an error banner for a convenience action would be louder than the
 * problem.
 */

/** Long enough to notice, short enough not to linger on a busy row. */
const CONFIRMATION_MS = 1500;

export function CopyButton({
  value,
  label,
  className,
}: {
  /** The exact text to place on the clipboard. */
  value: string;
  /** Accessible name, e.g. "Containernummer kopiëren". */
  label: string;
  className?: string;
}) {
  const t = useTranslation();
  const [hasCopied, setHasCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A row can be re-rendered or filtered away mid-confirmation.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }

    setHasCopied(true);

    if (timer.current) {
      clearTimeout(timer.current);
    }

    timer.current = setTimeout(() => setHasCopied(false), CONFIRMATION_MS);
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copy();
      }}
      title={hasCopied ? t("common.copied") : label}
      aria-label={label}
      className={cn(
        "inline-flex items-center rounded p-0.5 text-muted hover:bg-hover hover:text-foreground",
        className,
      )}
    >
      {hasCopied ? <TickIcon /> : <ClipboardIcon />}
      <span className="sr-only" aria-live="polite">
        {hasCopied ? t("common.copied") : ""}
      </span>
    </button>
  );
}

/** Two overlapping sheets — the shape every application uses for "copy". */
function ClipboardIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4H5.5A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </svg>
  );
}

function TickIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5 text-success"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10.5 8 14.5 16 6" />
    </svg>
  );
}
