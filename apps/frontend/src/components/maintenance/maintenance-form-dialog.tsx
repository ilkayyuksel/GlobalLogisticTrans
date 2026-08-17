"use client";

import { useState } from "react";

import { RittenDialog } from "@/components/ritten/ritten-dialog";
import { ApiError, userFacingMessage } from "@/lib/api/client";
import type {
  CreateMaintenancePayload,
  Maintenance,
  MaintenanceStatus,
} from "@/lib/api/maintenance";
import type { Vehicle } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import {
  MAINTENANCE_TYPES,
  isMaintenanceType,
  maintenanceTypeLabelKey,
} from "@/lib/maintenance/maintenance-types";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Recording maintenance.
 *
 * The two mileage fields are the Administrator's own readings and say so: one
 * is the odometer AT THIS SERVICE, the other the reading at which the next is
 * planned. Nothing derives either, and leaving both empty is normal.
 *
 * The type is a fixed list, chosen in the UI — see `maintenance-types.ts` for
 * what is stored and why nothing was migrated. The backend still accepts any
 * string; this only decides which strings the UI offers.
 */

/** From the backend's create-maintenance.dto.ts. */
const DESCRIPTION_MAX_LENGTH = 2000;
const WORKSHOP_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 2000;
const MILEAGE_MAX = 9_999_999;

export const MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

export function statusLabelKey(status: MaintenanceStatus): TranslationKey {
  return `maintenance.status.${status}` as TranslationKey;
}

interface FormValues {
  vehicleId: string;
  maintenanceType: string;
  status: MaintenanceStatus;
  maintenanceDate: string;
  description: string;
  workshop: string;
  mileage: string;
  cost: string;
  nextMaintenanceDate: string;
  nextMaintenanceMileage: string;
  notes: string;
}

function toFormValues(
  maintenance: Maintenance | null,
  today: string,
): FormValues {
  return {
    vehicleId: maintenance?.vehicleId ?? "",
    maintenanceType: maintenance?.maintenanceType ?? "",
    status: maintenance?.status ?? "PLANNED",
    maintenanceDate: maintenance?.maintenanceDate ?? today,
    description: maintenance?.description ?? "",
    workshop: maintenance?.workshop ?? "",
    mileage: maintenance?.mileage === null || !maintenance ? "" : String(maintenance.mileage),
    cost: maintenance?.cost ?? "",
    nextMaintenanceDate: maintenance?.nextMaintenanceDate ?? "",
    nextMaintenanceMileage:
      maintenance?.nextMaintenanceMileage === null || !maintenance
        ? ""
        : String(maintenance.nextMaintenanceMileage),
    notes: maintenance?.notes ?? "",
  };
}

