"use client";

import { useState } from "react";

import { ApiError, userFacingMessage } from "@/lib/api/client";
import type { CreateTripPayload } from "@/lib/api/trips";
import type { Vehicle } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { parseWaitingTime, type WaitingTimeError } from "@/lib/waiting-time";
import { RittenDialog } from "./ritten-dialog";

/**
 * Creating a Trip by hand, without a PDF.
 *
 * ── EVERY FIELD MAY STAY EMPTY ──────────────────────────────────────────────
 * This form exists for the job that is announced by telephone: a truck is
 * needed, and the booking number, container, destination and even the date
 * follow later. So nothing here is required — not the booking number, not the
 * date — and an empty field is sent as null.
 *
 * It invents nothing to fill a gap. A placeholder booking number would become a
 * string the rest of the business has to recognise and strip: in the list, in
 * search, in the export, on the invoice.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 * A driver picker. A Trip is planned onto a TRUCK, and who drives it follows
 * from that truck's Driver assignment. Offering a second way to choose one is
 * what this product removed.
 *
 * A status. Every Trip starts OPEN and moves through the status endpoint, so
 * the lifecycle keeps one entry point.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Validation is the backend's. The browser checks only what it can do for free
 * — a date input rejects nonsense, a number input refuses letters — and the
 * backend's own refusal, including its field-level detail, is what is shown.
 */

/** From the backend's create-trip.dto.ts, to catch a mistake before a round trip. */
const BOOKING_NUMBER_MAX_LENGTH = 100;
const CONTAINER_NUMBER_MAX_LENGTH = 100;
const CONTAINER_TYPE_MAX_LENGTH = 50;
const TERMINAL_MAX_LENGTH = 200;
const DESTINATION_MAX_LENGTH = 200;
const INTERNAL_NOTES_MAX_LENGTH = 2000;
const DISTANCE_KM_MAX = 999_999.99;
const MAX_MINUTES = 59;

interface FormValues {
  bookingNumber: string;
  planningDate: string;
  vehicleId: string;
  startTime: string;
  endTime: string;
  containerNumber: string;
  containerType: string;
  terminal: string;
  destinationCity: string;
  destinationCountry: string;
  waitingHours: string;
  waitingMinutes: string;
  distanceKm: string;
  internalNotes: string;
}

const EMPTY_FORM: FormValues = {
  bookingNumber: "",
  planningDate: "",
  vehicleId: "",
  startTime: "",
  endTime: "",
  containerNumber: "",
  containerType: "",
  terminal: "",
  destinationCity: "",
  destinationCountry: "",
  waitingHours: "",
  waitingMinutes: "",
  distanceKm: "",
  internalNotes: "",
};

/** Empty means "not known", which the backend stores as null. */
function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

export function toCreatePayload(values: FormValues): CreateTripPayload {
  const distance = values.distanceKm.trim();

  return {
    bookingNumber: emptyToNull(values.bookingNumber),
    planningDate: emptyToNull(values.planningDate),
    vehicleId: emptyToNull(values.vehicleId),
    startTime: emptyToNull(values.startTime),
    endTime: emptyToNull(values.endTime),
    containerNumber: emptyToNull(values.containerNumber),
    containerType: emptyToNull(values.containerType),
    terminal: emptyToNull(values.terminal),
    destinationCity: emptyToNull(values.destinationCity),
    destinationCountry: emptyToNull(values.destinationCountry),
    waitingTimeMinutes: parseWaitingTime(
      values.waitingHours,
      values.waitingMinutes,
    ).totalMinutes,
    distanceKm: distance === "" ? null : Number(distance),
    internalNotes: emptyToNull(values.internalNotes),
  };
}

