"use client";

import { useState } from "react";

import { ApiError, userFacingMessage } from "@/lib/api/client";
import type { UpdateTripPayload } from "@/lib/api/trips";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { RittenDialog } from "./ritten-dialog";

/**
 * The three editable fields that have no column in the Ritten table.
 *
 * Distance, execution datetime and internal notes are part of `UpdateTripDto`
 * but have no place in an operational table, and adding columns for them would
 * be a redesign. They live here instead, saved through the same PATCH and the
 * same refetch as every inline edit.
 *
 * Start and end time are deliberately ABSENT: the backend documents them as
 * parser-controlled and refuses them outright, so offering them would produce a
 * guaranteed 400.
 */

/** From the backend's create-trip.dto.ts, to catch a mistake before a round trip. */
const INTERNAL_NOTES_MAX_LENGTH = 2000;
const DISTANCE_KM_MAX = 999_999.99;

export function TripDetailsDialog({
  trip,
  onSave,
  onClose,
}: {
  trip: Trip;
  onSave: (tripId: string, payload: UpdateTripPayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [distanceKm, setDistanceKm] = useState(trip.distanceKm ?? "");
  const [executionDatetime, setExecutionDatetime] = useState(
    // The input exchanges `YYYY-MM-DDTHH:mm`; the backend sends full ISO.
    trip.executionDatetime ? trip.executionDatetime.slice(0, 16) : "",
  );
  const [internalNotes, setInternalNotes] = useState(trip.internalNotes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await onSave(trip.id, {
        // Empty means "clear this value", which the backend spells null. An
        // empty string would be a different instruction entirely.
        distanceKm: distanceKm === "" ? null : Number(distanceKm),
        executionDatetime:
          executionDatetime === ""
            ? null
            : new Date(executionDatetime).toISOString(),
        internalNotes: internalNotes.trim() === "" ? null : internalNotes.trim(),
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
      title={`${t("ritten.edit.detailsTitle")} — ${trip.bookingNumber}`}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="px-4 py-3">
        <p className="text-sm text-secondary">
          {t("ritten.edit.detailsDescription")}
        </p>

        {error ? <FormError error={error} /> : null}

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("ritten.edit.distance")} htmlFor="details-distance">
            <input
              id="details-distance"
              type="number"
              step="0.01"
              min={0}
              max={DISTANCE_KM_MAX}
              value={distanceKm}
              onChange={(event) => setDistanceKm(event.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <Field
            label={t("ritten.edit.executionDatetime")}
            htmlFor="details-execution"
          >
            <input
              id="details-execution"
              type="datetime-local"
              value={executionDatetime}
              onChange={(event) => setExecutionDatetime(event.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("ritten.edit.internalNotes")} htmlFor="details-notes">
              <textarea
                id="details-notes"
                rows={4}
                maxLength={INTERNAL_NOTES_MAX_LENGTH}
                value={internalNotes}
                onChange={(event) => setInternalNotes(event.target.value)}
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
            {isSaving ? t("ritten.edit.saving") : t("ritten.edit.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("ritten.edit.cancel")}
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
      className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
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
