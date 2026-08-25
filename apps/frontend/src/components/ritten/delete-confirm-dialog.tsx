"use client";

import { useState } from "react";

import { userFacingMessage } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import { RittenDialog } from "./ritten-dialog";

/**
 * Confirming the deletion of one Trip.
 *
 * ── THIS ONE ASKS, AND EVERYTHING AROUND IT DOES NOT ────────────────────────
 * Completing and reopening are routine, happen many times a day, and are
 * visible in the row a moment later — so they ask nothing. Deleting is none of
 * those things: it takes a transport out of the planning, and an operator who
 * did it by accident will not see it in the list to put it back.
 *
 * The dialog is the application's own, not `window.confirm`. A browser
 * confirmation cannot say WHICH Trip it is about, cannot be styled to show that
 * one button is destructive, and looks identical to every other dialog the
 * browser has ever shown — which is exactly how people learn to click through
 * them.
 *
 * ── THE DESTRUCTIVE BUTTON IS NOT THE EASY ONE ──────────────────────────────
 * "Annuleren" comes first; "Verwijderen" sits second, in the danger tone, and
 * has to be aimed at. Focus lands on the dialog's own close control, which
 * `RittenDialog` places there — so Enter on an unread dialog backs out rather
 * than deleting, which is the property that matters.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * What deletion MEANS is stated rather than implied: the record and its
 * documents are kept and the Trip leaves the planning. Saying "permanently
 * deleted" would be untrue — nothing is erased — and saying nothing would leave
 * an operator guessing which of the two it is.
 */
export function DeleteConfirmDialog({
  trip,
  onConfirm,
  onClose,
}: {
  trip: Trip;
  /** Resolves once the backend accepted it AND the list was refetched. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm(): Promise<void> {
    setIsDeleting(true);
    setError(null);

    try {
      await onConfirm();
      onClose();
    } catch (caught: unknown) {
      // Kept open with the backend's reason: the Trip is untouched and the
      // operator can read why before deciding what to do.
      setError(caught);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <RittenDialog title={t("ritten.delete.title")} onClose={onClose}>
      <div className="px-4 py-3">
        <p className="text-sm text-secondary">{t("ritten.delete.description")}</p>

        {/* WHICH Trip. A confirmation that does not say is not a confirmation. */}
        <div className="mt-3 rounded-md border border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">
            {trip.bookingNumber ?? t("tripDetail.value.noBookingNumber")}
          </p>
          <p className="mt-0.5 text-xs text-secondary">
            {[
              trip.containerNumber,
              formatCalendarDate(trip.planningDate),
              trip.vehicle?.licensePlate,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <p className="mt-3 rounded-md border border-border bg-hover px-3 py-2 text-xs text-secondary">
          {t("ritten.delete.consequence")}
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
          >
            {userFacingMessage(error)}
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          {/* First: backing out must be the easy path. */}
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("ritten.edit.cancel")}
          </button>

          <button
            type="button"
            onClick={() => void confirm()}
            disabled={isDeleting}
            className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
          >
            {isDeleting ? t("ritten.edit.saving") : t("ritten.delete.confirm")}
          </button>
        </div>
      </div>
    </RittenDialog>
  );
}
