"use client";

import { useCallback, useState } from "react";

import { RittenDialog } from "@/components/ritten/ritten-dialog";
import { useAsync } from "@/hooks/use-async";
import { ApiError, userFacingMessage } from "@/lib/api/client";
import { listActiveDrivers } from "@/lib/api/fleet";
import type { CreateAssignmentPayload } from "@/lib/api/vehicles";
import type { VehicleAssignment } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Putting a driver on a vehicle, and changing which driver that is.
 *
 * ── CHANGING A DRIVER IS A NEW ASSIGNMENT ───────────────────────────────────
 * Never an edit of the old one. A vehicle carries different drivers over time,
 * and each period is a record of who drove it then — a Trip planned in July
 * resolves its driver through July's assignment. Rewriting that row would
 * silently change who drove months of finished work.
 *
 * So this form creates a NEW assignment starting on a date the operator gives.
 * The backend closes the previous open-ended one on the day before, keeping it
 * intact with its own driver and its own period. That rule is the backend's and
 * is not reimplemented here; the form only says what it will do.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * When an existing assignment is EDITED, only the end date and the notes are
 * offered: the update endpoint refuses the rest, for the same reason.
 */
export function AssignmentDialog({
  vehicleId,
  assignment,
  current,
  today,
  onSave,
  onClose,
}: {
  vehicleId: string;
  /** The assignment being EDITED. Null when a new one is being created. */
  assignment: VehicleAssignment | null;
  /**
   * The driver this vehicle has right now, when it has one.
   *
   * Only used to explain what creating a new assignment will do to it. The
   * closing itself is the backend's, and nothing here sends it.
   */
  current?: { driverName: string; validFrom: string } | null;
  today: string;
  onSave: (payload: CreateAssignmentPayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const isEditing = assignment !== null;
  const isChangingDriver = !isEditing && Boolean(current);

  const [driverId, setDriverId] = useState(assignment?.driverId ?? "");
  const [validFrom, setValidFrom] = useState(assignment?.validFrom ?? today);
  const [validTo, setValidTo] = useState(assignment?.validTo ?? "");
  const [notes, setNotes] = useState(assignment?.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const drivers = useAsync(
    useCallback((signal: AbortSignal) => listActiveDrivers(signal), []),
    [],
  );

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        vehicleId,
        driverId,
        validFrom,
        // Empty means open-ended, which the backend stores as null.
        validTo: validTo.trim() === "" ? null : validTo,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      onClose();
    } catch (caught: unknown) {
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RittenDialog
      title={
        isEditing
          ? t("vehicles.assignment.edit")
          : isChangingDriver
            ? t("vehicles.assignment.changeTitle")
            : t("vehicles.assignment.link")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="px-4 py-3">
        {error ? <FormError error={error} /> : null}

        {/*
          What this will do to the driver the vehicle has now. Said before the
          fields rather than after, because it is the reason for the date below.
        */}
        {isChangingDriver && current ? (
          <p className="mb-4 rounded-md border border-border bg-hover px-3 py-2 text-xs text-secondary">
            <span className="font-medium text-foreground">
              {t("vehicles.assignment.currentDriver")}: {current.driverName}
            </span>{" "}
            {t("vehicles.assignment.supersedes")}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {isEditing ? (
            /*
              A disabled dropdown reads as "this is broken". The driver of an
              existing assignment is simply not editable, so it is shown as the
              fact it is, with the way to change it named.
            */
            <Field
              label={t("vehicles.assignment.driver")}
              htmlFor="assignment-driver-note"
            >
              <p
                id="assignment-driver-note"
                className="text-xs text-muted"
              >
                {t("vehicles.assignment.driverReadOnly")}
              </p>
            </Field>
          ) : (
            <Field
              label={t("vehicles.assignment.driver")}
              htmlFor="assignment-driver"
            >
              <select
                id="assignment-driver"
                required
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
              >
                <option value="">
                  {t("vehicles.assignment.chooseDriver")}
                </option>
                {(drivers.data?.items ?? []).map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field
            label={
              isChangingDriver
                ? t("vehicles.assignment.startsOn")
                : t("vehicles.assignment.validFrom")
            }
            htmlFor="assignment-valid-from"
          >
            <input
              id="assignment-valid-from"
              type="date"
              required
              disabled={isEditing}
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
            />
          </Field>

          <Field
            label={t("vehicles.assignment.validTo")}
            htmlFor="assignment-valid-to"
            hint={t("vehicles.assignment.validToHint")}
          >
            <input
              id="assignment-valid-to"
              type="date"
              value={validTo}
              onChange={(event) => setValidTo(event.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label={t("vehicles.assignment.notes")}
              htmlFor="assignment-notes"
            >
              <textarea
                id="assignment-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
              />
            </Field>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving
              ? t("vehicles.assignment.saving")
              : t("vehicles.assignment.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("vehicles.assignment.cancel")}
          </button>
        </div>
      </form>
    </RittenDialog>
  );
}

function FormError({ error }: { error: unknown }) {
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as string[])
      : [];

  return (
    <div
      role="alert"
      className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
    >
      {userFacingMessage(error)}
      {details.length > 0 ? (
        <ul className="mt-1 list-inside list-disc text-xs">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
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
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
