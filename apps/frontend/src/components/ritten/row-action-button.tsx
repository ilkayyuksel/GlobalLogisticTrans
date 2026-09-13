"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * One icon-only action in a row: Afwerken, Heropenen, Verwijderen or Versturen
 * in Ritten, and Bewerken or Verwijderen in Notities.
 *
 * ── WHY ICONS ───────────────────────────────────────────────────────────────
 * Three worded buttons made the actions one of the widest columns of a table
 * that has to fit a desktop screen without scrolling sideways. An icon in the
 * same outline and the same colour takes a fraction of the width, and the
 * colours still tell the kinds apart at a glance: primary for the lifecycle,
 * danger for deleting, success for sending.
 *
 * ── THE WORD IS STILL THERE ─────────────────────────────────────────────────
 * `title` is the tooltip, the convention every other icon button in this table
 * already follows — the PDF, copy, notes and reset buttons. `aria-label` is the
 * accessible name and always contains that same word, so the icon is never the
 * only thing that explains the button.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Exactly the colours the worded buttons had. */
const TONE_CLASSES = {
  primary: "border-primary/40 text-primary hover:bg-primary/10",
  danger: "border-danger/40 text-danger hover:bg-danger/10",
  success: "border-success/40 text-success hover:bg-success/10",
} as const;

export type RowActionTone = keyof typeof TONE_CLASSES;

export function RowActionButton({
  tone,
  tooltip,
  accessibleName,
  description,
  isDisabled,
  isBusy = false,
  onClick,
  children,
}: {
  tone: RowActionTone;
  /** What the action does, in one word — or why it cannot be done now. */
  tooltip: string;
  /** Contains the tooltip's word, plus whatever tells the rows apart. */
  accessibleName: string;
  /** A reason the action is unavailable, for a screen reader. */
  description?: string;
  isDisabled: boolean;
  /** True while the action's own request is running. */
  isBusy?: boolean;
  onClick: () => void;
  /** The icon. */
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onClick}
      title={tooltip}
      aria-label={accessibleName}
      aria-description={description}
      aria-busy={isBusy || undefined}
      className={cn(
        // 28px square: compact in the column, still an easy target to hit.
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-40",
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </button>
  );
}

/** The one stroke style every action icon shares, so the four read as a set. */
function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A tick: the transport has been carried out. */
export function CompleteIcon() {
  return (
    <ActionIcon>
      <path d="M4.5 10.5 8.5 14.5 15.5 6" />
    </ActionIcon>
  );
}

/** An arrow turning back on itself: back into the planning. */
export function ReopenIcon() {
  return (
    <ActionIcon>
      <path d="M3.5 10a6.5 6.5 0 1 0 2.2-4.9L3.5 7" />
      <path d="M3.5 3.5V7H7" />
    </ActionIcon>
  );
}

/** A cross: out of the planning. */
export function DeleteIcon() {
  return (
    <ActionIcon>
      <path d="M5.5 5.5 14.5 14.5" />
      <path d="M14.5 5.5 5.5 14.5" />
    </ActionIcon>
  );
}

/** A pencil: change what is written. */
export function EditIcon() {
  return (
    <ActionIcon>
      <path d="M13 4 16 7 7.5 15.5H4.5v-3z" />
      <path d="M11 6 14 9" />
    </ActionIcon>
  );
}

/** An arrow leaving to the upper right: handed to the driver. */
export function SendIcon() {
  return (
    <ActionIcon>
      <path d="M6 14 14 6" />
      <path d="M7.5 6H14v6.5" />
    </ActionIcon>
  );
}
