"use client";

import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * What is selected, and what can be done with it.
 *
 * SELECTION IS PER PAGE, and the wording says so: "alle zichtbare ritten" is
 * the honest description of what the control does when the list is paginated.
 * Implying a whole period would matter the moment someone grouped a month they
 * could not see.
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
  visibleCount,
  canGroup,
  canComplete,
  isBusy,
  onSelectAllVisible,
  onClear,
  onGroup,
  onComplete,
}: {
  selectedCount: number;
  visibleCount: number;
  /** False below two Trips: one Trip is not a group. */
  canGroup: boolean;
  /** False when nothing in the selection is in a state that can be closed. */
  canComplete: boolean;
  isBusy: boolean;
  onSelectAllVisible: () => void;
  onClear: () => void;
  onGroup: () => void;
  onComplete: () => void;
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
        disabled={selectedCount === visibleCount}
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
    </div>
  );
}
