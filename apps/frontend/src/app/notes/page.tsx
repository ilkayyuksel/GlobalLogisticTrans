"use client";

import { useCallback, useState } from "react";

import { NoteDialog } from "@/components/notes/note-dialog";
import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import {
  DeleteIcon,
  EditIcon,
  RowActionButton,
} from "@/components/ritten/row-action-button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
  type Note,
} from "@/lib/api/notes";
import { useTranslation } from "@/lib/i18n/language-provider";

type OpenDialog =
  | { kind: "create" }
  | { kind: "edit"; note: Note }
  | { kind: "delete"; note: Note };

/** Enough of a note to tell it apart in an accessible name. */
const NAME_EXCERPT_LENGTH = 60;

/**
 * Notities: a note is its text, and nothing else.
 *
 * Add, change, delete — no title, category, tag, priority, deadline or status.
 * The list is the backend's, most recently changed first, and it is asked for
 * again after every change, so what is shown is always what is stored.
 */
export default function NotesPage() {
  const t = useTranslation();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const notes = useAsync(
    useCallback((signal: AbortSignal) => listNotes(signal), []),
    [],
  );

  async function create(content: string): Promise<void> {
    await createNote({ content });
    notes.reload();
  }

  async function update(note: Note, content: string): Promise<void> {
    await updateNote(note.id, { content });
    notes.reload();
  }

  async function remove(note: Note): Promise<void> {
    await deleteNote(note.id);
    notes.reload();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          {t("page.notes.title")}
        </h1>
        <button
          type="button"
          onClick={() => setDialog({ kind: "create" })}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
        >
          {t("notes.new")}
        </button>
      </div>

      <Card>
        {notes.isLoading && !notes.data ? (
          <LoadingState label={t("notes.loading")} />
        ) : null}

        {!notes.isLoading && notes.error ? (
          <ErrorState error={notes.error} onRetry={notes.reload} />
        ) : null}

        {notes.data?.length === 0 ? <EmptyState title={t("notes.empty")} /> : null}

        {notes.data?.length ? (
          <ul className="divide-y divide-border">
            {notes.data.map((note) => (
              <li key={note.id} className="flex items-start gap-3 px-5 py-3">
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-foreground">
                  {note.content}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <RowActionButton
                    tone="primary"
                    tooltip={t("notes.edit")}
                    accessibleName={`${t("notes.edit")}: ${excerpt(note.content)}`}
                    isDisabled={false}
                    onClick={() => setDialog({ kind: "edit", note })}
                  >
                    <EditIcon />
                  </RowActionButton>
                  <RowActionButton
                    tone="danger"
                    tooltip={t("notes.delete")}
                    accessibleName={`${t("notes.delete")}: ${excerpt(note.content)}`}
                    isDisabled={false}
                    onClick={() => setDialog({ kind: "delete", note })}
                  >
                    <DeleteIcon />
                  </RowActionButton>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {dialog?.kind === "create" ? (
        <NoteDialog onSave={create} onClose={() => setDialog(null)} />
      ) : null}

      {dialog?.kind === "edit" ? (
        <NoteDialog
          note={dialog.note}
          onSave={(content) => update(dialog.note, content)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          titleKey="notes.deleteDialog.title"
          descriptionKey="notes.deleteDialog.description"
          confirmKey="notes.deleteDialog.confirm"
          tone="danger"
          onConfirm={() => remove(dialog.note)}
          onClose={() => setDialog(null)}
        >
          <p className="line-clamp-4 whitespace-pre-wrap break-words rounded-md border border-border px-3 py-2 text-sm text-foreground">
            {dialog.note.content}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** The first line, shortened — what a screen reader hears after "Bewerken". */
function excerpt(content: string): string {
  const firstLine = content.split("\n")[0];

  return firstLine.length > NAME_EXCERPT_LENGTH
    ? `${firstLine.slice(0, NAME_EXCERPT_LENGTH)}…`
    : firstLine;
}
