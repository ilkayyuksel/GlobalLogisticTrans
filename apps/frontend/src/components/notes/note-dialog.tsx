"use client";

import { useState, type FormEvent } from "react";

import { FormError } from "@/components/maintenance/maintenance-form-dialog";
import { RittenDialog } from "@/components/ritten/ritten-dialog";
import type { Note } from "@/lib/api/notes";
import { useTranslation } from "@/lib/i18n/language-provider";

/** From the backend's create-note.dto.ts. */
const CONTENT_MAX_LENGTH = 50_000;

/**
 * Writing a new note or changing one: a textarea, Opslaan and Annuleren.
 *
 * Plain text — the application has no rich-text editor, and a note needs none.
 * Text of nothing but spaces or blank lines is empty and is not sent; the
 * backend refuses it too. Nothing is sent before Opslaan, and Annuleren changes
 * nothing.
 */
export function NoteDialog({
  note,
  onSave,
  onClose,
}: {
  /** The note being changed; absent when adding. */
  note?: Note;
  /** Resolves once the backend has stored the text. */
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [content, setContent] = useState(note?.content ?? "");
  const [isEmpty, setIsEmpty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (content.trim() === "") {
      setIsEmpty(true);

      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(content.trim());
      onClose();
    } catch (caught: unknown) {
      // The dialog stays open with the text and the backend's reason.
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RittenDialog
      title={t(note ? "notes.dialog.editTitle" : "notes.dialog.createTitle")}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="space-y-3 px-4 py-3">
        {error ? <FormError error={error} /> : null}

        <div>
          <label
            htmlFor="note-content"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
          >
            {t("notes.dialog.label")}
          </label>
          <textarea
            id="note-content"
            rows={6}
            maxLength={CONTENT_MAX_LENGTH}
            value={content}
            aria-invalid={isEmpty}
            aria-describedby={isEmpty ? "note-content-error" : undefined}
            onChange={(event) => {
              setContent(event.target.value);
              setIsEmpty(false);
            }}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          />
          {isEmpty ? (
            <p id="note-content-error" role="alert" className="mt-1 text-sm text-danger">
              {t("notes.dialog.required")}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("notes.dialog.saving") : t("notes.dialog.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("notes.dialog.cancel")}
          </button>
        </div>
      </form>
    </RittenDialog>
  );
}
