"use client";

import { useState } from "react";

import { RittenDialog } from "@/components/ritten/ritten-dialog";
import { ApiError, userFacingMessage } from "@/lib/api/client";
import type { CreateVehiclePayload } from "@/lib/api/vehicles";
import type { Driver, Vehicle } from "@/lib/api/types";
import {
  DEFAULT_FLEET_COLOR,
  FLEET_COLORS,
  toStoredColor,
} from "@/lib/fleet-colors";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Creating and editing a Vehicle.
 *
 * ── WHAT THIS FORM ASKS FOR, AND WHY IT IS LESS THAN THE MODEL HOLDS ─────────
 * Four fields: plate, planning colour, brand and model. Those are what a
 * planner uses to recognise a truck in a list.
 *
 * `year`, `description` and `notes` exist on the model but are deliberately not
 * asked for. They were never used in planning, and every optional field in a
 * form that is filled in daily is a small tax on the person filling it. Since
 * all three are optional on both endpoints, they are simply not SENT — an
 * existing vehicle that has them keeps them, because a PATCH that omits a field
 * leaves it untouched. Nothing is cleared by dropping a field from this form.
 *
 * `isActive` is absent for a different reason: activation is its own operation
 * with its own rules, and the update endpoint refuses the field.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── THE DRIVER IS NOT A VEHICLE FIELD ───────────────────────────────────────
 * A new Vehicle may be given a driver here, and that is NOT stored on the
 * Vehicle: it creates a VehicleAssignment starting today, through the existing
 * assignment API. The distinction matters operationally — an assignment has a
 * date range and is what gives a Trip its EFFECTIVE driver, while a Trip's own
 * driver column is a per-trip override this form never touches — so the label
 * says "from today" rather than pretending the truck has an owner.
 *
 * An EXISTING vehicle's driver is deliberately not editable here. Changing it
 * means ending one assignment and starting another, which is a dated decision
 * with history behind it; the vehicle page owns that, and duplicating it in a
 * create form would be a second way to do the same thing.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Validation is the backend's. The only checks here are the ones the browser
 * does for free, so an obvious mistake costs no round trip; everything else is
 * reported as the backend worded it, including its field-level details.
 */

/** From the backend's create-vehicle.dto.ts. */
const LICENSE_PLATE_MAX_LENGTH = 20;
const BRAND_MAX_LENGTH = 100;
const MODEL_MAX_LENGTH = 100;

interface FormValues {
  licensePlate: string;
  displayColor: string;
  brand: string;
  model: string;
  /** Empty means no assignment is created. Only offered when creating. */
  driverId: string;
}

function toFormValues(vehicle: Vehicle | null): FormValues {
  return {
    licensePlate: vehicle?.licensePlate ?? "",
    displayColor: vehicle?.displayColor ?? DEFAULT_FLEET_COLOR,
    brand: vehicle?.brand ?? "",
    model: vehicle?.model ?? "",
    driverId: "",
  };
}

