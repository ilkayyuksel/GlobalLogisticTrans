"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { FormError } from "@/components/maintenance/maintenance-form-dialog";
import { RittenDialog } from "@/components/ritten/ritten-dialog";
import type { CalendarEvent } from "@/lib/api/calendar-events";
import { toClockLabel } from "@/lib/calendar/clock";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/** From the backend's create-calendar-event.dto.ts. */
const TITLE_MAX_LENGTH = 200;

export interface AgendaItemValues {
  title: string;
  /** `HH:MM`. */
  startTime: string;
  /** `HH:MM`, or null for the backend's one-hour default. */
  endTime: string | null;
}

/**
 * Adding or changing one Agenda item.
 *
 * Adding starts at the hour that was clicked: the start is shown, not asked.
 * Changing offers the title, the start and the end. The end is optional in both
 * — left empty, the backend gives the item one hour.
 *
 * The two checks made here — a title, an end after the start — are the ones an
 * operator can fix on the spot. The backend repeats them and decides the rest,
 * the hours of the day among them, and its refusal is shown in the form. Nothing
 * is sent before Opslaan, and Annuleren changes nothing.
 */
export function AgendaItemDialog({
  item,
  startTime: clickedStartTime,
  onSave,
  onDelete,
  onClose,
}: {
  /** The item being changed; absent when adding. */
  item?: CalendarEvent;
  /** `HH:MM` — the hour that was clicked, when adding. */
  startTime?: string;
  /** Resolves once the backend has stored it. */
  onSave: (values: AgendaItemValues) => Promise<void>;
  /** Only when changing: asks to delete the item. */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const t = useTranslation();
  const isEditing = item !== undefined;
  const [title, setTitle] = useState(item?.title ?? "");
  const [startTime, setStartTime] = useState(
    item ? (toClockLabel(item.startTime) ?? "") : (clickedStartTime ?? ""),
  );
  const [endTime, setEndTime] = useState(
    item ? (toClockLabel(item.endTime) ?? "") : "",
  );
  const [problem, setProblem] = useState<TranslationKey | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function findProblem(): TranslationKey | null {
    if (title.trim() === "") {
      return "agenda.form.titleRequired";
    }

    if (startTime === "") {
      return "agenda.form.startRequired";
    }

    // Both are "HH:MM", so text order is time order.
    return endTime !== "" && endTime <= startTime
      ? "agenda.form.endAfterStart"
      : null;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const found = findProblem();

    setProblem(found);

    if (found) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        title: title.trim(),
        startTime,
        endTime: endTime === "" ? null : endTime,
      });
      onClose();
    } catch (caught: unknown) {
      // The dialog stays open with what was typed and the backend's reason.
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground";

  return (
    <RittenDialog
      title={t(isEditing ? "agenda.form.editTitle" : "agenda.form.createTitle")}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="space-y-4 px-4 py-3">
        {error ? <FormError error={error} /> : null}

        <Field label={t("agenda.form.title")} htmlFor="agenda-title">
          <input
            id="agenda-title"
            type="text"
            required
            autoComplete="off"
            maxLength={TITLE_MAX_LENGTH}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {isEditing ? (
            <Field label={t("agenda.form.startTime")} htmlFor="agenda-start">
              <input
                id="agenda-start"
                type="time"
                required
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className={inputClass}
              />
            </Field>
          ) : (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                {t("agenda.form.startTime")}
              </p>
              <p className="py-1.5 text-sm font-medium tabular-nums text-foreground">
                {startTime}
              </p>
            </div>
          )}

          <Field label={t("agenda.form.endTime")} htmlFor="agenda-end">
            <input
              id="agenda-end"
              type="time"
              value={endTime}
              aria-describedby="agenda-end-hint"
              onChange={(event) => setEndTime(event.target.value)}
              className={inputClass}
            />
            <p id="agenda-end-hint" className="mt-1 text-xs text-secondary">
              {t("agenda.form.endOptional")}
            </p>
          </Field>
        </div>

        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {t(problem)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("agenda.form.saving") : t("agenda.form.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("agenda.form.cancel")}
          </button>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={isSaving}
              className="ml-auto rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/5 disabled:opacity-50"
            >
              {t("agenda.form.delete")}
            </button>
          ) : null}
        </div>
      </form>
    </RittenDialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