/** Empty means "no value", which the backend spells null. */
function toPayload(values: FormValues): CreateMaintenancePayload {
  return {
    vehicleId: values.vehicleId,
    status: values.status,
    maintenanceType: emptyToNull(values.maintenanceType),
    maintenanceDate: values.maintenanceDate,
    description: values.description.trim(),
    workshop: emptyToNull(values.workshop),
    mileage: emptyToNumber(values.mileage),
    cost: emptyToNumber(values.cost),
    nextMaintenanceDate: emptyToNull(values.nextMaintenanceDate),
    nextMaintenanceMileage: emptyToNumber(values.nextMaintenanceMileage),
    notes: emptyToNull(values.notes),
  };
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

function emptyToNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function MaintenanceFormDialog({
  maintenance,
  vehicles,
  today,
  onSave,
  onClose,
}: {
  /** Null when recording new maintenance. */
  maintenance: Maintenance | null;
  vehicles: readonly Vehicle[];
  today: string;
  onSave: (payload: CreateMaintenancePayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [values, setValues] = useState<FormValues>(() =>
    toFormValues(maintenance, today),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = (patch: Partial<FormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await onSave(toPayload(values));
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
        maintenance
          ? t("maintenance.form.editTitle")
          : t("maintenance.form.createTitle")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="px-4 py-3">
        {error ? <FormError error={error} /> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("maintenance.form.vehicle")} htmlFor="maintenance-vehicle">
            <select
              id="maintenance-vehicle"
              required
              // A maintenance record is never reassigned to another asset.
              disabled={maintenance !== null}
              value={values.vehicleId}
              onChange={(event) => update({ vehicleId: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
            >
              <option value="">{t("maintenance.form.chooseVehicle")}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.licensePlate}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("maintenance.form.status")} htmlFor="maintenance-status">
            <select
              id="maintenance-status"
              value={values.status}
              onChange={(event) =>
                update({ status: event.target.value as MaintenanceStatus })
              }
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              {MAINTENANCE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(statusLabelKey(status))}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("maintenance.form.type")} htmlFor="maintenance-type">
            <select
              id="maintenance-type"
              value={values.maintenanceType}
              onChange={(event) => update({ maintenanceType: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              <option value="">{t("maintenance.form.typeNone")}</option>
              {MAINTENANCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(maintenanceTypeLabelKey(type))}
                </option>
              ))}
              {/*
                Free text stored before this list existed. It stays selectable
                so that editing anything else about this record cannot silently
                rewrite what someone actually wrote.
              */}
              {values.maintenanceType !== "" &&
              !isMaintenanceType(values.maintenanceType) ? (
                <option value={values.maintenanceType}>
                  {values.maintenanceType}
                </option>
              ) : null}
            </select>
          </Field>

          <Field label={t("maintenance.form.date")} htmlFor="maintenance-date">
            <input
              id="maintenance-date"
              type="date"
              required
              value={values.maintenanceDate}
              onChange={(event) => update({ maintenanceDate: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label={t("maintenance.form.description")}
              htmlFor="maintenance-description"
            >
              <input
                id="maintenance-description"
                required
                maxLength={DESCRIPTION_MAX_LENGTH}
                value={values.description}
                onChange={(event) => update({ description: event.target.value })}
                className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
              />
            </Field>
          </div>

          <Field
            label={t("maintenance.form.workshop")}
            htmlFor="maintenance-workshop"
          >
            <input
              id="maintenance-workshop"
              maxLength={WORKSHOP_MAX_LENGTH}
              value={values.workshop}
              onChange={(event) => update({ workshop: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <Field label={t("maintenance.form.cost")} htmlFor="maintenance-cost">
            <input
              id="maintenance-cost"
              type="number"
              step="0.01"
              min={0}
              value={values.cost}
              onChange={(event) => update({ cost: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <Field
            label={t("maintenance.form.mileage")}
            htmlFor="maintenance-mileage"
            hint={t("maintenance.form.mileageHint")}
          >
            <input
              id="maintenance-mileage"
              type="number"
              step="1"
              min={0}
              max={MILEAGE_MAX}
              value={values.mileage}
              onChange={(event) => update({ mileage: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <Field
            label={t("maintenance.form.nextMileage")}
            htmlFor="maintenance-next-mileage"
          >
            <input
              id="maintenance-next-mileage"
              type="number"
              step="1"
              min={0}
              max={MILEAGE_MAX}
              value={values.nextMaintenanceMileage}
              onChange={(event) =>
                update({ nextMaintenanceMileage: event.target.value })
              }
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <Field
            label={t("maintenance.form.nextDate")}
            htmlFor="maintenance-next-date"
          >
            <input
              id="maintenance-next-date"
              type="date"
              value={values.nextMaintenanceDate}
              onChange={(event) =>
                update({ nextMaintenanceDate: event.target.value })
              }
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("maintenance.form.notes")} htmlFor="maintenance-notes">
              <textarea
                id="maintenance-notes"
                rows={3}
                maxLength={NOTES_MAX_LENGTH}
                value={values.notes}
                onChange={(event) => update({ notes: event.target.value })}
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
              ? t("maintenance.action.saving")
              : t("maintenance.action.save")}
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
