"use client";

import { useState } from "react";

import { ApiError, userFacingMessage } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";

import { RittenDialog } from "./ritten-dialog";

/**
 * The Trip's internal notes, editable without leaving the list.
 *
 * ── IT IS THE SAME NOTE, NOT A SECOND ONE ───────────────────────────────────
 * This edits `Trip.internalNotes` — the identical column the Trip detail page
 * writes, through the identical `PATCH /api/v1/trips/:id`. There is no quick
 * note, no draft and no list-only copy: an operator who types here and then
 * opens the detail page sees what they typed, and the reverse holds too. The
 * detail page keeps working exactly as it did; this is a second door onto one
 * room.
 *
 * ── WHY THE OWNER SAVES AND NOT THIS ────────────────────────────────────────
 * The same contract `InlineCell` has: this hands the finished STRING to its
 * owner and lets the page decide what an empty box means and how the row is
 * updated afterwards. The page already owns every Trip mutation, and a dialog
 * that called the API itself would be a second place where that could drift.
 *
 * NOTHING IS PAINTED OPTIMISTICALLY. The dialog closes only once the backend
 * has accepted the change, and a refusal keeps it open with the text still in
 * the box, so a note is never lost to a failed save.
 */

/** `INTERNAL_NOTES_MAX_LENGTH` in the backend's `create-trip.dto.ts`. */
const INTERNAL_NOTES_MAX_LENGTH = 2000;

export function NotesDialog({
  trip,
  onSave,
  onClose,
}: {
  trip: Trip;
  /**
   * Persists the note. Rejects with the backend's own error.
   *
   * Receives the raw text: the backend trims it and stores a whitespace-only
   * value as null, so nothing here has to decide what "empty" means.
   */
  onSave: (notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [value, setValue] = useState(trip.internalNotes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(): Promise<void> {
    setIsSaving(true);
    setError(null);

    try {
      await onSave(value);
      onClose();
    } catch (caught: unknown) {
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RittenDialog
      title={t("tripDetail.field.internalNotes")}
      titleExtra={
        trip.bookingNumber ? (
          <span className="text-sm font-normal text-muted">
            {trip.bookingNumber}
          </span>
        ) : null
      }
      onClose={onClose}
    >
      <div className="px-4 py-4">
        <label className="sr-only" htmlFor="ritten-internal-notes">
          {t("tripDetail.field.internalNotes")}
        </label>
        <textarea
          id="ritten-internal-notes"
          rows={6}
          autoFocus
          maxLength={INTERNAL_NOTES_MAX_LENGTH}
          value={value}
          disabled={isSaving}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground disabled:opacity-50"
        />

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
          >
            {userFacingMessage(error)}
            {error instanceof ApiError && Array.isArray(error.details) ? (
              <span className="mt-0.5 block text-xs">
                {(error.details as string[]).join(" · ")}
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("ritten.edit.saving") : t("ritten.edit.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("ritten.edit.cancel")}
          </button>
        </div>
      </div>
    </RittenDialog>
  );
}
