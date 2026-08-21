"use client";

import { OverlayMenu } from "@/components/ui/overlay-menu";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { canRestore, statusActionsFor } from "@/lib/trip-actions";
import {
  STATUS_CONFIRM_KEYS,
  STATUS_LABEL_KEYS,
  canEdit,
  canReprocess,
  canViewPdf,
  type RittenActions,
} from "@/lib/ritten/row-actions";

/**
 * The actions available on one Trip.
 *
 * Which lifecycle transitions appear comes from `trip-actions.ts`, which
 * mirrors the backend's state machine for display purposes only — every action
 * is still sent, and the backend's refusal is what decides. This component adds
 * no rule of its own.
 *
 * Every entry has an endpoint behind it. What decides whether one appears is the
 * Trip's own state — a Trip with no group cannot be unlinked from one, and
 * pricing cannot be reprocessed before a Trip is closed.
 *
 * Opening, positioning and dismissing the panel are `OverlayMenu`'s job. This
 * component only says what is in it.
 */
export function RowActionMenu({
  trip,
  actions,
  isBusy,
}: {
  trip: Trip;
  actions: RittenActions;
  isBusy: boolean;
}) {
  const t = useTranslation();

  function run(
    close: () => void,
    action: () => void | Promise<void>,
    confirmation?: string,
  ): void {
    close();

    if (confirmation && !window.confirm(confirmation)) {
      return;
    }

    // The page already reports every failure in its feedback line, and it
    // rethrows so that an inline editor can keep its cell open. A menu item has
    // no cell to keep open, so the rejection ends here rather than becoming an
    // unhandled promise.
    void Promise.resolve(action()).catch(() => undefined);
  }

  return (
    <OverlayMenu
      triggerLabel={`${t("ritten.menu.label")} ${trip.bookingNumber}`}
      menuLabel={t("ritten.menu.label")}
      isDisabled={isBusy}
    >
      {(close) => (
        <>
          {statusActionsFor(trip).map((action) => (
            <MenuItem
              key={action.target}
              labelKey={STATUS_LABEL_KEYS[action.target]}
              isDestructive={action.isIrreversible}
              onSelect={() => {
                const confirmKey = STATUS_CONFIRM_KEYS[action.target];

                run(
                  close,
                  () => actions.changeStatus(trip, action.target),
                  confirmKey ? t(confirmKey) : undefined,
                );
              }}
            />
          ))}

          {canEdit(trip) ? (
            <MenuItem
              labelKey="ritten.menu.editDetails"
              onSelect={() => run(close, () => actions.openDetails(trip))}
            />
          ) : null}

          <MenuItem
            labelKey="ritten.menu.customValues"
            onSelect={() => run(close, () => actions.openCustomProperties(trip))}
          />

          {canReprocess(trip) ? (
            <MenuItem
              labelKey="ritten.menu.reprocess"
              onSelect={() => run(close, () => actions.reprocessPricing(trip))}
            />
          ) : null}

          {trip.tripGroupId ? (
            <MenuItem
              labelKey="ritten.menu.viewGroup"
              onSelect={() =>
                run(close, () => actions.openCombination(trip.tripGroupId as string))
              }
            />
          ) : null}

          {canViewPdf(trip) ? (
            <>
              <MenuItem
                labelKey="ritten.menu.viewPdf"
                onSelect={() => run(close, () => actions.openPdf(trip))}
              />
              <MenuItem
                labelKey="ritten.menu.downloadPdf"
                onSelect={() => run(close, () => actions.downloadPdf(trip))}
              />
            </>
          ) : null}

          {trip.tripGroupId ? (
            <MenuItem
              labelKey="ritten.menu.unlink"
              onSelect={() =>
                run(
                  close,
                  () => actions.unlinkFromGroup(trip),
                  t("ritten.group.confirmUnlink"),
                )
              }
            />
          ) : null}

          {/*
            No "Verwijderen".

            Removing a transport by hand is not part of the workflow: a Trip
            leaves the planning because a CANCEL: document says so, which is a
            SOFT cancellation that keeps the record, its pricing and its
            history. A manual delete offered beside it would be a second,
            destructive way to do the same thing — and the one that loses the
            evidence.

            Restore stays: a Trip that was soft-deleted before this decision
            must still be recoverable, and stranding those records would be the
            more destructive choice.
          */}
          {canRestore(trip) ? (
            <MenuItem
              labelKey="ritten.menu.restore"
              onSelect={() => run(close, () => actions.restoreTrip(trip))}
            />
          ) : null}
        </>
      )}
    </OverlayMenu>
  );
}

function MenuItem({
  labelKey,
  onSelect,
  isDestructive,
}: {
  labelKey: TranslationKey;
  onSelect: () => void;
  isDestructive?: boolean;
}) {
  const t = useTranslation();

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={[
        "block w-full px-3 py-1.5 text-left text-sm",
        isDestructive
          ? "text-danger hover:bg-danger/10"
          : "text-foreground hover:bg-hover",
      ].join(" ")}
    >
      {t(labelKey)}
    </button>
  );
}
