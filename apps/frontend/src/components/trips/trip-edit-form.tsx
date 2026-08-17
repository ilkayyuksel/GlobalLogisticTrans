"use client";

import { useCallback, useMemo, useState } from "react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAsync } from "@/hooks/use-async";
import { ApiError, userFacingMessage } from "@/lib/api/client";
import { listActiveVehicles } from "@/lib/api/fleet";
import type { UpdateTripPayload } from "@/lib/api/trips";
import type { Trip, Vehicle } from "@/lib/api/types";
import { toFleetOptions, type FleetOption } from "@/lib/fleet-options";
import { useTranslation } from "@/lib/i18n/language-provider";
import {
  MINUTES_PER_HOUR,
  parseWaitingTime,
  toWaitingTimeParts,
} from "@/lib/waiting-time";

/**
 * Editing the manual fields of a Trip.
 *
 * The form contains only fields `UpdateTripDto` accepts. Booking number,
 * terminal, container type, destination, times, status and the original
 * planning date are absent because the backend refuses them — its validation
 * runs with `forbidNonWhitelisted`, so sending one is a 400 rather than a
 * silent no-op. They are shown read-only elsewhere on the page instead.
 *
 * `driverId` is the one field the backend WOULD accept that is deliberately not
 * offered. It is the per-Trip driver override, and a Trip's driver now follows
 * from its vehicle's assignment; a second manual mechanism let one truck carry
 * two different drivers on one day with nothing to say which was true. The
 * column stays in the backend, and this form simply never writes it.
 *
 * The limits below are the backend's own constraints, repeated here only to
 * catch a mistake before a round trip. The backend still validates everything;
 * this never decides that a value is acceptable, only that it is obviously not.
 */

/** From the backend's create-trip.dto.ts. */
const CONTAINER_NUMBER_MAX_LENGTH = 100;
const INTERNAL_NOTES_MAX_LENGTH = 2000;
const DISTANCE_KM_MAX = 999_999.99;

/** The option value standing for "no vehicle". */
const NONE = "";

interface FormValues {
  containerNumber: string;
  planningDate: string;
  vehicleId: string;
  /* Hours and minutes on screen; one integer in the database. */
  waitingHours: string;
  waitingMinutes: string;
  distanceKm: string;
  executionDatetime: string;
  internalNotes: string;
}

/**
 * The stored minutes as the two fields a person fills in.
 *
 * Strings because that is what an input holds; the conversion itself is
 * shared with the Ritten table so the two cannot disagree.
 */
function waitingParts(trip: Trip): { hours: string; minutes: string } | null {
  const parts = toWaitingTimeParts(trip.waitingTimeMinutes);

  return parts
    ? { hours: String(parts.hours), minutes: String(parts.minutes) }
    : null;
}

function toFormValues(trip: Trip): FormValues {
  return {
    containerNumber: trip.containerNumber ?? "",
    planningDate: trip.planningDate ?? "",
    vehicleId: trip.vehicleId ?? NONE,
    waitingHours: waitingParts(trip)?.hours ?? "",
    waitingMinutes: waitingParts(trip)?.minutes ?? "",
    distanceKm: trip.distanceKm ?? "",
    // The input needs `YYYY-MM-DDTHH:mm`; the backend sends a full ISO string.
    executionDatetime: trip.executionDatetime
      ? trip.executionDatetime.slice(0, 16)
      : "",
    internalNotes: trip.internalNotes ?? "",
  };
}

/**
 * The active vehicles a picker can offer.
 *
 * Loaded once when the form opens — not one request per Trip and not one per
 * row of anything. Only ACTIVE vehicles are requested, because the backend
 * refuses to assign an inactive one and offering it would produce a guaranteed
 * rejection.
 *
 * A failure here is deliberately quiet: the rest of the form still works, and
 * the picker says it could not load rather than blocking an edit to the notes.
 * The one thing that must not happen is silently dropping the Trip's CURRENT
 * vehicle, which `toFleetOptions` guards against.
 */
function useVehicleOptions(trip: Trip, inactiveSuffix: string) {
  const { data, isLoading } = useAsync(
    useCallback((signal: AbortSignal) => listActiveVehicles(signal), []),
    [],
  );

  return useMemo(
    () => ({
      isLoading,
      // The Trip's current vehicle may since have been deactivated, so it is
      // absent from the active list. Dropping it would silently unassign the
      // truck the moment anyone saved an unrelated field.
      vehicles: toPickerOptions(
        toFleetOptions(
          data ? data.items : [],
          describeVehicle,
          trip.vehicleId,
          trip.vehicle?.licensePlate,
        ),
        inactiveSuffix,
      ),
    }),
    [data, isLoading, trip, inactiveSuffix],
  );
}

/**
 * Marks an inactive current assignment, which the shared options flag.
 *
 * The rule itself — keep it in the list at all — lives in `fleet-options.ts`
 * and is shared with Ritten's inline editing, so the two cannot drift apart on
 * the case that matters.
 */
function toPickerOptions(options: FleetOption[], inactiveSuffix: string) {
  return options.map((option) => ({
    value: option.value,
    label: option.isCurrentInactive
      ? `${option.label} (${inactiveSuffix})`
      : option.label,
  }));
}

