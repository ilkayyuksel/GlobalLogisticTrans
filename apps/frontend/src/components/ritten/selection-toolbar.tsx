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
 */
export function SelectionToolbar({
  selectedCount,
  visibleCount,
  canGroup,
  onSelectAllVisible,
  onClear,
  onGroup,
}: {
  selectedCount: number;
  visibleCount: number;
  /** False below two Trips: one Trip is not a group. */
  canGroup: boolean;
  onSelectAllVisible: () => void;
  onClear: () => void;
  onGroup: () => void;
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
        disabled={!canGroup}
        className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("ritten.group.create")}
      </button>
    </div>
  );
}
