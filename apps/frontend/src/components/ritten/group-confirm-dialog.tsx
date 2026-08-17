"use client";

import { useState } from "react";

import { userFacingMessage } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
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
 * The group id is never guessed: nothing appears in the table until the backend
 * has answered and the list has been refetched.
 */
export function GroupConfirmDialog({
  trips,
  onConfirm,
  onClose,
}: {
  trips: readonly Trip[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [isGrouping, setIsGrouping] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
          {trips.length} {t("ritten.group.tripCount")}
        </p>

        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {trips.map((trip) => (
            <li
              key={trip.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="font-medium text-foreground">
                {trip.bookingNumber}
              </span>
              <span className="tabular-nums text-secondary">
                {formatCalendarDate(trip.planningDate)}
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
            disabled={isGrouping}
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
