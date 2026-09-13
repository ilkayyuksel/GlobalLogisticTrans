"use client";

import { useState, type FormEvent } from "react";

import { FormError } from "@/components/maintenance/maintenance-form-dialog";
import { RittenDialog } from "@/components/ritten/ritten-dialog";
import { FormField } from "@/components/ui/form-field";
import type { CalendarEvent } from "@/lib/api/calendar-events";
import { toClockLabel } from "@/lib/calendar/clock";
import { useLanguage, useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { longDateLabel } from "@/lib/ritten/date-labels";

/** From the backend's create-calendar-event.dto.ts. */
const TITLE_MAX_LENGTH = 200;

export interface AgendaItemValues {
  title: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`. */
  startTime: string;
  /** `HH:MM`, or null for the backend's one-hour default. */
  endTime: string | null;
}

/**
 * Adding or changing one Agenda item.
 *
 * Adding starts on the day and at the hour of the block that was clicked: the
 * day is shown, and the start is filled in but can still be adjusted — to 10:30,
 * say. Changing offers the title, the day, the start and the end. The end is
 * optional in both; left empty, the backend gives the item one hour.
 *
 * The checks made here — a title, a day, an end after the start — are the ones
 * an operator can fix on the spot. The backend repeats them and decides the
 * rest, the hours of the day among them, and its refusal is shown in the form.
 * Nothing is sent before Opslaan, and Annuleren changes nothing.
 */
export function AgendaItemDialog({
  item,
  date: clickedDate,
  startTime: clickedStartTime,
  onSave,
  onDelete,
  onClose,
}: {
  /** The item being changed; absent when adding. */
  item?: CalendarEvent;
  /** When adding: the day of the block that was clicked. */
  date?: string;
  /** When adding: `HH:MM`, the hour of the block that was clicked. */
  startTime?: string;
  /** Resolves once the backend has stored it. */
  onSave: (values: AgendaItemValues) => Promise<void>;
  /** Only when changing: asks to delete the item. */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const t = useTranslation();
  const { language } = useLanguage();
  const isEditing = item !== undefined;
  const [title, setTitle] = useState(item?.title ?? "");
  const [date, setDate] = useState(item?.date ?? clickedDate ?? "");
  const [startTime, setStartTime] = useState(
    item ? (toClockLabel(item.startTime) ?? "") : (clickedStartTime ?? ""),
  );
  const [endTime, setEndTime] = useState(item ? (toClockLabel(item.endTime) ?? "") : "");
  const [problem, setProblem] = useState<TranslationKey | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function findProblem(): TranslationKey | null {
    if (title.trim() === "") {
      return "agenda.form.titleRequired";
    }

    if (date === "") {
      return "agenda.form.dateRequired";
    }

    if (startTime === "") {
      return "agenda.form.startRequired";
    }

    // Both are "HH:MM", so text order is time order.
    return endTime !== "" && endTime <= startTime ? "agenda.form.endAfterStart" : null;
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
        date,
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

        <FormField label={t("agenda.form.title")} htmlFor="agenda-title">
          <input
            id="agenda-title"
            type="text"
            autoComplete="off"
            maxLength={TITLE_MAX_LENGTH}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
          />
        </FormField>

        {isEditing ? (
          <FormField label={t("agenda.form.date")} htmlFor="agenda-date">
            <input
              id="agenda-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={inputClass}
            />
          </FormField>
        ) : (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              {t("agenda.form.day")}
            </p>
            <p className="text-sm font-medium text-foreground">
              {longDateLabel(date, language)}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t("agenda.form.startTime")} htmlFor="agenda-start">
            <input
              id="agenda-start"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              className={inputClass}
            />
          </FormField>

          <FormField
            label={t("agenda.form.endTime")}
            htmlFor="agenda-end"
            hint={t("agenda.form.endOptional")}
            hintId="agenda-end-hint"
          >
            <input
              id="agenda-end"
              type="time"
              value={endTime}
              aria-describedby="agenda-end-hint"
              onChange={(event) => setEndTime(event.target.value)}
              className={inputClass}
            />
          </FormField>
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