/** Empty means "no value", which the backend spells null. */
function toPayload(values: FormValues): CreateVehiclePayload {
  return {
    licensePlate: values.licensePlate.trim(),
    displayColor: toStoredColor(values.displayColor),
    brand: emptyToNull(values.brand),
    model: emptyToNull(values.model),
  };
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export function VehicleFormDialog({
  vehicle,
  drivers,
  onSave,
  onClose,
}: {
  /** Null when creating. */
  vehicle: Vehicle | null;
  /** Active drivers, fetched once by the page. Empty while they load. */
  drivers: readonly Driver[];
  /**
   * Saves the vehicle. `driverId` is present only when creating and a driver
   * was chosen; the page turns it into a VehicleAssignment.
   */
  onSave: (payload: CreateVehiclePayload, driverId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [values, setValues] = useState<FormValues>(() => toFormValues(vehicle));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = (patch: Partial<FormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await onSave(
        toPayload(values),
        values.driverId === "" ? null : values.driverId,
      );
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
        vehicle ? t("vehicles.form.editTitle") : t("vehicles.form.createTitle")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="px-4 py-3">
        {error ? <FormError error={error} /> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("vehicles.form.licensePlate")} htmlFor="vehicle-plate">
            <input
              id="vehicle-plate"
              required
              maxLength={LICENSE_PLATE_MAX_LENGTH}
              value={values.licensePlate}
              onChange={(event) => update({ licensePlate: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <Field label={t("vehicles.form.brand")} htmlFor="vehicle-brand">
            <input
              id="vehicle-brand"
              maxLength={BRAND_MAX_LENGTH}
              value={values.brand}
              onChange={(event) => update({ brand: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <Field label={t("vehicles.form.model")} htmlFor="vehicle-model">
            <input
              id="vehicle-model"
              maxLength={MODEL_MAX_LENGTH}
              value={values.model}
              onChange={(event) => update({ model: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <ColorField
            value={values.displayColor}
            onChange={(displayColor) => update({ displayColor })}
          />

          <DriverField
            isCreating={vehicle === null}
            drivers={drivers}
            value={values.driverId}
            onChange={(driverId) => update({ driverId })}
          />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("vehicles.action.saving") : t("vehicles.action.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("vehicles.action.cancel")}
          </button>
        </div>
      </form>
    </RittenDialog>
  );
}

/**
 * The driver this truck will be assigned to, from today.
 *
 * A plain select over the active drivers the page already loaded. When editing
 * it becomes a sentence rather than a control: the change belongs to the
 * vehicle page, where the assignment's dates are visible.
 */
function DriverField({
  isCreating,
  drivers,
  value,
  onChange,
}: {
  isCreating: boolean;
  drivers: readonly Driver[];
  value: string;
  onChange: (driverId: string) => void;
}) {
  const t = useTranslation();

  if (!isCreating) {
    return (
      <Field label={t("vehicles.form.driver")} htmlFor="vehicle-driver-note">
        <p id="vehicle-driver-note" className="text-xs text-muted">
          {t("vehicles.form.driverEditHint")}
        </p>
      </Field>
    );
  }

  return (
    <Field label={t("vehicles.form.driver")} htmlFor="vehicle-driver">
      <select
        id="vehicle-driver"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
      >
        <option value="">{t("vehicles.form.driverNone")}</option>
        {drivers.map((driver) => (
          <option key={driver.id} value={driver.id}>
            {driver.name}
          </option>
        ))}
      </select>
      {/* Says what choosing one actually does, because it is not a column. */}
      <p className="mt-1 text-[11px] text-muted">
        {t("vehicles.form.driverHint")}
      </p>
    </Field>
  );
}

/**
 * The planning colour, as a colour rather than as a hex code.
 *
 * Typing `#2563eb` asks someone to know what that looks like. The palette
 * answers the common case in one click, and the native picker — which is what
 * `type="color"` is — covers the rest. Either way the value stored is the same
 * six-digit hex the backend validates, so nothing about the API changes.
 */
function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const t = useTranslation();

  return (
    <Field
      label={t("vehicles.form.displayColor")}
      htmlFor="vehicle-color"
      hint={t("vehicles.form.displayColorHint")}
    >
      <div className="flex items-center gap-2">
        <input
          id="vehicle-color"
          type="color"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-card p-1"
        />

        <div className="flex flex-wrap gap-1">
          {FLEET_COLORS.map((color) => {
            const isSelected = toStoredColor(value) === color;

            return (
              <button
                key={color}
                type="button"
                onClick={() => onChange(color)}
                aria-label={color}
                // The chosen swatch is marked for a screen reader as well as
                // visually: a ring alone says nothing to anyone not looking.
                aria-pressed={isSelected}
                style={{ backgroundColor: color }}
                className={[
                  "h-6 w-6 rounded-md border",
                  isSelected
                    ? "border-foreground ring-2 ring-primary"
                    : "border-border",
                ].join(" ")}
              />
            );
          })}
        </div>
      </div>
    </Field>
  );
}

/** The backend's refusal, including the field-level detail it returns. */
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
