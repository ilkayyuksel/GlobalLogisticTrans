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
 * Putting a driver on a vehicle.
 *
 * The fields are exactly what the backend accepts. When an existing assignment
 * is being edited, only the end date and the notes are offered — the vehicle,
 * the driver and the start date are refused by the update endpoint, because
 * changing who drove what from when would rewrite history rather than record a
 * decision.
 *
 * Leaving the end date empty makes the assignment open-ended, which the BACKEND
 * treats as closing the previous open-ended one for that vehicle or driver.
 * That rule is not reimplemented here; the form only says what it does.
 */
export function AssignmentDialog({
  vehicleId,
  assignment,
  today,
  onSave,
  onClose,
}: {
  vehicleId: string;
  /** Null when creating a new assignment. */
  assignment: VehicleAssignment | null;
  today: string;
  onSave: (payload: CreateAssignmentPayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const isEditing = assignment !== null;

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
          : t("vehicles.assignment.link")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="px-4 py-3">
        {error ? <FormError error={error} /> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t("vehicles.assignment.driver")}
            htmlFor="assignment-driver"
          >
            <select
              id="assignment-driver"
              required
              // The backend refuses a driver change; end the assignment instead.
              disabled={isEditing}
              value={driverId}
              onChange={(event) => setDriverId(event.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
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

          <Field
            label={t("vehicles.assignment.validFrom")}
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
