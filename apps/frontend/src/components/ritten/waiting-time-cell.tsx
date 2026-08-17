"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, userFacingMessage } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  formatWaitingTime,
  parseWaitingTime,
  toWaitingTimeParts,
  type WaitingTimeError,
} from "@/lib/waiting-time";

/**
 * Waiting time, entered as hours and minutes.
 *
 * The database stores one integer — total minutes — and that never changes.
 * This is purely how a person reads and writes it, and the conversion lives in
 * `waiting-time.ts` so the table, this editor and the Trip detail page cannot
 * drift apart.
 *
 * Invalid input is REFUSED rather than repaired. "1 uur 90 min" could be read
 * as 2:30, but silently rewriting what someone typed is how a mistyped 9
 * becomes an hour and a half of billed waiting; the editor says what is wrong
 * and lets them correct it.
 */

const ERROR_KEYS: Record<WaitingTimeError, TranslationKey> = {
  hoursNotWholeNumber: "ritten.waiting.hoursWhole",
  hoursNegative: "ritten.waiting.hoursPositive",
  minutesNotWholeNumber: "ritten.waiting.minutesWhole",
  minutesOutOfRange: "ritten.waiting.minutesRange",
};

export function WaitingTimeCell({
  totalMinutes,
  isDisabled,
  onSave,
}: {
  totalMinutes: number | null;
  isDisabled?: boolean;
  /** Receives the value for `waitingTimeMinutes`; null clears it. */
  onSave: (totalMinutes: number | null) => Promise<void>;
}) {
  const t = useTranslation();
  const parts = toWaitingTimeParts(totalMinutes);

  const [isEditing, setIsEditing] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<WaitingTimeError | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const hoursRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      hoursRef.current?.focus();
    }
  }, [isEditing]);

  function open(): void {
    setHours(parts ? String(parts.hours) : "");
    setMinutes(parts ? String(parts.minutes) : "");
    setLocalError(null);
    setSaveError(null);
    setIsEditing(true);
  }

  async function save(): Promise<void> {
    const result = parseWaitingTime(hours, minutes);

    if (result.error) {
      setLocalError(result.error);
      return;
    }

    setLocalError(null);
    setSaveError(null);
    setIsSaving(true);

    try {
      await onSave(result.totalMinutes);
      setIsEditing(false);
    } catch (error: unknown) {
      setSaveError(error);
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={open}
        disabled={isDisabled}
        aria-label={t("ritten.edit.waitingTime")}
        className="w-full rounded px-1 py-0.5 text-left hover:bg-primary/10 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        {formatWaitingTime(totalMinutes) ?? t("ritten.value.empty")}
      </button>
    );
  }

  return (
    <div className="min-w-44 rounded border border-primary bg-card p-1">
      <div className="flex items-end gap-2">
        <NumberField
          id="waiting-hours"
          ref={hoursRef}
          label={t("ritten.waiting.hours")}
          value={hours}
          min={0}
          onChange={setHours}
          onEnter={() => void save()}
          onEscape={() => setIsEditing(false)}
          isDisabled={isSaving}
        />
        <NumberField
          id="waiting-minutes"
          label={t("ritten.waiting.minutes")}
          value={minutes}
          min={0}
          max={59}
          onChange={setMinutes}
          onEnter={() => void save()}
          onEscape={() => setIsEditing(false)}
          isDisabled={isSaving}
        />
      </div>

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => void save()}
          disabled={isSaving}
          className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {isSaving ? t("ritten.edit.saving") : t("ritten.edit.save")}
        </button>
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          disabled={isSaving}
          className="rounded border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
        >
          {t("ritten.edit.cancel")}
        </button>
      </div>

      {localError ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {t(ERROR_KEYS[localError])}
        </p>
      ) : null}

      {saveError ? <SaveError error={saveError} /> : null}
    </div>
  );
}

function NumberField({
  id,
  ref,
  label,
  value,
  min,
  max,
  onChange,
  onEnter,
  onEscape,
  isDisabled,
}: {
  id: string;
  ref?: React.Ref<HTMLInputElement>;
  label: string;
  value: string;
  min: number;
  max?: number;
  onChange: (value: string) => void;
  onEnter: () => void;
  onEscape: () => void;
  isDisabled: boolean;
}) {
  return (
    <span className="block">
      <input
        id={id}
        ref={ref}
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        disabled={isDisabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onEnter();
          }

          if (event.key === "Escape") {
            onEscape();
          }
        }}
        className="w-16 rounded border border-border bg-card px-1.5 py-1 text-sm text-foreground"
      />
      <span className="mt-0.5 block text-center text-[11px] text-muted">
        {label}
      </span>
    </span>
  );
}

/** The backend's refusal, with the field-level detail it returned. */
function SaveError({ error }: { error: unknown }) {
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as string[])
      : [];

  return (
    <p role="alert" className="mt-1 text-xs text-danger">
      {userFacingMessage(error)}
      {details.length > 0 ? (
        <span className="mt-0.5 block">{details.join(" · ")}</span>
      ) : null}
    </p>
  );
}
