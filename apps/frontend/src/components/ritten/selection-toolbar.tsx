"use client";

import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * What is selected, and what can be done with it.
 *
 * THE SELECTION IS NOT PER PAGE. It is everything the operator has ticked, on
 * whatever day, and it survives navigating away — a Combination that goes out
 * on Monday and comes back on Tuesday cannot be selected any other way.
 * "Alle zichtbare ritten" still says only "visible", because that is what that
 * one button does: it ADDS the rows on screen to what is already selected.
 *
 * The toolbar only appears once something is selected — an empty row of
 * disabled buttons above every list would be permanent clutter for an action
 * used occasionally.
 *
 * Completing asks for no confirmation. It is a state an operator sets a dozen
 * times an afternoon, it is visible in the row immediately afterwards, and a
 * dialog in front of a routine action is one people learn to dismiss without
 * reading — which is worse than none at all. Cancelling and deleting still ask,
 * because those are not routine.
 */
export function SelectionToolbar({
  selectedCount,
  canSelectAllVisible,
  canGroup,
  canComplete,
  isBusy,
  onSelectAllVisible,
  onClear,
  onGroup,
  onComplete,
  onMarkLoose,
}: {
  /** Everything selected, including Trips on days that are not on screen. */
  selectedCount: number;
  /** False once every row on screen is already selected. */
  canSelectAllVisible: boolean;
  /** False below two Trips: one Trip is not a group. */
  canGroup: boolean;
  /** False when nothing in the selection is in a state that can be closed. */
  canComplete: boolean;
  isBusy: boolean;
  onSelectAllVisible: () => void;
  onClear: () => void;
  onGroup: () => void;
  onComplete: () => void;
  /**
   * Classifies the whole selection as LOSRIT.
   *
   * Always available while something is selected: whether a Trip may be
   * classified depends on its group, which is the backend's answer to give —
   * and it gives it for the whole selection at once rather than per row.
   */
  onMarkLoose: () => void;
}) {
  const t = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
      <span className="text-sm font-medium text-foreground">
        {selectedCount} {t("ritten.select.count")}
      </span>

      <button
        type="button"
        onClick={onSelectAllVisible}
        disabled={!canSelectAllVisible}
        className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
      >
        {t("ritten.select.allVisible")}
      </button>

      <button
        type="button"
        onClick={onClear}
        className="text-sm font-medium text-secondary hover:text-foreground"
      >
        {t("ritten.select.clear")}
      </button>

      <button
        type="button"
        onClick={onGroup}
        disabled={!canGroup || isBusy}
        className="ml-auto rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("ritten.group.create")}
      </button>

      {/* Directly: no confirmation, and the rows say what happened. */}
      <button
        type="button"
        onClick={onComplete}
        disabled={!canComplete || isBusy}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("ritten.select.complete")}
      </button>

      {/*
        A CLASSIFICATION, not a lifecycle action — so it is a quiet button
        rather than the primary one, and it asks nothing: the LOSRIT badge
        appears on the rows a moment later, which is the whole confirmation.
      */}
      <button
        type="button"
        onClick={onMarkLoose}
        disabled={isBusy}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("ritten.losrit.label")}
      </button>
    </div>
  );
}
