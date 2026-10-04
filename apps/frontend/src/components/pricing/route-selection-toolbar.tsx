"use client";

import type { RouteSelection } from "@/components/pricing/use-route-selection";
import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Selecting what the list shows, and deleting what is selected.
 *
 * The delete button exists only while something is selected, and says how much:
 * a destructive button that is always there invites a press on an empty
 * selection, and one that does not say "3" leaves the operator counting rows.
 */
export function RouteSelectionToolbar({
  selection,
  hasShownRecords,
  onDelete,
}: {
  selection: RouteSelection;
  hasShownRecords: boolean;
  onDelete: () => void;
}) {
  const t = useTranslation();

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={!hasShownRecords}
        onClick={selection.selectAllShown}
        className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
      >
        {t("settings.pricing.routes.selection.selectAll")}
      </button>
      <button
        type="button"
        disabled={selection.count === 0}
        onClick={selection.clear}
        className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
      >
        {t("settings.pricing.routes.selection.deselectAll")}
      </button>

      {selection.count > 0 ? (
        <>
          <span className="text-xs text-secondary">
            {t("settings.pricing.routes.selection.count").replace(
              "{count}",
              String(selection.count),
            )}
          </span>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10"
          >
            {t("settings.pricing.routes.selection.delete").replace(
              "{count}",
              String(selection.count),
            )}
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * Confirms deleting the selection.
 *
 * Names what goes — so many routes, so many Combinations — and lists them, for
 * the same reason a single deletion names its route: an operator with a long
 * list on screen has no other way to check. `onConfirm` rejects on refusal, and
 * the dialog stays open with the backend's reason, because nothing was deleted.
 */
export function BulkDeleteDialog({
  routeNames,
  combinationNames,
  onConfirm,
  onClose,
}: {
  routeNames: readonly string[];
  combinationNames: readonly string[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();

  return (
    <ConfirmDialog
      titleKey="settings.pricing.routes.selection.deleteTitle"
      descriptionKey="settings.pricing.routes.selection.deleteDescription"
      consequenceKey="settings.pricing.routes.deleteConsequence"
      confirmKey="settings.pricing.routes.delete"
      tone="danger"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="text-sm font-medium text-foreground">
        {t("settings.pricing.routes.selection.summary")
          .replace("{routes}", String(routeNames.length))
          .replace("{combinations}", String(combinationNames.length))}
      </p>
      <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5 text-xs text-secondary">
        {[...routeNames, ...combinationNames].map((name, index) => (
          <li key={index}>{name}</li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}
