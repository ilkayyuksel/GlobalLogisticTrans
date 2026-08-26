"use client";

import { useCallback, useState } from "react";

import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { userFacingMessage } from "@/lib/api/client";
import { listTrips } from "@/lib/api/trips";
import type { Trip } from "@/lib/api/types";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import { toGroupDisplayOrder } from "@/lib/ritten/group-order";
import { RittenDialog } from "./ritten-dialog";

/**
 * What is about to be grouped, before anything is sent.
 *
 * Grouping is easy to do by accident with checkboxes, so the confirmation lists
 * exactly which Trips are involved — booking number and date, the two things an
 * operator recognises a Trip by. It also says plainly that this is a manual
 * group and not a Combination, because the two look identical in the table
 * afterwards.
 *
 * The dates may DIFFER, and that is the point of listing them. One movement
 * often spans two days — a delivery on the 25th, the empty back on the 26th —
 * and those belong in one group. Nothing is moved onto a shared day: each Trip
 * keeps its own planning date, its own truck and its own driver.
 *
 * ── EVERY SELECTED TRIP IS SHOWN, INCLUDING THE ONES OFF SCREEN ─────────────
 * It used to list only the rows that happened to be visible and say "1 of the
 * selected Trips is on a day that is not shown". That is precisely the Trip an
 * operator needs to check: they cannot confirm a group whose other half they
 * have never seen. The dialog therefore FETCHES the selection by id — one
 * request for all of them, whatever days they fall on — and lists them.
 *
 * ── READ IN THE DIRECTION THE CONTAINERS TRAVEL ─────────────────────────────
 * DUB first, ANR second, the same display-only rule the Combination view uses.
 * Where neither prefix applies the planning date decides, ascending, so a list
 * the rule says nothing about still reads in the order the work happens.
 *
 * The group id is never guessed: nothing appears in the table until the backend
 * has answered and the list has been refetched.
 */
/** Whether the selection covers more than one planning date. */
function spansSeveralDays(trips: readonly Trip[]): boolean {
  return new Set(trips.map((trip) => trip.planningDate)).size > 1;
}

export function GroupConfirmDialog({
  tripIds,
  onConfirm,
  onClose,
}: {
  /**
   * THE SELECTION, by id — not the rows on screen.
   *
   * The Trips themselves are fetched from these, so a selection spanning
   * several days is shown in full rather than summarised as a count.
   */
  tripIds: readonly string[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [isGrouping, setIsGrouping] = useState(false);
  const [error, setError] = useState<unknown>(null);

  /*
   * ONE request for the whole selection, not one per Trip. `pageSize` matches
   * the number asked for so nothing can be paged away.
   */
  const selected = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listTrips({ tripIds: [...tripIds], pageSize: tripIds.length }, signal),
      [tripIds],
    ),
    [tripIds],
  );

  const trips = toGroupDisplayOrder(selected.data?.items ?? []);

  async function confirm(): Promise<void> {
    setIsGrouping(true);
    setError(null);

    try {
      await onConfirm();
      onClose();
    } catch (caught: unknown) {
      // Kept open: the rows are still selected and the reason is on screen.
      setError(caught);
    } finally {
      setIsGrouping(false);
    }
  }

  return (
    <RittenDialog title={t("ritten.group.confirmTitle")} onClose={onClose}>
      <div className="px-4 py-3">
        <p className="text-sm text-secondary">
          {t("ritten.group.confirmDescription")}
        </p>

        <p className="mt-2 text-sm font-medium text-foreground">
          {tripIds.length} {t("ritten.group.tripCount")}
        </p>

        {selected.isLoading ? (
          <LoadingState label={t("ritten.group.loading")} />
        ) : null}

        {selected.error ? (
          <ErrorState error={selected.error} onRetry={selected.reload} />
        ) : null}

        {/* Said only when it applies, so it reads as information, not noise. */}
        {spansSeveralDays(trips) ? (
          <p className="mt-2 rounded-md border border-border bg-hover px-3 py-2 text-xs text-secondary">
            {t("ritten.group.crossDay")}
          </p>
        ) : null}

        {/*
          Enough to tell one selected Trip from another and no more: the
          booking, the day it runs, the container when there is one, and the
          direction the document stated.
        */}
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {trips.map((trip) => (
            <li key={trip.id} className="px-3 py-2 text-sm">
              <span className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">
                  {trip.bookingNumber ?? t("ritten.value.empty")}
                </span>
                <span className="whitespace-nowrap tabular-nums text-secondary">
                  {formatCalendarDate(trip.planningDate)}
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-secondary">
                {[
                  trip.containerNumber,
                  trip.direction ? t(`direction.${trip.direction}`) : null,
                  trip.destinationCity,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
          >
            {userFacingMessage(error)}
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={isGrouping || selected.isLoading}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {t("ritten.group.confirmAction")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isGrouping}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("ritten.edit.cancel")}
          </button>
        </div>
      </div>
    </RittenDialog>
  );
}
