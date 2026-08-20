"use client";

import { useState } from "react";

import { RittenDialog } from "@/components/ritten/ritten-dialog";
import { ApiError, userFacingMessage } from "@/lib/api/client";
import type { CreateDriverPayload } from "@/lib/api/drivers";
import type { Driver } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Creating and editing a Driver.
 *
 * Every field the backend's `CreateDriverDto` accepts, and no others. This is
 * the one screen where a driver's details are maintained, so leaving the
 * seldom-used ones out would mean they could never be entered at all — unlike
 * the Vehicle form, which is filled in daily and deliberately asks for less.
 *
 * `isActive` is absent: activation is its own operation with its own rules, and
 * the update endpoint refuses the field.
 *
 * Validation is the backend's. The only checks here are the ones the browser
 * does for free, so an obvious mistake costs no round trip; everything else is
 * reported as the backend worded it, including its field-level details.
 */

/** From the backend's create-driver.dto.ts. */
const NAME_MAX_LENGTH = 200;
const LICENCE_NUMBER_MAX_LENGTH = 50;
const PHONE_MAX_LENGTH = 50;
const EMAIL_MAX_LENGTH = 255;
const EMERGENCY_CONTACT_MAX_LENGTH = 200;
const NOTES_MAX_LENGTH = 2000;

interface FormValues {
  name: string;
  licenceNumber: string;
  phoneNumber: string;
  email: string;
  emergencyContact: string;
  notes: string;
}

function toFormValues(driver: Driver | null): FormValues {
  return {
    name: driver?.name ?? "",
    licenceNumber: driver?.licenceNumber ?? "",
    phoneNumber: driver?.phoneNumber ?? "",
    email: driver?.email ?? "",
    emergencyContact: driver?.emergencyContact ?? "",
    notes: driver?.notes ?? "",
  };
}

/** Empty means "no value", which the backend spells null. */
function toPayload(values: FormValues): CreateDriverPayload {
  return {
    name: values.name.trim(),
    licenceNumber: emptyToNull(values.licenceNumber),
    phoneNumber: emptyToNull(values.phoneNumber),
    email: emptyToNull(values.email),
    emergencyContact: emptyToNull(values.emergencyContact),
    notes: emptyToNull(values.notes),
  };
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export function DriverFormDialog({
  driver,
  onSave,
  onClose,
}: {
  /** Null when creating. */
  driver: Driver | null;
  onSave: (payload: CreateDriverPayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [values, setValues] = useState<FormValues>(() => toFormValues(driver));
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
      // The dialog stays open with the values intact: a refused licence number
      // is something to correct here, not to retype from the start.
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RittenDialog
      title={
        driver ? t("drivers.form.editTitle") : t("drivers.form.createTitle")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <Field
          id="driver-name"
          label={t("drivers.form.name")}
          value={values.name}
          maxLength={NAME_MAX_LENGTH}
          isRequired
          onChange={(name) => update({ name })}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="driver-licence"
            label={t("drivers.form.licenceNumber")}
            value={values.licenceNumber}
            maxLength={LICENCE_NUMBER_MAX_LENGTH}
            hint={t("drivers.form.licenceNumberHint")}
            onChange={(licenceNumber) => update({ licenceNumber })}
          />
          <Field
            id="driver-phone"
            label={t("drivers.form.phoneNumber")}
            value={values.phoneNumber}
            maxLength={PHONE_MAX_LENGTH}
            onChange={(phoneNumber) => update({ phoneNumber })}
          />
          <Field
            id="driver-email"
            label={t("drivers.form.email")}
            value={values.email}
            type="email"
            maxLength={EMAIL_MAX_LENGTH}
            onChange={(email) => update({ email })}
          />
          <Field
            id="driver-emergency"
            label={t("drivers.form.emergencyContact")}
            value={values.emergencyContact}
            maxLength={EMERGENCY_CONTACT_MAX_LENGTH}
            onChange={(emergencyContact) => update({ emergencyContact })}
          />
        </div>

        <div>
          <label
            htmlFor="driver-notes"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
          >
            {t("drivers.form.notes")}
          </label>
          <textarea
            id="driver-notes"
            value={values.notes}
            maxLength={NOTES_MAX_LENGTH}
            rows={3}
            onChange={(event) => update({ notes: event.target.value })}
            className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
          />
        </div>

        {error ? <FormError error={error} /> : null}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
          >
            {t("drivers.form.cancel")}
          </button>
          <button
            type="submit"
            disabled={isSaving || values.name.trim() === ""}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("drivers.form.saving") : t("drivers.form.save")}
          </button>
        </div>
      </form>
    </RittenDialog>
  );
}

/** The backend's refusal, worded as it worded it — including field detail. */
function FormError({ error }: { error: unknown }) {
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as string[])
      : [];

  return (
    <div
      role="alert"
      className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
    >
      <p className="font-medium text-danger">{userFacingMessage(error)}</p>
      {details.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-xs text-secondary">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  maxLength,
  type = "text",
  isRequired = false,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  type?: "text" | "email";
  isRequired?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={isRequired}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
      />
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
