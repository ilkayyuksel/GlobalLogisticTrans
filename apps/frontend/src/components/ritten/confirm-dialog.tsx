"use client";

import { useState } from "react";

import { userFacingMessage } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { RittenDialog } from "./ritten-dialog";

/**
 * The application's confirmation, for an action worth stopping at.
 *
 * ── WHAT ASKS AND WHAT DOES NOT ─────────────────────────────────────────────
 * Completing is routine, happens many times a day and is visible in the row a
 * moment later, so it asks nothing. Two things do ask:
 *
 *   DELETING     takes a transport out of the planning, and an operator who did
 *                it by accident will not see it in the list to put it back.
 *   REOPENING A  says a called-off transport is happening after all. That is a
 *   CANCELLATION statement about the day's work rather than a correction.
 *
 * ── NOT window.confirm ──────────────────────────────────────────────────────
 * A browser confirmation cannot name the record it is about, cannot mark one
 * button destructive, and looks like every other dialog the browser has ever
 * shown — which is exactly how people learn to click through them.
 *
 * ── THE CONFIRMING BUTTON IS NEVER THE EASY ONE ─────────────────────────────
 * The way out comes first. Focus lands on the dialog's own close control, which
 * `RittenDialog` places there, so Enter on an unread dialog backs out.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function ConfirmDialog({
  titleKey,
  descriptionKey,
  consequenceKey,
  confirmKey,
  tone = "primary",
  children,
  onConfirm,
  onClose,
}: {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  /** A second line, for a consequence worth stating outright. */
  consequenceKey?: TranslationKey;
  confirmKey: TranslationKey;
  /** `danger` for an action that removes something. */
  tone?: "primary" | "danger";
  /** What the action is about — the record, named. */
  children?: React.ReactNode;
  /** Resolves once the backend accepted it AND the list was refetched. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm(): Promise<void> {
    setIsRunning(true);
    setError(null);

    try {
      await onConfirm();
      onClose();
    } catch (caught: unknown) {
      // Kept open with the backend's reason: nothing happened, and the operator
      // can read why before deciding what to do.
      setError(caught);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <RittenDialog title={t(titleKey)} onClose={onClose}>
      <div className="px-4 py-3">
        <p className="text-sm text-secondary">{t(descriptionKey)}</p>

        {children ? <div className="mt-3">{children}</div> : null}

        {consequenceKey ? (
          <p className="mt-3 rounded-md border border-border bg-hover px-3 py-2 text-xs text-secondary">
            {t(consequenceKey)}
          </p>
        ) : null}

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
            disabled={isRunning}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("ritten.edit.cancel")}
          </button>

          <button
            type="button"
            onClick={() => void confirm()}
            disabled={isRunning}
            className={[
              "rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50",
              tone === "danger"
                ? "bg-danger hover:bg-danger/90"
                : "bg-primary hover:bg-primary-hover",
            ].join(" ")}
          >
            {isRunning ? t("ritten.edit.saving") : t(confirmKey)}
          </button>
        </div>
      </div>
    </RittenDialog>
  );
}

/**
 * The Trip an action is about, named.
 *
 * A confirmation that does not say which record it means is not a
 * confirmation — an operator with fifty rows on screen has no way to check.
 */
export function ConfirmedTrip({
  trip,
}: {
  trip: {
    bookingNumber: string | null;
    containerNumber: string | null;
    planningDate: string | null;
    vehicle: { licensePlate: string } | null;
  };
}) {
  const t = useTranslation();

  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-sm font-medium text-foreground">
        {trip.bookingNumber ?? t("tripDetail.value.noBookingNumber")}
      </p>
      <p className="mt-0.5 text-xs text-secondary">
        {[trip.containerNumber, trip.planningDate, trip.vehicle?.licensePlate]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}