export function NewTripDialog({
  vehicles,
  onCreate,
  onClose,
}: {
  /** Active vehicles, already fetched by the page. */
  vehicles: readonly Vehicle[];
  /** Resolves once the backend accepted it AND the list was refetched. */
  onCreate: (payload: CreateTripPayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = (patch: Partial<FormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  /*
   * The one thing checked here rather than by the backend: minutes belong to an
   * hour. The shared utility REFUSES 90 minutes instead of silently rewriting
   * it to 1h30 — what someone typed is what they meant, and quietly changing it
   * is worse than saying it is wrong.
   */
  const waiting = parseWaitingTime(values.waitingHours, values.waitingMinutes);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (waiting.error) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onCreate(toCreatePayload(values));
      onClose();
    } catch (caught: unknown) {
      // Kept open, with what the backend said: the entered values are still
      // here and the operator can correct them.
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RittenDialog title={t("ritten.new.title")} onClose={onClose}>
      <form onSubmit={submit} noValidate className="px-4 py-3">
        {error ? <FormError error={error} /> : null}

        <p className="mb-4 text-sm text-secondary">{t("ritten.new.intro")}</p>

        <Section title={t("ritten.new.sectionGeneral")}>
          <Field label={t("ritten.column.booking")} htmlFor="new-booking">
            <input
              id="new-booking"
              maxLength={BOOKING_NUMBER_MAX_LENGTH}
              value={values.bookingNumber}
              onChange={(event) => update({ bookingNumber: event.target.value })}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label={t("ritten.column.date")}
            htmlFor="new-date"
            hint={t("ritten.new.dateHint")}
          >
            <input
              id="new-date"
              type="date"
              value={values.planningDate}
              onChange={(event) => update({ planningDate: event.target.value })}
              className={INPUT_CLASS}
            />
          </Field>
        </Section>

        <Section title={t("ritten.new.sectionPlanning")}>
          <Field label={t("ritten.filter.vehicle")} htmlFor="new-vehicle">
            <select
              id="new-vehicle"
              value={values.vehicleId}
              onChange={(event) => update({ vehicleId: event.target.value })}
              className={INPUT_CLASS}
            >
              <option value="">{t("ritten.value.noVehicle")}</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.licensePlate}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("ritten.column.start")} htmlFor="new-start">
              <input
                id="new-start"
                type="time"
                value={values.startTime}
                onChange={(event) => update({ startTime: event.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t("ritten.column.end")} htmlFor="new-end">
              <input
                id="new-end"
                type="time"
                value={values.endTime}
                onChange={(event) => update({ endTime: event.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </Section>

        <Section title={t("ritten.new.sectionTransport")}>
          <Field label={t("ritten.column.container")} htmlFor="new-container">
            <input
              id="new-container"
              maxLength={CONTAINER_NUMBER_MAX_LENGTH}
              value={values.containerNumber}
              onChange={(event) =>
                update({ containerNumber: event.target.value })
              }
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label={t("ritten.column.containerType")}
            htmlFor="new-container-type"
          >
            <input
              id="new-container-type"
              maxLength={CONTAINER_TYPE_MAX_LENGTH}
              value={values.containerType}
              onChange={(event) => update({ containerType: event.target.value })}
              className={INPUT_CLASS}
            />
          </Field>

          <Field label={t("ritten.column.terminal")} htmlFor="new-terminal">
            <input
              id="new-terminal"
              maxLength={TERMINAL_MAX_LENGTH}
              value={values.terminal}
              onChange={(event) => update({ terminal: event.target.value })}
              className={INPUT_CLASS}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tripDetail.field.city")} htmlFor="new-city">
              <input
                id="new-city"
                maxLength={DESTINATION_MAX_LENGTH}
                value={values.destinationCity}
                onChange={(event) =>
                  update({ destinationCity: event.target.value })
                }
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={t("tripDetail.field.country")} htmlFor="new-country">
              <input
                id="new-country"
                maxLength={DESTINATION_MAX_LENGTH}
                value={values.destinationCountry}
                onChange={(event) =>
                  update({ destinationCountry: event.target.value })
                }
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </Section>

        <Section title={t("ritten.new.sectionExecution")}>
          <div>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
              {t("ritten.column.waitingTime")}
            </span>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("ritten.waiting.hours")} htmlFor="new-waiting-hours">
                <input
                  id="new-waiting-hours"
                  type="number"
                  min={0}
                  value={values.waitingHours}
                  onChange={(event) =>
                    update({ waitingHours: event.target.value })
                  }
                  className={INPUT_CLASS}
                />
              </Field>
              <Field
                label={t("ritten.waiting.minutes")}
                htmlFor="new-waiting-minutes"
              >
                <input
                  id="new-waiting-minutes"
                  type="number"
                  min={0}
                  max={MAX_MINUTES}
                  value={values.waitingMinutes}
                  onChange={(event) =>
                    update({ waitingMinutes: event.target.value })
                  }
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
            {waiting.error ? (
              <p role="alert" className="mt-1 text-xs font-medium text-danger">
                {t(waitingErrorKey(waiting.error))}
              </p>
            ) : null}
          </div>

          <Field label={t("tripDetail.field.distance")} htmlFor="new-distance">
            <input
              id="new-distance"
              type="number"
              step="0.01"
              min={0}
              max={DISTANCE_KM_MAX}
              value={values.distanceKm}
              onChange={(event) => update({ distanceKm: event.target.value })}
              className={INPUT_CLASS}
            />
          </Field>

          <Field
            label={t("tripDetail.field.internalNotes")}
            htmlFor="new-notes"
          >
            <textarea
              id="new-notes"
              rows={3}
              maxLength={INTERNAL_NOTES_MAX_LENGTH}
              value={values.internalNotes}
              onChange={(event) => update({ internalNotes: event.target.value })}
              className={INPUT_CLASS}
            />
          </Field>
        </Section>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="submit"
            disabled={isSaving || Boolean(waiting.error)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("vehicles.action.saving") : t("ritten.new.submit")}
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

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground";

/** The shared waiting-time utility's own reasons, translated. */
function waitingErrorKey(error: WaitingTimeError) {
  return `ritten.waiting.${error === "hoursNotWholeNumber" ? "hoursWhole" : error === "hoursNegative" ? "hoursPositive" : error === "minutesNotWholeNumber" ? "minutesWhole" : "minutesRange"}` as const;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
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

/** The backend's refusal, including the field-level detail it returns. */
function FormError({ error }: { error: unknown }) {
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as unknown[]).map(String)
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
