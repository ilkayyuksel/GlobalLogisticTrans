"use client";

import { useState } from "react";

import { FormError } from "@/components/maintenance/maintenance-form-dialog";
import { RittenDialog } from "@/components/ritten/ritten-dialog";
import type {
  CompleteMaintenancePayload,
  Maintenance,
} from "@/lib/api/maintenance";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import { maintenanceTypeLabel } from "@/lib/maintenance/maintenance-types";

/** From the backend's create-maintenance.dto.ts. */
const NOTES_MAX_LENGTH = 2000;

/**
 * "Onderhoud voltooien".
 *
 * Nothing is sent until Opslaan: Annuleren closes the dialog and the record is
 * exactly as it was. The backend then keeps this cycle in the record's history
 * and plans the SAME record again on the next date — there is no second record.
 *
 * The next date is required, and checked here before any request, so an
 * incomplete form never reaches the backend. The completion date starts at
 * today; it can be set back for work done earlier, never forward — the backend
 * refuses a future one as well.
 */
export function CompleteMaintenanceDialog({
  maintenance,
  today,
  onComplete,
  onClose,
}: {
  maintenance: Maintenance;
  /** `YYYY-MM-DD`. */
  today: string;
  /** Resolves once the backend has stored the completion. */
  onComplete: (payload: CompleteMaintenancePayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [completedOn, setCompletedOn] = useState(today);
  const [nextMaintenanceDate, setNextMaintenanceDate] = useState(
    initialNextDate(maintenance),
  );
  const [notes, setNotes] = useState("");
  const [isMissingNextDate, setIsMissingNextDate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (nextMaintenanceDate.trim() === "") {
      setIsMissingNextDate(true);

      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onComplete({
        // The cycle this dialog shows; the backend refuses it once completed.
        plannedDate: maintenance.maintenanceDate,
        completedOn,
        nextMaintenanceDate,
        notes: notes.trim() === "" ? null : notes.trim(),
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
    <RittenDialog title={t("maintenance.complete.title")} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4 px-4 py-3">
        {error ? <FormError error={error} /> : null}

        <p className="text-sm text-foreground">
          <span className="font-semibold">
            {maintenance.vehicle?.licensePlate ?? t("maintenance.value.empty")}
          </span>{" "}
          · {maintenanceTypeLabel(maintenance.maintenanceType, t) ?? maintenance.description}{" "}
          · {t("maintenance.complete.plannedFor")}{" "}
          <span className="tabular-nums">
            {formatCalendarDate(maintenance.maintenanceDate)}
          </span>
        </p>
        <p className="text-xs text-secondary">{t("maintenance.complete.explanation")}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("maintenance.complete.completedOn")} htmlFor="completion-date">
            <input
              id="completion-date"
              type="date"
              required
              max={today}
              value={completedOn}
              onChange={(event) => setCompletedOn(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label={t("maintenance.complete.nextDate")} htmlFor="completion-next-date">
            <input
              id="completion-next-date"
              type="date"
              required
              aria-invalid={isMissingNextDate}
              aria-describedby={isMissingNextDate ? "completion-next-date-error" : undefined}
              value={nextMaintenanceDate}
              onChange={(event) => {
                setNextMaintenanceDate(event.target.value);
                setIsMissingNextDate(false);
              }}
              className={inputClass}
            />
            {isMissingNextDate ? (
              <p id="completion-next-date-error" role="alert" className="mt-1 text-xs text-danger">
                {t("maintenance.complete.nextRequired")}
              </p>
            ) : null}
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("maintenance.complete.notes")} htmlFor="completion-notes">
              <textarea
                id="completion-notes"
                rows={3}
                maxLength={NOTES_MAX_LENGTH}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("maintenance.action.saving") : t("maintenance.action.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("maintenance.action.cancel")}
          </button>
        </div>
      </form>
    </RittenDialog>
  );
}

/**
 * A next date the Administrator already planned for the cycle after this one,
 * if there is one. After a completion the record's next date equals its own
 * planned date, which is not a plan for the cycle after it — so it is not
 * offered then.
 */
function initialNextDate(maintenance: Maintenance): string {
  const planned = maintenance.nextMaintenanceDate;

  return planned !== null && planned > maintenance.maintenanceDate ? planned : "";
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
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
