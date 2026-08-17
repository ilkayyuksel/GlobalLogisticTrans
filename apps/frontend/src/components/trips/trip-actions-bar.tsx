"use client";

import { Spinner } from "@/components/ui/spinner";
import { canDelete, canRestore, statusActionsFor } from "@/lib/trip-actions";
import {
  STATUS_CONFIRM_KEYS,
  STATUS_LABEL_KEYS,
} from "@/lib/ritten/row-actions";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { ChangeableTripStatus, Trip } from "@/lib/api/types";

/**
 * The lifecycle actions available on a Trip.
 *
 * Only transitions the backend accepts are offered — see `trip-actions.ts` for
 * why that list lives on this side and why the backend still decides. Deletion
 * and restoration are separate buttons because they are separate operations
 * with their own preconditions, exactly as the API models them.
 *
 * The labels and confirmations come from the same keys the Ritten row menu
 * uses. Two wordings for one action would eventually drift, and "Close trip"
 * meaning something subtly different from "Afwerken" is not a difference anyone
 * could act on.
 *
 * Every action asks for confirmation where the consequence is not obviously
 * reversible, and each reports through the same feedback line so a user never
 * has to guess whether something happened.
 */
export function TripActionsBar({
  trip,
  isBusy,
  onChangeStatus,
  onDelete,
  onRestore,
  onEdit,
}: {
  trip: Trip;
  isBusy: boolean;
  onChangeStatus: (status: ChangeableTripStatus) => void;
  onDelete: () => void;
  onRestore: () => void;
  onEdit: () => void;
}) {
  const t = useTranslation();
  const statusActions = statusActionsFor(trip);

  const confirmThen = (message: string | undefined, run: () => void) => {
    if (!message || window.confirm(message)) {
      run();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isBusy ? <Spinner label={t("tripDetail.busy")} /> : null}

      {/* A DELETED Trip is read-only until it is restored. */}
      {trip.status !== "DELETED" ? (
        <button
          type="button"
          onClick={onEdit}
          disabled={isBusy}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
        >
          {t("ritten.menu.editDetails")}
        </button>
      ) : null}

      {statusActions.map((action) => {
        const confirmKey = STATUS_CONFIRM_KEYS[action.target];

        return (
          <button
            key={action.target}
            type="button"
            onClick={() =>
              confirmThen(confirmKey ? t(confirmKey) : undefined, () =>
                onChangeStatus(action.target),
              )
            }
            disabled={isBusy}
            className={
              action.isIrreversible
                ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                : "rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
            }
          >
            {t(STATUS_LABEL_KEYS[action.target])}
          </button>
        );
      })}

      {canDelete(trip) ? (
        <button
          type="button"
          onClick={() => confirmThen(t("ritten.confirm.delete"), onDelete)}
          disabled={isBusy}
          className="rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/5 disabled:opacity-50"
        >
          {t("ritten.menu.delete")}
        </button>
      ) : null}

      {canRestore(trip) ? (
        <button
          type="button"
          onClick={onRestore}
          disabled={isBusy}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {t("ritten.menu.restore")}
        </button>
      ) : null}
    </div>
  );
}
