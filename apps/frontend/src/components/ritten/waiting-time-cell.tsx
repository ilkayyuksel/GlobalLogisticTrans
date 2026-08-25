"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, userFacingMessage } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  formatWaitingTime,
  waitingWindowMinutes,
  type WaitingWindowError,
} from "@/lib/waiting-time";

/**
 * Waiting time, entered as the two clock times it was read from.
 *
 * ── WHY BEGIN AND EIND, NOT A DURATION ──────────────────────────────────────
 * Nobody measures a duration. A driver notes the time the truck arrived and the
 * time it left, and subtracting them in your head at the end of a shift is
 * exactly the step that produces "1 uur 90 min" and mistyped hours. So the
 * editor asks for the two moments and the duration is computed.
 *
 * The database is unchanged: one integer, `waiting_time_minutes`, which is what
 * is sent and what pricing bills from. The two times are input, not storage —
 * the Trip does not keep them, and nothing here pretends otherwise.
 *
 * A window that crosses midnight is ordinary and is handled: 22:00 → 02:00 is
 * four hours. Equal times are zero, never a full day — see `waiting-time.ts`.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ERROR_KEYS: Record<WaitingWindowError, TranslationKey> = {
  beginInvalid: "ritten.waiting.beginRequired",
  endInvalid: "ritten.waiting.endRequired",
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

  const [isEditing, setIsEditing] = useState(false);
  const [begin, setBegin] = useState("");
  const [end, setEnd] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<WaitingWindowError | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const beginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      beginRef.current?.focus();
    }
  }, [isEditing]);

  /*
   * The duration as it stands while typing, so the operator sees what will be
   * stored before storing it. Errors are not shown here — they belong to the
   * save, where they can be acted on.
   */
  const preview = waitingWindowMinutes(begin, end);

  function open(): void {
    /*
     * Deliberately EMPTY, even for a Trip that already has a waiting time.
     * The Trip stores a duration and never stored the two times it came from,
     * so there is nothing to reconstruct — and inventing "10:00 → 12:15" from
     * 135 minutes would put times on screen that nobody ever read off a clock.
     * The existing duration stays visible behind this editor.
     */
    setBegin("");
    setEnd("");
    setLocalError(null);
    setSaveError(null);
    setIsEditing(true);
  }

  async function save(): Promise<void> {
    const result = waitingWindowMinutes(begin, end);

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
        <ClockField
          id="waiting-begin"
          ref={beginRef}
          label={t("ritten.waiting.begin")}
          value={begin}
          onChange={setBegin}
          onEnter={() => void save()}
          onEscape={() => setIsEditing(false)}
          isDisabled={isSaving}
        />
        <ClockField
          id="waiting-end"
          label={t("ritten.waiting.end")}
          value={end}
          onChange={setEnd}
          onEnter={() => void save()}
          onEscape={() => setIsEditing(false)}
          isDisabled={isSaving}
        />
      </div>

      {/* What will be stored, in the same words the column uses. */}
      <p className="mt-1 text-[11px] text-muted">
        {t("ritten.waiting.calculated")}:{" "}
        <span className="font-medium text-foreground">
          {preview.error || preview.totalMinutes === null
            ? t("ritten.value.empty")
            : formatWaitingTime(preview.totalMinutes)}
        </span>
      </p>

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

/** A time of day. `type="time"` gives the browser's own HH:mm handling. */
function ClockField({
  id,
  ref,
  label,
  value,
  onChange,
  onEnter,
  onEscape,
  isDisabled,
}: {
  id: string;
  ref?: React.Ref<HTMLInputElement>;
  label: string;
  value: string;
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
        type="time"
        aria-label={label}
        value={value}
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
        className="w-24 rounded border border-border bg-card px-1.5 py-1 text-sm text-foreground"
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