export function TripEditForm({
  trip,
  onSave,
  onCancel,
}: {
  trip: Trip;
  onSave: (payload: UpdateTripPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslation();
  const [values, setValues] = useState<FormValues>(() => toFormValues(trip));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fleet = useVehicleOptions(trip, t("ritten.value.inactive"));

  const update = (patch: Partial<FormValues>) => {
    setValues((current) => ({ ...current, ...patch }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await onSave(toPayload(values));
    } catch (caught: unknown) {
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={t("tripDetail.edit.title")}
        description={t("tripDetail.edit.description")}
      />
      <CardBody>
        <form onSubmit={handleSubmit} noValidate>
          {error ? <FormError error={error} /> : null}

          <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <TextField
              id="planningDate"
              label={t("ritten.column.date")}
              type="date"
              value={values.planningDate}
              onChange={(value) => update({ planningDate: value })}
              hint={t("tripDetail.edit.planningDateHint")}
              required
            />

            <TextField
              id="containerNumber"
              label={t("ritten.column.container")}
              value={values.containerNumber}
              onChange={(value) => update({ containerNumber: value })}
              maxLength={CONTAINER_NUMBER_MAX_LENGTH}
              hint={t("tripDetail.edit.containerHint")}
            />

            <div>
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
                {t("ritten.column.waitingTime")}
              </span>
              <div className="flex items-end gap-2">
                <TextField
                  id="waitingHours"
                  label={t("ritten.waiting.hours")}
                  type="number"
                  value={values.waitingHours}
                  onChange={(value) => update({ waitingHours: value })}
                  min={0}
                />
                <TextField
                  id="waitingMinutes"
                  label={t("ritten.waiting.minutes")}
                  type="number"
                  value={values.waitingMinutes}
                  onChange={(value) => update({ waitingMinutes: value })}
                  min={0}
                  max={MINUTES_PER_HOUR - 1}
                />
              </div>
              <p className="mt-1 text-xs text-muted">
                {t("tripDetail.edit.waitingTimeHint")}
              </p>
            </div>

            <TextField
              id="distanceKm"
              label={t("tripDetail.field.distance")}
              type="number"
              step="0.01"
              value={values.distanceKm}
              onChange={(value) => update({ distanceKm: value })}
              min={0}
              max={DISTANCE_KM_MAX}
              hint={t("tripDetail.edit.distanceHint")}
            />

            <TextField
              id="executionDatetime"
              label={t("tripDetail.field.carriedOutAt")}
              type="datetime-local"
              value={values.executionDatetime}
              onChange={(value) => update({ executionDatetime: value })}
              hint={t("tripDetail.edit.carriedOutAtHint")}
            />

            <SelectField
              id="vehicleId"
              label={t("ritten.filter.vehicle")}
              value={values.vehicleId}
              onChange={(value) => update({ vehicleId: value })}
              emptyLabel={t("ritten.value.noVehicle")}
              options={fleet.vehicles}
              isLoading={fleet.isLoading}
              hint={t("tripDetail.edit.vehicleHint")}
              loadingLabel={t("tripDetail.edit.loading")}
            />
          </div>

          <div className="mt-4">
            <label
              htmlFor="internalNotes"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
            >
              {t("tripDetail.field.internalNotes")}
            </label>
            <textarea
              id="internalNotes"
              rows={3}
              maxLength={INTERNAL_NOTES_MAX_LENGTH}
              value={values.internalNotes}
              onChange={(event) => update({ internalNotes: event.target.value })}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            />
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <Spinner label={t("vehicles.action.saving")} /> : null}
              {isSaving
                ? t("vehicles.action.saving")
                : t("vehicles.action.save")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
            >
              {t("tripDetail.edit.discard")}
            </button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/**
 * Turns the form's strings into the backend's payload.
 *
 * An empty field becomes `null`, which is how the backend documents "clear this
 * value" — not an empty string, and not omission, which would mean "leave it
 * alone". `planningDate` is the exception: it is not nullable, so an empty date
 * is simply not sent.
 */
function toPayload(values: FormValues): UpdateTripPayload {
  return {
    containerNumber: emptyToNull(values.containerNumber),
    planningDate: values.planningDate || undefined,
    // An empty selection sends null, which the backend documents as "unassign".
    // `driverId` is not sent at all: omitting a field leaves it untouched, so a
    // Trip that still carries an old override keeps it rather than having it
    // silently cleared by an unrelated edit.
    vehicleId: values.vehicleId === NONE ? null : values.vehicleId,
    waitingTimeMinutes: parseWaitingTime(
      values.waitingHours,
      values.waitingMinutes,
    ).totalMinutes,
    distanceKm: emptyToNullNumber(values.distanceKm),
    executionDatetime: values.executionDatetime
      ? new Date(values.executionDatetime).toISOString()
      : null,
    internalNotes: emptyToNull(values.internalNotes),
  };
}

/** Plate first, because that is how a planner refers to a truck. */
function describeVehicle(vehicle: Vehicle): string {
  const model = [vehicle.brand, vehicle.model].filter(Boolean).join(" ");

  return model ? `${vehicle.licensePlate} · ${model}` : vehicle.licensePlate;
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

function emptyToNullNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

/**
 * The backend's rejection, including its field-level detail.
 *
 * class-validator returns an array of messages naming the field and the rule
 * broken, which is far more useful than a generic "invalid input".
 */
function FormError({ error }: { error: unknown }) {
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as unknown[]).map(String)
      : [];

  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-4 py-3"
    >
      <p className="text-sm font-medium text-danger">
        {userFacingMessage(error)}
      </p>
      {details.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-sm text-danger">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A picker over records the backend supplied.
 *
 * A select rather than free text: the value is a foreign key, and typing a UUID
 * is neither possible for a person nor safe. The empty option is always present
 * because both fields are nullable, and clearing them is a real operation with
 * a documented meaning.
 */
function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  emptyLabel,
  isLoading,
  hint,
  loadingLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  emptyLabel: string;
  isLoading: boolean;
  hint?: string;
  loadingLabel: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={isLoading}
        className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
      >
        <option value={NONE}>{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {isLoading ? (
        <p className="mt-1 text-xs text-muted">{loadingLabel}</p>
      ) : null}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  hint,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: string;
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
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        {...rest}
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
